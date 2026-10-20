package api

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	firebase "firebase.google.com/go/v4"
	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/coreapi"
	"github.com/midtrans/midtrans-go/snap"
	"google.golang.org/api/option"
)

func paymentTestRoot() map[string]interface{} {
	return map[string]interface{}{
		"users":    map[string]interface{}{"alice": map[string]interface{}{"id_user": 7, "saldo_wallet": 150000, "saldo_hold": 50000}},
		"user_ids": map[string]interface{}{"7": "alice"},
		"auctions": map[string]interface{}{"4": map[string]interface{}{"id_lelang": 4, "id_barang": 3, "id_user": 7, "status": "ditutup"}},
		"invoices": map[string]interface{}{"1": map[string]interface{}{"id_pembayaran": 1, "id_lelang": 4, "id_barang": 3, "id_user": 7, "order_id": "INV-1", "sisa_tagihan": 250000, "status": "Belum Dibayar", "batas_pembayaran": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}},
	}
}

func paymentTestClaims() *RTDBClaims {
	return &RTDBClaims{ID: 7, UID: "alice", Role: RoleMasyarakat, Nama: "Fixture participant", EmailVerified: true}
}

func testTopUpRequest() PaymentSnapRequest {
	return PaymentSnapRequest{TipePembayaran: "topup", JumlahTagihan: 100000, RequestID: "123e4567-e89b-42d3-a456-426614174000"}
}

func testPaymentNotification(orderID, status string) midtransNotification {
	return midtransNotification{OrderID: orderID, StatusCode: "200", GrossAmount: "100000.00", Currency: "IDR", TransactionStatus: status, PaymentType: "bank_transfer"}
}

func TestRTDBInvoicePaymentUsesServerAmountAndRejectsUnavailableInvoices(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), PaymentSnapRequest{IDPembayaran: 1, JumlahTagihan: 1}, time.Now(), "first")
	if err != nil || numberValue(order["amount"]) != 250000 {
		t.Fatalf("client amount replaced the invoice: %v %v", order, err)
	}
	for _, state := range []string{"Sudah Dibayar", "Kadaluarsa", "Wanprestasi", "historical", "expired", "wrong-owner", "unverified"} {
		t.Run(state, func(t *testing.T) {
			root, claims := paymentTestRoot(), paymentTestClaims()
			invoice := treeRecord(root, "invoices", "1")
			switch state {
			case "historical":
				treeRecord(root, "auctions", "4")["legacy_historical"] = true
			case "expired":
				invoice["batas_pembayaran"] = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
			case "wrong-owner":
				invoice["id_user"] = 99
			case "unverified":
				claims.EmailVerified = false
			default:
				invoice["status"] = state
			}
			if _, err := reserveRTDBPayment(root, claims, PaymentSnapRequest{IDPembayaran: 1}, time.Now(), "attempt"); err == nil {
				t.Fatal("unavailable invoice was accepted")
			}
			if len(treeMap(root["paymentOrders"])) != 0 {
				t.Fatal("rejected request reserved a payment order")
			}
		})
	}
}

func TestRTDBTopUpReservationIsStableAndPreventsDuplicateCreation(t *testing.T) {
	root, claims, req := paymentTestRoot(), paymentTestClaims(), testTopUpRequest()
	first, err := reserveRTDBPayment(root, claims, req, time.Now(), "first")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reserveRTDBPayment(root, claims, req, time.Now(), "second"); err == nil {
		t.Fatal("concurrent Snap creation must be rejected")
	}
	first["snap_token"] = "fixture-token"
	if treeRecord(treeNode(root, "walletTransactions"), claims.UID, stringValue(first["order_id"], ""))["request_id"] != req.RequestID {
		t.Fatal("pending top up cannot be resumed after a page reload")
	}
	retry, err := reserveRTDBPayment(root, claims, req, time.Now(), "retry")
	if err != nil || retry["order_id"] != first["order_id"] || retry["snap_token"] != "fixture-token" {
		t.Fatalf("retry did not reuse order/token: %v %v", retry, err)
	}
	req.JumlahTagihan++
	if _, err := reserveRTDBPayment(root, claims, req, time.Now(), "changed-amount"); err == nil {
		t.Fatal("same request ID must not change amount")
	}
	if len(treeMap(root["paymentOrders"])) != 1 || len(treeNode(root, "walletTransactions", claims.UID)) != 1 {
		t.Fatal("retry created duplicate ledger entries")
	}
}

func TestRTDBTopUpOnlyCreditsVerifiedSettlementOnce(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
	if err != nil {
		t.Fatal(err)
	}
	orderID := stringValue(order["order_id"], "")
	for _, status := range []string{"pending", "expire", "settlement", "settlement", "expire", "pending"} {
		if err := applyRTDBPaymentNotification(root, testPaymentNotification(orderID, status), time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if got := numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]); got != 250000 {
		t.Fatalf("wallet = %.0f, want 250000 after duplicate/out-of-order events", got)
	}
	if order["status"] != "paid" {
		t.Fatal("late failure downgraded a paid order")
	}
	if err := applyRTDBPaymentNotification(root, testPaymentNotification(orderID, "refund"), time.Now()); err != nil {
		t.Fatal(err)
	}
	if order["status"] != "review_required" || treeRecord(root, "users", "alice")["financial_review_required"] != true {
		t.Fatal("refund was not retained for financial reconciliation")
	}
	if numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 250000 {
		t.Fatal("refund arbitrarily changed already credited funds")
	}
}

func TestRTDBPaymentRejectsAmountCurrencyAndUnknownOrders(t *testing.T) {
	for _, change := range []string{"amount", "currency", "fraction", "unknown", "capture-challenge", "status-code"} {
		t.Run(change, func(t *testing.T) {
			root := paymentTestRoot()
			order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
			if err != nil {
				t.Fatal(err)
			}
			n := testPaymentNotification(stringValue(order["order_id"], ""), "settlement")
			switch change {
			case "amount":
				n.GrossAmount = "1.00"
			case "currency":
				n.Currency = "USD"
			case "fraction":
				n.GrossAmount = "100000.01"
			case "unknown":
				n.OrderID = "unknown-order"
			case "capture-challenge":
				n.TransactionStatus, n.FraudStatus = "capture", "challenge"
			case "status-code":
				n.StatusCode = "201"
			}
			err = applyRTDBPaymentNotification(root, n, time.Now())
			if change != "capture-challenge" && err == nil {
				t.Fatal("invalid notification was accepted")
			}
			if numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 150000 || order["status"] != "pending" {
				t.Fatal("invalid/pending notification changed spendable balance")
			}
		})
	}
}

func TestRTDBLateInvoiceSettlementRequiresReview(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), PaymentSnapRequest{IDPembayaran: 1}, time.Now(), "first")
	if err != nil {
		t.Fatal(err)
	}
	treeRecord(root, "invoices", "1")["status"] = "Wanprestasi"
	n := testPaymentNotification("INV-1", "settlement")
	n.GrossAmount = "250000.00"
	if err := applyRTDBPaymentNotification(root, n, time.Now()); err != nil {
		t.Fatal(err)
	}
	if order["status"] != "review_required" || treeRecord(root, "invoices", "1")["payment_review_required"] != true || len(treeMap(root["fulfillments"])) != 0 {
		t.Fatal("late settlement must not deliver an item reassigned to another bidder")
	}
}

type paymentGatewayFixture struct {
	call func(string, string, io.Reader, interface{}) *midtrans.Error
}

func (f paymentGatewayFixture) Call(method, url string, key *string, options *midtrans.ConfigOptions, body io.Reader, result interface{}) *midtrans.Error {
	return f.call(method, url, body, result)
}

// The REST fixture implements ETags, so handler tests exercise the real Admin SDK transaction path.
func paymentRTDBFixture(t *testing.T, root map[string]interface{}) func() map[string]interface{} {
	t.Helper()
	var mu sync.Mutex
	version := 1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		etag := fmt.Sprintf(`"v%d"`, version)
		w.Header().Set("ETag", etag)
		switch r.Method {
		case http.MethodGet:
			var value interface{} = root
			for _, part := range strings.Split(strings.Trim(strings.TrimSuffix(r.URL.Path, ".json"), "/"), "/") {
				if part != "" {
					value = treeMap(value)[part]
				}
			}
			_ = json.NewEncoder(w).Encode(value)
		case http.MethodPut:
			if r.Header.Get("if-match") != etag {
				w.WriteHeader(http.StatusPreconditionFailed)
				_ = json.NewEncoder(w).Encode(root)
				return
			}
			if err := json.NewDecoder(r.Body).Decode(&root); err != nil {
				t.Error(err)
			}
			version++
			_ = json.NewEncoder(w).Encode(root)
		default:
			t.Errorf("unexpected Firebase method: %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("FIREBASE_DATABASE_EMULATOR_HOST", strings.Replace(server.URL, "http://127.0.0.1", "localhost", 1)+"?ns=payment-fixture")
	app, err := firebase.NewApp(context.Background(), &firebase.Config{ProjectID: "payment-fixture", DatabaseURL: "https://payment-fixture.firebaseio.com"}, option.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatal(err)
	}
	client, err := app.Database(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	previous := firebaseDatabaseClient
	firebaseDatabaseClient = client
	t.Cleanup(func() { firebaseDatabaseClient = previous })
	return func() map[string]interface{} {
		mu.Lock()
		defer mu.Unlock()
		data, _ := json.Marshal(root)
		var snapshot map[string]interface{}
		if err := json.Unmarshal(data, &snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
}

func TestRTDBSnapPersistsBeforeGatewayAndReusesToken(t *testing.T) {
	snapshot := paymentRTDBFixture(t, paymentTestRoot())
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", clientKey: "fixture-client", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	calls := 0
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		calls++
		var request snap.Request
		if err := json.NewDecoder(body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		root := snapshot()
		if treeRecord(root, "paymentOrders", request.TransactionDetails.OrderID) == nil || treeRecord(treeNode(root, "walletTransactions"), "alice", request.TransactionDetails.OrderID) == nil {
			t.Fatal("Snap was called before the order and wallet ledger were persisted")
		}
		response := result.(*snap.Response)
		response.Token, response.RedirectURL = "fixture-token", "https://example.invalid/snap"
		return nil
	}}
	for i := 0; i < 2; i++ {
		body, _ := json.Marshal(testTopUpRequest())
		r := withRTDBClaims(httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap", bytes.NewReader(body)), paymentTestClaims())
		w := httptest.NewRecorder()
		CreateSnapPaymentRTDB(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: %d %s", i, w.Code, w.Body)
		}
	}
	if calls != 1 || len(treeMap(snapshot()["paymentOrders"])) != 1 {
		t.Fatalf("gateway calls=%d, expected one persisted order/token", calls)
	}
}

func TestRTDBWebhookAcceptsGatewayFieldsButUsesAuthoritativeStatus(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
	if err != nil {
		t.Fatal(err)
	}
	orderID := stringValue(order["order_id"], "")
	snapshot := paymentRTDBFixture(t, root)
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		if method != http.MethodGet || !strings.HasSuffix(url, "/"+orderID+"/status") {
			t.Fatalf("unexpected gateway call: %s %s", method, url)
		}
		*result.(*coreapi.TransactionStatusResponse) = coreapi.TransactionStatusResponse{OrderID: orderID, GrossAmount: "100000.00", Currency: "IDR", StatusCode: "201", TransactionStatus: "pending"}
		return nil
	}}
	sum := sha512.Sum512([]byte(orderID + "200" + "100000.00" + midtransConfig.serverKey))
	payload, _ := json.Marshal(map[string]interface{}{"order_id": orderID, "status_code": "200", "gross_amount": "100000.00", "currency": "IDR", "transaction_status": "settlement", "signature_key": hex.EncodeToString(sum[:]), "transaction_id": "fixture-gateway-id", "va_numbers": []map[string]string{{"bank": "bca", "va_number": "fixture"}}})
	w := httptest.NewRecorder()
	MidtransWebhookRTDB(w, httptest.NewRequest(http.MethodPost, "/api/midtrans/webhook", bytes.NewReader(payload)))
	if w.Code != http.StatusOK {
		t.Fatalf("gateway fields were rejected: %d %s", w.Code, w.Body)
	}
	if numberValue(treeRecord(snapshot(), "users", "alice")["saldo_wallet"]) != 150000 {
		t.Fatal("browser/webhook paid claim overrode canonical pending status")
	}
}
