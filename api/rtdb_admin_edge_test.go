package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func pendingReviewItem() map[string]interface{} {
	return map[string]interface{}{"id_barang": 1, "id_user": 3, "nama_barang": "Fixture pending", "kategori": "Lainnya", "harga_awal": 100000, "status_verifikasi": "pending", "updated_at": "2026-10-20T09:00:00Z"}
}

func TestRegistrationCannotClaimAnActiveUIDThroughAnOldEmail(t *testing.T) {
	root := map[string]interface{}{}
	treeNode(root, "users")["active-owner"] = map[string]interface{}{"id_user": 7, "firebase_uid": "active-owner", "email": "fixture@example.invalid", "saldo_wallet": 450000, "saldo_hold": 0}
	treeNode(root, "user_ids")["7"] = "active-owner"
	snapshot := paymentRTDBFixture(t, root)
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, registrationRequest(true))
	if w.Code != 409 || treeRecord(snapshot(), "users", "active-owner") == nil || treeRecord(snapshot(), "users", "new-uid") != nil || treeMap(snapshot()["user_ids"])["7"] != "active-owner" {
		t.Fatalf("verified recycled email reassigned an existing account and funds: %d %s", w.Code, w.Body)
	}
}

func TestRegistrationDoesNotChooseBetweenAmbiguousLegacyEmails(t *testing.T) {
	root := map[string]interface{}{}
	for _, id := range []int{7, 8} {
		treeNode(root, "legacy_users")[rtdbPathID(id)] = map[string]interface{}{"id_user": id, "email": "fixture@example.invalid", "saldo_wallet": 450000, "saldo_hold": 0}
	}
	snapshot := paymentRTDBFixture(t, root)
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, registrationRequest(true))
	if w.Code != 409 || len(treeMap(snapshot()["legacy_users"])) != 2 || len(treeMap(snapshot()["users"])) != 0 {
		t.Fatalf("ambiguous legacy profiles were arbitrarily linked: %d %s", w.Code, w.Body)
	}
}

func TestItemBoundaryRejectsAmountsAndSpecsThatWouldBreakTheCatalog(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		value       interface{}
	}{
		{"invalid reserve text", "reserve_price", "invalid"},
		{"object reserve", "reserve_price", map[string]interface{}{"nominal": 100000}},
		{"reserve below opening", "reserve_price", 1},
		{"unbillable opening", "harga_awal", 9_999_999_999_999.0},
		{"object specification", "spesifikasi", map[string]interface{}{"Condition": map[string]interface{}{"invalid": true}}},
		{"array specification", "spesifikasi", []interface{}{true}},
		{"Firebase-invalid specification key", "spesifikasi", map[string]interface{}{"No. Seri": "Fixture"}},
		{"invalid estimate", "estimasi_pasar", -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item := pendingReviewItem()
			item[tc.field] = tc.value
			if err := validateItemData(item); err == nil {
				t.Fatal("invalid item data reached persistence")
			}
		})
	}
	item := pendingReviewItem()
	item["harga_awal"], item["reserve_price"], item["spesifikasi"] = "100000", "200000", map[string]string{"Kondisi": "Fixture valid"}
	requireNoError(t, validateItemData(item))
	if item["harga_awal"] != float64(100000) || item["reserve_price"] != float64(200000) {
		t.Fatal("legacy numeric strings were not normalized into safe catalog amounts")
	}
}

func TestCuratorMustReviewTheCurrentSubmissionVersion(t *testing.T) {
	root := map[string]interface{}{"items": map[string]interface{}{"1": pendingReviewItem()}}
	treeNode(root, "users")["seller"] = map[string]interface{}{"id_user": 3}
	snapshot := paymentRTDBFixture(t, root)
	owner := &RTDBClaims{ID: 3, UID: "seller", Role: RoleMasyarakat}
	staff := &RTDBClaims{ID: 5, Role: RolePetugas}
	w := httptest.NewRecorder()
	UpdateBarangInfoRTDB(w, operationRequest("PUT", `{"nama_barang":"Changed by fixture owner","expected_updated_at":"2026-10-20T09:00:00Z"}`, "1", owner))
	if w.Code != 200 {
		t.Fatalf("owner edit: %d %s", w.Code, w.Body)
	}
	approval := `{"status":"approved","kelipatan_minimal":10000,"uang_jaminan":100000,"expected_updated_at":%q}`
	for _, stale := range []string{"2026-10-20T09:00:00Z", ""} {
		w = httptest.NewRecorder()
		ValidateBarangRTDB(w, operationRequest("POST", fmt.Sprintf(approval, stale), "1", staff))
		if w.Code != 409 || len(treeMap(snapshot()["auctions"])) != 0 {
			t.Fatalf("outdated review approved unseen item changes: %d %s", w.Code, w.Body)
		}
	}
	w = httptest.NewRecorder()
	ValidateBarangRTDB(w, operationRequest("POST", `{"status":"approved","kelipatan_minimal":10000,"uang_jaminan":100000}`, "1", staff))
	if w.Code != 400 {
		t.Fatalf("missing version bypassed review: %d %s", w.Code, w.Body)
	}
	version := stringValue(treeRecord(snapshot(), "items", "1")["updated_at"], "")
	w = httptest.NewRecorder()
	ValidateBarangRTDB(w, operationRequest("POST", fmt.Sprintf(approval, version), "1", staff))
	if w.Code != 200 || len(treeMap(snapshot()["auctions"])) != 1 {
		t.Fatalf("current review failed: %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	ValidateBarangRTDB(w, operationRequest("POST", fmt.Sprintf(approval, version), "1", staff))
	if w.Code != 409 || len(treeMap(snapshot()["auctions"])) != 1 {
		t.Fatal("retry overwrote a final curation decision or duplicated its lot")
	}
}

func TestConcurrentStaffEditsKeepOneReviewedVersion(t *testing.T) {
	snapshot := paymentRTDBFixture(t, map[string]interface{}{"items": map[string]interface{}{"1": pendingReviewItem()}})
	var group sync.WaitGroup
	var successes, conflicts atomic.Int32
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			w := httptest.NewRecorder()
			body := fmt.Sprintf(`{"nama_barang":"Fixture edit %d","expected_updated_at":"2026-10-20T09:00:00Z"}`, index)
			UpdateBarangInfoRTDB(w, operationRequest("PUT", body, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			switch w.Code {
			case 200:
				successes.Add(1)
			case 409:
				conflicts.Add(1)
			default:
				t.Errorf("concurrent edit failed: %d %s", w.Code, w.Body)
			}
		}(i)
	}
	group.Wait()
	if successes.Load() != 1 || conflicts.Load() != 7 || treeRecord(snapshot(), "items", "1")["updated_at"] == "2026-10-20T09:00:00Z" {
		t.Fatalf("stale edits overwrote a newer revision: successes=%d conflicts=%d", successes.Load(), conflicts.Load())
	}
}

func TestDraftItemEditKeepsReserveAndOpeningConsistent(t *testing.T) {
	for _, reserve := range []float64{0, 300000} {
		t.Run(rtdbPathID(int(reserve)), func(t *testing.T) {
			now := time.Now()
			root := lifecycleRoot(now)
			lot := treeRecord(root, "auctions", "1")
			lot["status"], lot["harga_awal"], lot["reserve_price"] = "draft", 100000, 200000
			treeRecord(root, "items", "1")["reserve_price"] = 200000
			snapshot := paymentRTDBFixture(t, root)
			w := httptest.NewRecorder()
			body := `{"harga_awal":150000,"reserve_price":` + rtdbPathID(int(reserve)) + `,"expected_updated_at":""}`
			UpdateBarangInfoRTDB(w, operationRequest("PUT", body, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			if w.Code != 200 {
				t.Fatalf("edit failed: %d %s", w.Code, w.Body)
			}
			root = snapshot()
			lot, item := treeRecord(root, "auctions", "1"), treeRecord(root, "items", "1")
			if numberValue(lot["harga_awal"]) != numberValue(item["harga_awal"]) || numberValue(lot["reserve_price"]) != reserve {
				t.Fatal("catalog price and executable auction sale terms disagree after an edit")
			}
			lot["status"] = "dibuka"
			buyer := lifecycleClaims(1, "alice", now)
			requireNoError(t, lockAuctionHold(root, buyer, "1", now))
			requireNoError(t, placeTreeBid(root, buyer, "1", 150000, now))
			requireNoError(t, settleAuction(root, "1", false, now))
			wantInvoice := 0
			if reserve == 0 {
				wantInvoice = 1
			}
			if len(treeMap(root["invoices"])) != wantInvoice {
				t.Fatal("settlement ignored the reserve selected by the curator")
			}
		})
	}
}

func TestItemEditsRejectStartedFinalAndFinanciallyLinkedLots(t *testing.T) {
	for _, state := range []string{"terjadwal", "ditutup", "dibatalkan", "unknown", "invoice"} {
		t.Run(state, func(t *testing.T) {
			now := time.Now()
			root := lifecycleRoot(now)
			lot := treeRecord(root, "auctions", "1")
			lot["status"] = state
			if state == "invoice" {
				lot["status"] = "draft"
				treeNode(root, "invoices")["1"] = map[string]interface{}{"id_lelang": 1, "id_barang": 1}
			}
			snapshot := paymentRTDBFixture(t, root)
			w := httptest.NewRecorder()
			UpdateBarangInfoRTDB(w, operationRequest("PUT", `{"nama_barang":"Changed fixture","expected_updated_at":""}`, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			if w.Code != http.StatusConflict || treeRecord(snapshot(), "items", "1")["nama_barang"] != "Fixture barang" {
				t.Fatalf("historical or due item was edited: %d %s", w.Code, w.Body)
			}
		})
	}
}

func TestDueScheduledLotCannotBeMovedBeforeWorkerRuns(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	treeRecord(root, "auctions", "1")["status"] = "terjadwal"
	treeNode(root, "sessions")["1"] = map[string]interface{}{"id_sesi": 1, "status": "upcoming", "tgl_mulai": now.Add(time.Hour).Format(time.RFC3339Nano), "durasi_default_jam": 2}
	if err := assignSessionLot(root, 1, 1, 0, now); err == nil {
		t.Fatal("a scheduled lot whose start time already passed was moved to a new session")
	}
}

func TestPickupCannotBecomeExpeditionWithIncompleteRecipient(t *testing.T) {
	_, buyer, staff := shippingFixture(t)
	shippingCall(t, UpdateFulfillmentCourierRTDB, buyer, map[string]interface{}{"kurir": pickupCourier, "layanan_kurir": pickupService, "ongkir": 0}, 200)
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, map[string]interface{}{"nama_penerima": "Fixture pickup", "telp_penerima": "081234567890", "alamat_lengkap": "Partial fixture address"}, 200)
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, shippingQuote(), 409)
}

func TestFulfillmentRejectsChangedSellerOrInvalidPayout(t *testing.T) {
	for _, field := range []string{"order-seller", "invoice-seller", "item-seller", "excess-proceeds", "missing-escrow"} {
		t.Run(field, func(t *testing.T) {
			snapshot, buyer, _ := shippingFixture(t)
			requireNoError(t, rtdbTransaction(t.Context(), func(root map[string]interface{}) error {
				order, invoice := treeRecord(root, "fulfillments", "FUL-1"), treeRecord(root, "invoices", "1")
				order["status"] = "dikirim"
				switch field {
				case "order-seller":
					order["id_user_penjual"] = 2
				case "invoice-seller":
					invoice["id_user_penjual"] = 2
				case "item-seller":
					treeRecord(root, "items", "1")["id_user"] = 2
				case "excess-proceeds":
					invoice["dana_penjual_diterima"] = 1000000
				case "missing-escrow":
					delete(invoice, "escrow_status")
				}
				return nil
			}))
			shippingCall(t, FinishFulfillmentRTDB, buyer, map[string]interface{}{"rating": 5}, 409)
			root := snapshot()
			if numberValue(treeRecord(root, "users", "seller")["saldo_wallet"]) != 1000000 || numberValue(treeRecord(root, "users", "bob")["saldo_wallet"]) != 1000000 || treeRecord(root, "fulfillments", "FUL-1")["status"] != "dikirim" {
				t.Fatal("an inconsistent delivery released proceeds or was marked complete")
			}
		})
	}
}
