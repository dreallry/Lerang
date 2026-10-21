package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func operationRequest(method, body, id string, claims *RTDBClaims) *http.Request {
	r := withRTDBClaims(httptest.NewRequest(method, "/api/fixture", strings.NewReader(body)), claims)
	r.SetPathValue("id", id)
	return r
}

func TestOfficerDraftWaitsForSessionBeforeOpening(t *testing.T) {
	now := time.Now()
	snapshot := paymentRTDBFixture(t, map[string]interface{}{})
	w := httptest.NewRecorder()
	CreateOfficerAuctionRTDB(w, operationRequest("POST", `{"barang":{"nama_barang":"Fixture lot draft","harga_awal":100000,"kategori":"Lainnya","foto_barang":["https://example.invalid/lot.jpg"]},"lelang":{"tgl_mulai":"","tgl_selesai":"","kelipatan_minimal":10000,"uang_jaminan":100000}}`, "", &RTDBClaims{ID: 3, Role: RolePetugas}))
	if w.Code != 201 {
		t.Fatalf("draft creation: %d %s", w.Code, w.Body)
	}
	root := snapshot()
	lot := treeRecord(root, "auctions", "1")
	if lot["status"] != "draft" || lot["tgl_mulai"] != "" || lot["tgl_selesai"] != "" {
		t.Fatal("a new pool lot went live before scheduling")
	}
	_ = sweepAuctions(root, now.Add(time.Hour))
	if lot["status"] != "draft" {
		t.Fatal("worker opened an unscheduled draft")
	}
	_, err := createSessionInTree(root, createSessionRequest{Judul: "Fixture scheduled", Tipe: "reguler", TglMulai: now.Add(2 * time.Hour).Format(time.RFC3339), Durasi: 2, IDLelangList: []int{1}}, &RTDBClaims{ID: 3, Role: RolePetugas}, now)
	requireNoError(t, err)
	if lot["status"] != "terjadwal" {
		t.Fatal("draft did not become scheduled")
	}
	requireNoError(t, sweepAuctions(root, now.Add(2*time.Hour+time.Minute)))
	if lot["status"] != "dibuka" {
		t.Fatal("worker did not open the scheduled draft")
	}
}

func TestOfficerDraftStoresManagedPhotoReferencesInRTDB(t *testing.T) {
	snapshot := paymentRTDBFixture(t, map[string]interface{}{})
	w := httptest.NewRecorder()
	body := `{"barang":{"nama_barang":"FIXTURE photos","harga_awal":100000,"kategori":"Lainnya","foto_barang":["/api/photos/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png","/api/photos/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg"]},"lelang":{"kelipatan_minimal":10000,"uang_jaminan":100000}}`
	CreateOfficerAuctionRTDB(w, operationRequest("POST", body, "", &RTDBClaims{ID: 3, Role: RolePetugas}))
	if w.Code != 201 {
		t.Fatalf("managed photo draft: %d %s", w.Code, w.Body)
	}
	item := treeRecord(snapshot(), "items", "1")
	photos, ok := item["foto_barang"].([]interface{})
	if !ok || len(photos) != 2 || photos[0] != "/api/photos/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" {
		t.Fatal("photo paths or cover order were lost in RTDB")
	}
}

func TestSessionCreationRollsBackWhenPreviousSessionCannotChange(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	lot := treeRecord(root, "auctions", "1")
	lot["status"], lot["id_sesi"] = "terjadwal", 10
	treeNode(root, "sessions")["10"] = map[string]interface{}{"id_sesi": 10, "status": "live", "tgl_mulai": now.Add(-time.Hour).Format(time.RFC3339Nano)}
	snapshot := paymentRTDBFixture(t, root)
	err := rtdbTransaction(context.Background(), func(tree map[string]interface{}) error {
		_, err := createSessionInTree(tree, createSessionRequest{Judul: "Fixture sesi", Tipe: "reguler", TglMulai: now.Add(time.Hour).Format(time.RFC3339Nano), Durasi: 2, IDLelangList: []int{1}}, &RTDBClaims{ID: 1, Role: RolePetugas}, now)
		return err
	})
	if err == nil || len(treeMap(snapshot()["sessions"])) != 1 || rtdbNumericID(treeRecord(snapshot(), "auctions", "1")["id_sesi"]) != 10 {
		t.Fatal("failed session creation left a partial session or reassigned a live lot")
	}
}

func TestSessionScheduleWorkerAndCancellationPersistTogether(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	lot := treeRecord(root, "auctions", "1")
	lot["status"] = "draft"
	session, err := createSessionInTree(root, createSessionRequest{Judul: "Fixture sesi", Tipe: "reguler", TglMulai: now.Add(time.Hour).Format(time.RFC3339Nano), Durasi: 2, IDLelangList: []int{1}}, &RTDBClaims{ID: 1, Role: RolePetugas}, now)
	requireNoError(t, err)
	id := rtdbNumericID(session["id_sesi"])
	if rtdbNumericID(lot["id_sesi"]) != id || lot["status"] != "terjadwal" {
		t.Fatal("session did not schedule its lot")
	}
	start := now.Add(time.Hour)
	requireNoError(t, sweepAuctions(root, start))
	if session["status"] != "live" || lot["status"] != "dibuka" {
		t.Fatal("worker did not open session and lot")
	}
	_ = sweepAuctions(root, start.Add(time.Second))
	if session["status"] != "live" {
		t.Fatal("worker closed an already live session")
	}
	alice := lifecycleClaims(1, "alice", start)
	requireNoError(t, lockAuctionHold(root, alice, "1", start))
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, start))
	requireNoError(t, cancelSessionInTree(root, id, start.Add(time.Minute)))
	requireNoError(t, cancelSessionInTree(root, id, start.Add(2*time.Minute)))
	if session["status"] != "closed" || lot["status"] != "dibatalkan" || len(treeMap(root["invoices"])) != 0 || numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 1000000 {
		t.Fatal("canceling a live session did not refund exactly once")
	}
}

func TestWithdrawalReviewRequiresStaffAndRefundsAtMostOnce(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	treeNode(root, "staff")["officer"] = map[string]interface{}{"uid": "officer", "id_petugas": 5, "id_level": 2, "role": string(RolePetugas), "active": true}
	id, err := requestWithdrawal(root, lifecycleClaims(1, "alice", now), withdrawRequest{Amount: 100000, Bank: "Fixture", Account: "1234567890", Holder: "Fixture", RequestID: "123e4567-e89b-42d3-a456-426614174000"}, now)
	requireNoError(t, err)
	snapshot := paymentRTDBFixture(t, root)
	for _, test := range []struct {
		claims *RTDBClaims
		body   string
		want   int
	}{
		{lifecycleClaims(1, "alice", now), `{"status":"rejected","reason":"fixture"}`, 403},
		{&RTDBClaims{ID: 5, UID: "officer", Role: RolePetugas}, `{"status":"paid"}`, 400},
		{&RTDBClaims{ID: 5, UID: "officer", Role: RolePetugas}, `{"status":"rejected","reason":"fixture"}`, 200},
		{&RTDBClaims{ID: 5, UID: "officer", Role: RolePetugas}, `{"status":"rejected","reason":"fixture"}`, 200},
		{&RTDBClaims{ID: 5, UID: "officer", Role: RolePetugas}, `{"status":"paid","reference":"fixture-transfer"}`, 409},
	} {
		w := httptest.NewRecorder()
		ReviewWithdrawalRTDB(w, operationRequest("POST", test.body, id, test.claims))
		if w.Code != test.want {
			t.Fatalf("review status=%d want=%d: %s", w.Code, test.want, w.Body)
		}
	}
	if numberValue(treeRecord(snapshot(), "users", "alice")["saldo_wallet"]) != 1000000 || treeRecord(snapshot(), "withdrawals", id)["status"] != "rejected" {
		t.Fatal("withdrawal refund was duplicated or final decision changed")
	}
}

func TestFulfillmentRejectsTamperedRatesOtherBuyerAndHistoricalWrites(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	alice := lifecycleClaims(1, "alice", now)
	requireNoError(t, lockAuctionHold(root, alice, "1", now))
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
	requireNoError(t, settleAuction(root, "1", false, now))
	requireNoError(t, applyInvoicePayment(root, "1", "FIXTURE", now))
	snapshot := paymentRTDBFixture(t, root)
	w := httptest.NewRecorder()
	UpdateFulfillmentCourierRTDB(w, operationRequest("POST", `{"kurir":"Fixture express","layanan_kurir":"One day","ongkir":1}`, "FUL-1", alice))
	if w.Code != 403 || treeRecord(snapshot(), "fulfillments", "FUL-1")["kurir"] != nil {
		t.Fatal("buyer supplied an arbitrary courier tariff")
	}
	w = httptest.NewRecorder()
	FinishFulfillmentRTDB(w, operationRequest("POST", `{"rating":5,"ulasan":"fixture"}`, "FUL-1", lifecycleClaims(2, "bob", now)))
	if w.Code != 403 || numberValue(treeRecord(snapshot(), "users", "seller")["saldo_wallet"]) != 1000000 {
		t.Fatal("another participant released seller proceeds")
	}
	requireNoError(t, rtdbTransaction(context.Background(), func(tree map[string]interface{}) error {
		treeRecord(tree, "fulfillments", "FUL-1")["legacy_historical"] = true
		return nil
	}))
	w = httptest.NewRecorder()
	UpdateFulfillmentAddressRTDB(w, operationRequest("POST", `{"nama_penerima":"Fixture","telp_penerima":"081234567890","alamat_lengkap":"Fixture address","kota":"Fixture city","kode_pos":"12345"}`, "FUL-1", alice))
	if w.Code != 409 || treeRecord(snapshot(), "fulfillments", "FUL-1")["alamat_lengkap"] != nil {
		t.Fatal("historical fulfillment was changed")
	}
}

func TestConcurrentRegistrationKeepsOneProfileAndConsistentIndex(t *testing.T) {
	snapshot := paymentRTDBFixture(t, map[string]interface{}{})
	var group sync.WaitGroup
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			w := httptest.NewRecorder()
			RegisterMasyarakatRTDB(w, registrationRequest(false))
			if w.Code != 200 && w.Code != 201 {
				t.Errorf("registration: %d %s", w.Code, w.Body)
			}
		}()
	}
	group.Wait()
	root := snapshot()
	if len(treeMap(root["users"])) != 1 || len(treeMap(root["user_ids"])) != 1 || userUID(root, 1) != "new-uid" {
		t.Fatal("concurrent registration duplicated user ID or left a stale index")
	}
}

func TestLegacyIdentityAttachmentMovesHistoryWithBalances(t *testing.T) {
	root := map[string]interface{}{}
	treeNode(root, "legacy_users")["7"] = map[string]interface{}{"id_user": 7, "email": "fixture@example.invalid", "saldo_wallet": 450000, "saldo_hold": 0, "requires_identity_link": true}
	treeNode(root, "legacy_notifications", "7")["notice"] = map[string]interface{}{"id_user": 7, "judul": "Fixture"}
	treeNode(root, "legacy_walletTransactions", "7")["ledger"] = map[string]interface{}{"id_user": 7, "nominal": 450000, "status": "sukses"}
	snapshot := paymentRTDBFixture(t, root)
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, registrationRequest(true))
	if w.Code != 200 {
		t.Fatalf("legacy attach: %d %s", w.Code, w.Body)
	}
	saved := snapshot()
	if treeRecord(saved, "legacy_users", "7") != nil || treeRecord(saved, "users", "new-uid")["requires_identity_link"] != false || numberValue(treeRecord(saved, "users", "new-uid")["saldo_wallet"]) != 450000 || treeRecord(treeNode(saved, "walletTransactions"), "new-uid", "ledger")["owner_uid"] != "new-uid" || treeRecord(treeNode(saved, "notifications"), "new-uid", "notice") == nil {
		t.Fatal("identity attachment lost or duplicated legacy data")
	}
}

func TestMoneyGuardsRejectMalformedBalancesAndOverflow(t *testing.T) {
	now := time.Now()
	for _, value := range []interface{}{nil, "invalid", -1, 1.5, true} {
		root := lifecycleRoot(now)
		treeRecord(root, "users", "alice")["saldo_wallet"] = value
		if _, err := transactionProfile(root, lifecycleClaims(1, "alice", now)); err == nil {
			t.Fatalf("malformed balance accepted: %v", value)
		}
	}
	if validAuctionAmount(9_999_999_999_999) {
		t.Fatal("auction premium overflow accepted")
	}
	root := lifecycleRoot(now)
	treeNode(root, "user_ids")["1"] = "bob"
	if userUID(root, 1) != "alice" {
		t.Fatal("stale user index redirected ownership")
	}
}
