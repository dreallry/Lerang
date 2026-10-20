package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/coreapi"
)

func TestAdminPaymentListFiltersPaginatesAndExcludesSecrets(t *testing.T) {
	orders := map[string]interface{}{}
	for i := 1; i <= 25; i++ {
		id := fmt.Sprintf("TOPUP-%02d", i)
		orders[id] = map[string]interface{}{"order_id": id, "id_user": i, "amount": 100000, "kind": "topup", "status": "pending", "created_at": time.Now().Add(time.Duration(i) * time.Minute).UTC().Format(time.RFC3339), "snap_token": "private-snap", "owner_uid": "private-uid", "creation_id": "private-creation"}
	}
	orders["BAD"] = map[string]interface{}{"amount": -1, "status": "paid"}
	paymentRTDBFixture(t, map[string]interface{}{"paymentOrders": orders})
	for _, tc := range []struct {
		query                     string
		rows, total, page, review int
	}{
		{"", 20, 26, 1, 1}, {"?page=2", 6, 26, 2, 1}, {"?page=99&status=pending", 5, 25, 2, 1}, {"?q=TOPUP-02", 1, 1, 1, 0}, {"?status=review_required", 1, 1, 1, 1},
	} {
		w := httptest.NewRecorder()
		ListAdminPaymentsRTDB(w, httptest.NewRequest("GET", "/api/admin/payments"+tc.query, nil))
		var body struct {
			Data struct {
				Rows        []map[string]interface{}
				Total, Page int
				Counts      map[string]int
			}
		}
		requireNoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		if w.Code != 200 || len(body.Data.Rows) != tc.rows || body.Data.Total != tc.total || body.Data.Page != tc.page || body.Data.Counts["review_required"] != tc.review {
			t.Fatalf("invalid page for %s: %s", tc.query, w.Body)
		}
		for _, secret := range []string{"snap_token", "owner_uid", "creation_id", "private-"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatal("payment monitor exposed private gateway details")
			}
		}
	}
	for _, query := range []string{"?page=0", "?page=no", "?status=forged", "?q=" + strings.Repeat("a", 101)} {
		w := httptest.NewRecorder()
		ListAdminPaymentsRTDB(w, httptest.NewRequest("GET", "/api/admin/payments"+query, nil))
		if w.Code != 400 {
			t.Fatalf("invalid filter accepted: %s", query)
		}
	}
}

func TestAdminPaymentSyncUsesGatewayAndCreditsOnlyOnce(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
	requireNoError(t, err)
	orderID := stringValue(order["order_id"], "")
	snapshot := paymentRTDBFixture(t, root)
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	calls, gatewayStatus := 0, "pending"
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		calls++
		if !strings.HasSuffix(url, "/"+orderID+"/status") {
			t.Fatal("wrong gateway order")
		}
		*result.(*coreapi.TransactionStatusResponse) = coreapi.TransactionStatusResponse{OrderID: orderID, GrossAmount: "100000.00", Currency: "IDR", StatusCode: "200", TransactionStatus: gatewayStatus}
		return nil
	}}
	staff := &RTDBClaims{ID: 3, UID: "fixture-officer", Role: RolePetugas}
	for _, state := range []string{"pending", "settlement", "settlement", "refund", "settlement"} {
		gatewayStatus = state
		r := operationRequest("POST", `{"status":"paid","amount":1}`, "", staff)
		r.SetPathValue("orderID", orderID)
		w := httptest.NewRecorder()
		SyncAdminPaymentRTDB(w, r)
		if w.Code != 200 {
			t.Fatalf("sync %s: %d %s", state, w.Code, w.Body)
		}
		expected := float64(250000)
		if state == "pending" {
			expected = 150000
		}
		if numberValue(treeRecord(snapshot(), "users", "alice")["saldo_wallet"]) != expected {
			t.Fatal("gateway sync duplicated or invented funds")
		}
	}
	stored := treeRecord(snapshot(), "paymentOrders", orderID)
	if stored["status"] != "review_required" || stored["last_checked_at"] == nil || stored["last_checked_by"] != staff.UID {
		t.Fatal("financial review or audit metadata lost")
	}
	r := operationRequest("POST", "", "", paymentTestClaims())
	r.SetPathValue("orderID", orderID)
	w := httptest.NewRecorder()
	SyncAdminPaymentRTDB(w, r)
	if w.Code != 404 || calls != 5 {
		t.Fatal("participant gained staff reconciliation access")
	}
	other := *paymentTestClaims()
	other.UID = "another-user"
	r = operationRequest("POST", "", "", &other)
	r.SetPathValue("orderID", orderID)
	w = httptest.NewRecorder()
	SyncPaymentStatusRTDB(w, r)
	if w.Code != 404 || calls != 5 {
		t.Fatal("participant inspected another account payment")
	}
}

func TestReconciliationKeepsBalanceOnGatewayFailureAndRecordsSafeError(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
	requireNoError(t, err)
	id := stringValue(order["order_id"], "")
	snapshot := paymentRTDBFixture(t, root)
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		return &midtrans.Error{StatusCode: 401, Message: "private gateway detail"}
	}}
	_, err = reconcileRTDBPayment(t.Context(), id, "automatic")
	if err == nil {
		t.Fatal("gateway failure reported as success")
	}
	stored := treeRecord(snapshot(), "paymentOrders", id)
	if stored["status"] != "pending" || stored["last_checked_at"] == nil || stored["last_check_error"] == nil || strings.Contains(stringValue(stored["last_check_error"], ""), "private") || numberValue(treeRecord(snapshot(), "users", "alice")["saldo_wallet"]) != 150000 {
		t.Fatal("gateway failure changed funds or leaked details")
	}
}

func TestReconciliationRecordsAmountMismatchWithoutPartialCredit(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), testTopUpRequest(), time.Now(), "first")
	requireNoError(t, err)
	id := stringValue(order["order_id"], "")
	snapshot := paymentRTDBFixture(t, root)
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		*result.(*coreapi.TransactionStatusResponse) = coreapi.TransactionStatusResponse{OrderID: id, GrossAmount: "200000.00", Currency: "IDR", StatusCode: "200", TransactionStatus: "settlement"}
		return nil
	}}
	_, err = reconcileRTDBPayment(t.Context(), id, "fixture-officer")
	if err == nil {
		t.Fatal("mismatched gateway amount was accepted")
	}
	stored := treeRecord(snapshot(), "paymentOrders", id)
	if stored["status"] != "pending" || stored["last_checked_at"] == nil || stored["last_check_error"] == nil || numberValue(treeRecord(snapshot(), "users", "alice")["saldo_wallet"]) != 150000 || treeRecord(treeNode(snapshot(), "walletTransactions"), "alice", id)["status"] != "pending" {
		t.Fatal("failed verification left partial funds or no diagnostic")
	}
}
