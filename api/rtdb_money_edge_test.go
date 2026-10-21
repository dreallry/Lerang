package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/snap"
)

func TestRTDBReviewInvoiceKeepsDepositAndWinnerAtDeadline(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	for id, uid := range map[int]string{1: "alice", 2: "bob"} {
		requireNoError(t, lockAuctionHold(root, lifecycleClaims(id, uid, now), "1", now))
	}
	requireNoError(t, placeTreeBid(root, lifecycleClaims(1, "alice", now), "1", 100000, now))
	requireNoError(t, placeTreeBid(root, lifecycleClaims(2, "bob", now), "1", 150000, now.Add(time.Second)))
	requireNoError(t, settleAuction(root, "1", false, now))
	invoice := treeRecord(root, "invoices", "1")
	invoice["payment_review_required"] = true
	before, _ := json.Marshal(root)
	if err := sweepAuctions(root, now.Add(25*time.Hour)); err != nil && err != errNoLifecycleWork {
		t.Fatal(err)
	}
	after, _ := json.Marshal(root)
	if !bytes.Equal(before, after) {
		t.Fatal("financial review must not forfeit a deposit or promote another winner")
	}
	if err := applyInvoicePayment(root, "1", "FIXTURE", now.Add(time.Minute)); err == nil {
		t.Fatal("an invoice awaiting financial review must not complete fulfillment")
	}
}

func TestRTDBFrozenParticipantDoesNotForfeitWhileUnableToPay(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	claims := lifecycleClaims(1, "alice", now)
	requireNoError(t, lockAuctionHold(root, claims, "1", now))
	requireNoError(t, placeTreeBid(root, claims, "1", 100000, now))
	requireNoError(t, settleAuction(root, "1", false, now))
	treeRecord(root, "users", "alice")["financial_review_required"] = true
	before, _ := json.Marshal(root)
	if err := sweepAuctions(root, now.Add(25*time.Hour)); err != nil && err != errNoLifecycleWork {
		t.Fatal(err)
	}
	after, _ := json.Marshal(root)
	if !bytes.Equal(before, after) {
		t.Fatal("an account blocked from paying must keep its deposit pending financial review")
	}
}

func TestRTDBSnapTokenSurvivesClientCancellation(t *testing.T) {
	snapshot := paymentRTDBFixture(t, paymentTestRoot())
	previousConfig, previousClient := midtransConfig, SnapClient
	midtransConfig = midtransSettings{serverKey: "fixture-key", clientKey: "fixture-client", environment: midtrans.Sandbox, ready: true}
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
		calls++
		result.(*snap.Response).Token = "fixture-token"
		result.(*snap.Response).RedirectURL = "https://example.invalid/snap"
		cancel()
		return nil
	}}
	body, _ := json.Marshal(testTopUpRequest())
	r := withRTDBClaims(httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap", bytes.NewReader(body)).WithContext(ctx), paymentTestClaims())
	CreateSnapPaymentRTDB(httptest.NewRecorder(), r)
	for _, value := range treeMap(snapshot()["paymentOrders"]) {
		if stringValue(treeMap(value)["snap_token"], "") != "fixture-token" {
			t.Fatal("gateway token was lost when the client left the page")
		}
	}
	body, _ = json.Marshal(testTopUpRequest())
	w := httptest.NewRecorder()
	CreateSnapPaymentRTDB(w, withRTDBClaims(httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap", bytes.NewReader(body)), paymentTestClaims()))
	if w.Code != http.StatusOK || calls != 1 {
		t.Fatalf("retry must reuse the saved token: response=%d gateway calls=%d", w.Code, calls)
	}
}

func TestRTDBSnapTokenContinuationPreservesReservationAcrossRoleChange(t *testing.T) {
	for _, change := range []string{"promoted", "owner-changed"} {
		t.Run(change, func(t *testing.T) {
			snapshot := paymentRTDBFixture(t, paymentTestRoot())
			previousConfig, previousClient := midtransConfig, SnapClient
			midtransConfig = midtransSettings{serverKey: "fixture-key", clientKey: "fixture-client", environment: midtrans.Sandbox, ready: true}
			t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
			orderID := ""
			SnapClient.HttpClient = paymentGatewayFixture{call: func(method, url string, body io.Reader, result interface{}) *midtrans.Error {
				var request snap.Request
				requireNoError(t, json.NewDecoder(body).Decode(&request))
				orderID = request.TransactionDetails.OrderID
				requireNoError(t, rtdbTransaction(context.Background(), func(root map[string]interface{}) error {
					if change == "promoted" {
						treeNode(root, "staff")["alice"] = map[string]interface{}{"uid": "alice", "id_petugas": 7, "id_level": 2, "role": "petugas", "active": true}
					} else {
						treeRecord(root, "paymentOrders", orderID)["owner_uid"] = "another-participant"
					}
					return nil
				}))
				result.(*snap.Response).Token = "fixture-token"
				return nil
			}}
			body, _ := json.Marshal(testTopUpRequest())
			w := httptest.NewRecorder()
			CreateSnapPaymentRTDB(w, withRTDBClaims(httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap", bytes.NewReader(body)), paymentTestClaims()))
			order := treeRecord(snapshot(), "paymentOrders", orderID)
			if change == "promoted" {
				if w.Code != http.StatusOK || order["snap_token"] != "fixture-token" {
					t.Fatalf("authorized gateway continuation lost its token after role change: %d", w.Code)
				}
			} else if w.Code != http.StatusConflict || order["snap_token"] != nil {
				t.Fatal("gateway continuation wrote a token after its reservation owner changed")
			}
		})
	}
}

func TestRTDBConflictingInvoiceSettlementFreezesParticipant(t *testing.T) {
	root := paymentTestRoot()
	order, err := reserveRTDBPayment(root, paymentTestClaims(), PaymentSnapRequest{IDPembayaran: 1}, time.Now(), "first")
	requireNoError(t, err)
	treeRecord(root, "invoices", "1")["order_id"] = "INV-1-2"
	n := testPaymentNotification(stringValue(order["order_id"], ""), "settlement")
	n.GrossAmount = "250000.00"
	requireNoError(t, applyRTDBPaymentNotification(root, n, time.Now()))
	if treeRecord(root, "users", "alice")["financial_review_required"] != true {
		t.Fatal("a conflicting paid attempt must freeze new financial operations during review")
	}
}

func TestRTDBProxyEqualCapsKeepEarlierTimestampAcrossFractionalPrecision(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	for id, uid := range map[int]string{1: "alice", 2: "bob"} {
		requireNoError(t, lockAuctionHold(root, lifecycleClaims(id, uid, now), "1", now))
	}
	auction, item := treeRecord(root, "auctions", "1"), treeRecord(root, "items", "1")
	treeNode(root, "autoBids", "1")["alice"] = map[string]interface{}{"max_amount": 500000, "created_at": now.Format(time.RFC3339Nano)}
	resolveProxyBids(root, auction, item, now)
	treeNode(root, "autoBids", "1")["bob"] = map[string]interface{}{"max_amount": 500000, "created_at": now.Add(500 * time.Millisecond).Format(time.RFC3339Nano)}
	resolveProxyBids(root, auction, item, now.Add(time.Second))
	if rtdbNumericID(auction["id_user"]) != 1 || numberValue(auction["harga_akhir"]) != 500000 {
		t.Fatal("later equal proxy cap overtook the earlier bidder because of timestamp string ordering")
	}
}

func TestRTDBLifecycleIsolatesCorruptAuctionFromHealthySettlement(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	broken := treeRecord(root, "auctions", "1")
	broken["tgl_selesai"] = now.Add(-time.Second).Format(time.RFC3339Nano)
	broken["id_barang"] = 999
	healthy := map[string]interface{}{}
	for key, value := range broken {
		healthy[key] = value
	}
	healthy["id_lelang"], healthy["id_barang"] = 2, 1
	treeNode(root, "auctions")["2"] = healthy
	snapshot := paymentRTDBFixture(t, root)
	if err := runAuctionLifecycle(context.Background(), func() time.Time { return now }); err == nil {
		t.Fatal("corrupt auction was not reported")
	}
	after := snapshot()
	if treeRecord(after, "auctions", "2")["status"] != "ditutup" || treeRecord(after, "auctions", "1")["settled_at"] != nil {
		t.Fatal("one corrupt lot rolled back a healthy lot or left a partial settlement")
	}
}

func TestRTDBHundredConcurrentDepositsConserveWallets(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	claims := make([]*RTDBClaims, 100)
	for i := range claims {
		uid, id := fmt.Sprintf("fixture-%d", i), i+10
		treeNode(root, "users")[uid] = map[string]interface{}{"id_user": id, "saldo_wallet": 100000, "saldo_hold": 0}
		treeNode(root, "user_ids")[rtdbPathID(id)] = uid
		claims[i] = lifecycleClaims(id, uid, now)
	}
	snapshot := paymentRTDBFixture(t, root)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	start := make(chan struct{})
	var group sync.WaitGroup
	for _, participant := range claims {
		group.Add(1)
		go func(participant *RTDBClaims) {
			defer group.Done()
			<-start
			if err := rtdbTransaction(ctx, func(tree map[string]interface{}) error {
				return lockAuctionHold(tree, participant, "1", time.Now())
			}); err != nil {
				t.Errorf("concurrent participant deposit: %v", err)
			}
		}(participant)
	}
	close(start)
	group.Wait()
	after := snapshot()
	if len(treeMap(treeMap(after["holds"])["1"])) != len(claims) {
		t.Fatal("concurrent participants lost deposit records")
	}
	for _, participant := range claims {
		profile := treeRecord(after, "users", participant.UID)
		if numberValue(profile["saldo_wallet"]) != 0 || numberValue(profile["saldo_hold"]) != 100000 || len(treeMap(treeMap(after["walletTransactions"])[participant.UID])) != 1 {
			t.Fatal("deposit burst lost money or recorded a duplicate debit")
		}
	}
}

func TestRTDBBidAndDuplicateClosuresProduceOneConsistentInvoice(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	alice, bob := lifecycleClaims(1, "alice", now), lifecycleClaims(2, "bob", now)
	requireNoError(t, lockAuctionHold(root, alice, "1", now))
	requireNoError(t, lockAuctionHold(root, bob, "1", now))
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
	snapshot := paymentRTDBFixture(t, root)
	var group sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 10; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			if err := rtdbTransaction(context.Background(), func(tree map[string]interface{}) error {
				return settleAuction(tree, "1", false, now)
			}); err != nil {
				t.Errorf("duplicate close: %v", err)
			}
		}()
	}
	group.Add(1)
	go func() {
		defer group.Done()
		<-start
		err := rtdbTransaction(context.Background(), func(tree map[string]interface{}) error {
			return placeTreeBid(tree, bob, "1", 150000, now)
		})
		var conflict *transactionError
		if err != nil && (!errors.As(err, &conflict) || conflict.status != 409) {
			t.Errorf("competing bid: %v", err)
		}
	}()
	close(start)
	group.Wait()
	after := snapshot()
	auction, invoice := treeRecord(after, "auctions", "1"), treeRecord(after, "invoices", "1")
	if len(treeMap(after["invoices"])) != 1 || auction["status"] != "ditutup" || rtdbNumericID(auction["id_user"]) != rtdbNumericID(invoice["id_user"]) || numberValue(auction["harga_akhir"]) != numberValue(invoice["jumlah_pembayaran"]) {
		t.Fatal("competing bid and closures disagreed on winner or issued duplicate invoices")
	}
}
