package api

import (
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestCurationRejectDoesNotRequirePublishableLegacyAttachments(t *testing.T) {
	for _, field := range []string{"dokumen_pendukung", "foto_barang", "harga_awal"} {
		t.Run(field, func(t *testing.T) {
			item := pendingReviewItem()
			item["firebase_uid"] = "seller"
			item["foto_barang"] = []string{"https://example.invalid/photo.jpg"}
			item[field] = []string{"Invoice pembelian", "Dustbag", "Hermes Box"}
			if field == "harga_awal" {
				item[field] = 50000
			}
			root := map[string]interface{}{"items": map[string]interface{}{"1": item}}
			treeNode(root, "users")["seller"] = map[string]interface{}{"id_user": 3}
			snapshot := paymentRTDBFixture(t, root)
			before := treeRecord(snapshot(), "items", "1")[field]
			w := httptest.NewRecorder()
			ValidateBarangRTDB(w, operationRequest("POST", `{"status":"rejected","catatan_kurasi":"Perbaiki lampiran barang","expected_updated_at":"2026-10-20T09:00:00Z"}`, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			if w.Code != 200 {
				t.Fatalf("rejection was incorrectly blocked by item publication validation: %d %s", w.Code, w.Body)
			}
			saved := snapshot()
			row := treeRecord(saved, "items", "1")
			if row["status_verifikasi"] != "rejected" || row["catatan_kurasi"] != "Perbaiki lampiran barang" || row["updated_at"] == item["updated_at"] || !reflect.DeepEqual(before, row[field]) || len(treeMap(saved["auctions"])) != 0 {
				t.Fatal("rejection changed item contents, lost its note/version, or created an auction")
			}
			if len(treeMap(treeMap(saved["notifications"])["seller"])) != 1 {
				t.Fatal("seller did not receive the rejection decision")
			}
		})
	}
}

func TestCurationApprovalChecksProposedReserveAndPreservesFailedItems(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		oldReserve, proposed int
		want                 int
	}{
		{"repair old reserve", 50000, 200000, 200},
		{"clear old reserve", 50000, 0, 200},
		{"reject new low reserve", 200000, 50000, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item := pendingReviewItem()
			item["reserve_price"] = tc.oldReserve
			snapshot := paymentRTDBFixture(t, map[string]interface{}{"items": map[string]interface{}{"1": item}})
			w := httptest.NewRecorder()
			body := fmt.Sprintf(`{"status":"approved","reserve_price":%d,"kelipatan_minimal":10000,"uang_jaminan":100000,"expected_updated_at":"2026-10-20T09:00:00Z"}`, tc.proposed)
			ValidateBarangRTDB(w, operationRequest("POST", body, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			if w.Code != tc.want {
				t.Fatalf("approval validated old rather than proposed terms: %d %s", w.Code, w.Body)
			}
			saved := snapshot()
			row := treeRecord(saved, "items", "1")
			if tc.want == 200 {
				if row["status_verifikasi"] != "approved" || numberValue(row["reserve_price"]) != float64(tc.proposed) || len(treeMap(saved["auctions"])) != 1 {
					t.Fatal("approved terms and the new draft disagree")
				}
			} else if row["status_verifikasi"] != "pending" || numberValue(row["reserve_price"]) != float64(tc.oldReserve) || len(treeMap(saved["auctions"])) != 0 {
				t.Fatal("a failed approval changed the pending item")
			}
		})
	}
}

func TestCurationApprovalStillRejectsInvalidDocumentLinks(t *testing.T) {
	item := pendingReviewItem()
	item["dokumen_pendukung"] = []string{"Invoice pembelian"}
	snapshot := paymentRTDBFixture(t, map[string]interface{}{"items": map[string]interface{}{"1": item}})
	w := httptest.NewRecorder()
	ValidateBarangRTDB(w, operationRequest("POST", `{"status":"approved","kelipatan_minimal":10000,"uang_jaminan":100000,"expected_updated_at":"2026-10-20T09:00:00Z"}`, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
	if w.Code != 400 || !strings.Contains(w.Body.String(), "dokumen") || treeRecord(snapshot(), "items", "1")["status_verifikasi"] != "pending" || len(treeMap(snapshot()["auctions"])) != 0 {
		t.Fatalf("invalid attachment was published or not explained: %d %s", w.Code, w.Body)
	}
}

func TestCurationCannotCreateOrInvalidateAnExistingLot(t *testing.T) {
	for _, decision := range []string{"approved", "rejected"} {
		t.Run(decision, func(t *testing.T) {
			root := map[string]interface{}{"items": map[string]interface{}{"1": pendingReviewItem()}}
			treeNode(root, "auctions")["8"] = map[string]interface{}{"id_lelang": 8, "id_barang": 1, "status": "dibuka"}
			snapshot := paymentRTDBFixture(t, root)
			body := fmt.Sprintf(`{"status":%q,"catatan_kurasi":"Fixture decision","kelipatan_minimal":10000,"uang_jaminan":100000,"expected_updated_at":"2026-10-20T09:00:00Z"}`, decision)
			w := httptest.NewRecorder()
			ValidateBarangRTDB(w, operationRequest("POST", body, "1", &RTDBClaims{ID: 5, Role: RolePetugas}))
			saved := snapshot()
			if w.Code != 409 || len(treeMap(saved["auctions"])) != 1 || treeRecord(saved, "items", "1")["status_verifikasi"] != "pending" {
				t.Fatalf("curation duplicated or invalidated an existing auction: %d %s", w.Code, w.Body)
			}
		})
	}
}

func TestCurationRepairLegacyDocumentsThenApprove(t *testing.T) {
	item := pendingReviewItem()
	item["dokumen_pendukung"] = []string{"Invoice pembelian", "Dustbag"}
	snapshot := paymentRTDBFixture(t, map[string]interface{}{"items": map[string]interface{}{"1": item}})
	staff := &RTDBClaims{ID: 5, Role: RolePetugas}
	w := httptest.NewRecorder()
	UpdateBarangInfoRTDB(w, operationRequest("PUT", `{"dokumen_pendukung":["https://example.invalid/invoice.pdf"],"expected_updated_at":"2026-10-20T09:00:00Z"}`, "1", staff))
	if w.Code != 200 {
		t.Fatalf("curator could not repair legacy document names: %d %s", w.Code, w.Body)
	}
	version := itemRevision(treeRecord(snapshot(), "items", "1"))
	w = httptest.NewRecorder()
	body := fmt.Sprintf(`{"status":"approved","kelipatan_minimal":10000,"uang_jaminan":100000,"expected_updated_at":%q}`, version)
	ValidateBarangRTDB(w, operationRequest("POST", body, "1", staff))
	if w.Code != 200 || treeRecord(snapshot(), "items", "1")["status_verifikasi"] != "approved" || len(treeMap(snapshot()["auctions"])) != 1 {
		t.Fatalf("repaired submission could not enter the lot pool: %d %s", w.Code, w.Body)
	}
}
