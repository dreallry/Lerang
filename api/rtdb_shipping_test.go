package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func shippingFixture(t *testing.T) (func() map[string]interface{}, *RTDBClaims, *RTDBClaims) {
	t.Helper()
	now := time.Now()
	root := lifecycleRoot(now)
	buyer := lifecycleClaims(1, "alice", now)
	requireNoError(t, lockAuctionHold(root, buyer, "1", now))
	requireNoError(t, placeTreeBid(root, buyer, "1", 100000, now))
	requireNoError(t, settleAuction(root, "1", false, now))
	requireNoError(t, applyInvoicePayment(root, "1", "FIXTURE-PAID", now))
	return paymentRTDBFixture(t, root), buyer, &RTDBClaims{ID: 5, UID: "fixture-officer", Role: RolePetugas}
}

func shippingCall(t *testing.T, handler http.HandlerFunc, claims *RTDBClaims, body map[string]interface{}, want int) {
	t.Helper()
	payload, err := json.Marshal(body)
	requireNoError(t, err)
	w := httptest.NewRecorder()
	handler(w, operationRequest("POST", string(payload), "FUL-1", claims))
	if w.Code != want {
		t.Fatalf("shipping status=%d want=%d: %s", w.Code, want, w.Body)
	}
}

func shippingAddress() map[string]interface{} {
	return map[string]interface{}{"nama_penerima": "Fixture recipient", "telp_penerima": "081234567890", "alamat_lengkap": "Fixture address", "kota": "Fixture city", "kode_pos": "12345"}
}
func shippingQuote() map[string]interface{} {
	return map[string]interface{}{"kurir": "Fixture courier", "layanan_kurir": "Fixture service", "ongkir": 25000}
}

func TestPickupNeedsContactsAndHandoverButNoFakeAddressOrTracking(t *testing.T) {
	snapshot, buyer, staff := shippingFixture(t)
	shippingCall(t, UpdateFulfillmentCourierRTDB, buyer, map[string]interface{}{"kurir": pickupCourier, "layanan_kurir": pickupService, "ongkir": 0}, 200)
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, map[string]interface{}{"nama_penerima": "Fixture pickup", "telp_penerima": "081234567890"}, 200)
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, map[string]interface{}{"status": "diterima"}, 400)
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, map[string]interface{}{"status": "dikirim", "nomor_resi": "fake"}, 409)
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, map[string]interface{}{"status": "diterima", "deskripsi": "Diserahkan kepada penerima fixture"}, 200)
	order := treeRecord(snapshot(), "fulfillments", "FUL-1")
	if order["status"] != "diterima" || stringValue(order["nomor_resi"], "") != "" || stringValue(order["alamat_lengkap"], "") != "" || numberValue(treeRecord(snapshot(), "users", "seller")["saldo_wallet"]) != 1000000 {
		t.Fatal("pickup invented address/tracking or released proceeds without buyer confirmation")
	}
	shippingCall(t, FinishFulfillmentRTDB, staff, map[string]interface{}{"rating": 5}, 403)
	shippingCall(t, FinishFulfillmentRTDB, buyer, map[string]interface{}{"rating": 5, "ulasan": "Fixture received"}, 200)
	shippingCall(t, FinishFulfillmentRTDB, buyer, map[string]interface{}{"rating": 5, "ulasan": "Fixture received"}, 200)
	if numberValue(treeRecord(snapshot(), "users", "seller")["saldo_wallet"]) != 1095000 {
		t.Fatal("pickup seller payout was missing or duplicated")
	}
}

func TestCourierPaymentTrackingAndPayoutRemainSeparateAndIdempotent(t *testing.T) {
	snapshot, buyer, staff := shippingFixture(t)
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, shippingQuote(), 409)
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, shippingAddress(), 200)
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, shippingQuote(), 200)
	ship := map[string]interface{}{"status": "dikirim", "nomor_resi": "FIXTURE-AWB", "deskripsi": "Diserahkan ke ekspedisi fixture"}
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, ship, 409)
	receipt := map[string]interface{}{"reference": "FIXTURE-RECEIPT", "amount": 25000, "courier": "Fixture courier", "service": "Fixture service"}
	shippingCall(t, RecordShippingPaymentRTDB, buyer, receipt, 403)
	receipt["amount"] = 1
	shippingCall(t, RecordShippingPaymentRTDB, staff, receipt, 409)
	receipt["amount"] = 25000
	shippingCall(t, RecordShippingPaymentRTDB, staff, receipt, 200)
	count := len(treeRecord(snapshot(), "fulfillments", "FUL-1")["tracking_history"].([]interface{}))
	shippingCall(t, RecordShippingPaymentRTDB, staff, receipt, 200)
	if len(treeRecord(snapshot(), "fulfillments", "FUL-1")["tracking_history"].([]interface{})) != count {
		t.Fatal("receipt retry duplicated history")
	}
	changed := shippingQuote()
	changed["ongkir"] = 30000
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, changed, 409)
	address := shippingAddress()
	address["kota"] = "Changed city"
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, address, 409)
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, ship, 200)
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, map[string]interface{}{"status": "dikemas", "deskripsi": "Backward fixture"}, 409)
	ship["nomor_resi"] = "FIXTURE-CORRECTED"
	ship["deskripsi"] = "Koreksi resi dari bukti serah terima fixture"
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, ship, 200)
	count = len(treeRecord(snapshot(), "fulfillments", "FUL-1")["tracking_history"].([]interface{}))
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, ship, 200)
	if len(treeRecord(snapshot(), "fulfillments", "FUL-1")["tracking_history"].([]interface{})) != count {
		t.Fatal("tracking correction retry duplicated history")
	}
	shippingCall(t, UpdateFulfillmentResiRTDB, staff, map[string]interface{}{"status": "diterima", "deskripsi": "Bukti tiba dari kurir fixture"}, 200)
	shippingCall(t, FinishFulfillmentRTDB, buyer, map[string]interface{}{"rating": 5, "ulasan": "Fixture received"}, 200)
	root := snapshot()
	if numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 900000 || numberValue(treeRecord(root, "users", "seller")["saldo_wallet"]) != 1095000 || treeRecord(root, "fulfillments", "FUL-1")["shipping_payment_status"] != "paid_manual" || numberValue(treeRecord(root, "invoices", "1")["total_keseluruhan"]) != 110000 {
		t.Fatal("manual shipping receipt changed auction funds or payout")
	}
}

func TestAddressChangeInvalidatesUnpaidQuoteAndMismatchedRelationsBlockUpdates(t *testing.T) {
	snapshot, buyer, staff := shippingFixture(t)
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, shippingAddress(), 200)
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, shippingQuote(), 200)
	address := shippingAddress()
	address["kota"] = "New destination"
	shippingCall(t, UpdateFulfillmentAddressRTDB, buyer, address, 200)
	order := treeRecord(snapshot(), "fulfillments", "FUL-1")
	if order["kurir"] != nil || order["ongkir"] != nil || order["shipping_payment_status"] != nil {
		t.Fatal("new address retained stale courier charges")
	}
	requireNoError(t, rtdbTransaction(t.Context(), func(root map[string]interface{}) error {
		treeRecord(root, "fulfillments", "FUL-1")["id_user_pembeli"] = 99
		return nil
	}))
	shippingCall(t, UpdateFulfillmentCourierRTDB, staff, shippingQuote(), 409)
}
