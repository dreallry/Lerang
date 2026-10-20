package api

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sync"
	"testing"
	"time"
)

func lifecycleRoot(now time.Time) map[string]interface{} {
	root := map[string]interface{}{}
	for id, uid := range map[int]string{1: "alice", 2: "bob", 3: "seller"} {
		treeNode(root, "users")[uid] = map[string]interface{}{"id_user": id, "nama_lengkap": "Fixture " + uid, "saldo_wallet": 1000000, "saldo_hold": 0}
		treeNode(root, "user_ids")[rtdbPathID(id)] = uid
	}
	treeNode(root, "items")["1"] = map[string]interface{}{"id_barang": 1, "id_user": 3, "nama_barang": "Fixture barang", "kategori": "Koleksi & Seni", "harga_awal": 100000, "status_verifikasi": "approved"}
	treeNode(root, "auctions")["1"] = map[string]interface{}{"id_lelang": 1, "id_barang": 1, "status": "dibuka", "tgl_mulai": now.Add(-time.Hour).Format(time.RFC3339Nano), "tgl_selesai": now.Add(time.Hour).Format(time.RFC3339Nano), "kelipatan_minimal": 50000, "uang_jaminan": 100000, "harga_akhir": 0}
	return root
}

func lifecycleClaims(id int, uid string, now time.Time) *RTDBClaims {
	return &RTDBClaims{ID: id, UID: uid, Role: RoleMasyarakat, EmailVerified: true, AuthTime: now.Unix()}
}
func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestRTDBAuctionPersistsOneHoldAndSettlesPaidInvoice(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	alice, bob := lifecycleClaims(1, "alice", now), lifecycleClaims(2, "bob", now)
	requireNoError(t, lockAuctionHold(root, alice, "1", now))
	requireNoError(t, lockAuctionHold(root, alice, "1", now))
	if numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 900000 || len(treeNode(root, "walletTransactions", "alice")) != 1 {
		t.Fatal("deposit retry charged twice")
	}
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
	requireNoError(t, lockAuctionHold(root, bob, "1", now))
	requireNoError(t, placeTreeBid(root, bob, "1", 150000, now.Add(time.Second)))
	requireNoError(t, placeTreeBid(root, alice, "1", 200000, now.Add(6*time.Second)))
	if numberValue(treeRecord(root, "users", "alice")["saldo_hold"]) != 100000 {
		t.Fatal("bid charged an additional deposit")
	}
	requireNoError(t, settleAuction(root, "1", false, now.Add(10*time.Second)))
	invoice := treeRecord(root, "invoices", "1")
	if numberValue(invoice["total_keseluruhan"]) != 220000 || numberValue(invoice["sisa_tagihan"]) != 120000 || numberValue(invoice["biaya_komisi_platform"]) != 10000 {
		t.Fatalf("wrong invoice totals: %v", invoice)
	}
	requireNoError(t, settleAuction(root, "1", false, now.Add(11*time.Second)))
	if len(treeMap(root["invoices"])) != 1 {
		t.Fatal("close retry created another invoice")
	}
	requireNoError(t, applyInvoicePayment(root, "1", "FIXTURE-PAID", now.Add(12*time.Second)))
	requireNoError(t, applyInvoicePayment(root, "1", "FIXTURE-PAID", now.Add(13*time.Second)))
	if numberValue(treeRecord(root, "users", "alice")["saldo_hold"]) != 0 || numberValue(treeRecord(root, "users", "bob")["saldo_wallet"]) != 1000000 || len(treeMap(root["fulfillments"])) != 1 {
		t.Fatal("paid invoice did not consume one winner hold and release runner-up")
	}
	if err := completeFulfillment(root, alice, "FUL-1", 5, "fixture", now); err == nil {
		t.Fatal("undelivered item released seller proceeds")
	}
	treeRecord(root, "fulfillments", "FUL-1")["status"] = "dikirim"
	requireNoError(t, completeFulfillment(root, alice, "FUL-1", 5, "fixture", now.Add(time.Minute)))
	requireNoError(t, completeFulfillment(root, alice, "FUL-1", 5, "fixture", now.Add(2*time.Minute)))
	if numberValue(treeRecord(root, "users", "seller")["saldo_wallet"]) != 1190000 {
		t.Fatal("seller payout was missing or duplicated")
	}
	if numberValue(treeRecord(root, "platformLedger", "invoice-1")["nominal"]) != 30000 {
		t.Fatal("premium and commission did not match invoice")
	}
}

func TestRTDBExpiredInvoicePromotesDistinctRunnerUpOnce(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	root := lifecycleRoot(now)
	alice, bob := lifecycleClaims(1, "alice", now), lifecycleClaims(2, "bob", now)
	for _, claims := range []*RTDBClaims{alice, bob} {
		requireNoError(t, lockAuctionHold(root, claims, "1", now))
	}
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
	requireNoError(t, placeTreeBid(root, bob, "1", 150000, now.Add(time.Second)))
	requireNoError(t, placeTreeBid(root, alice, "1", 200000, now.Add(6*time.Second)))
	requireNoError(t, settleAuction(root, "1", false, now))
	requireNoError(t, expireInvoice(root, "1", now.Add(25*time.Hour)))
	requireNoError(t, expireInvoice(root, "1", now.Add(25*time.Hour)))
	if treeRecord(root, "invoices", "1")["status"] != "Kadaluarsa" || rtdbNumericID(treeRecord(root, "invoices", "2")["id_user"]) != 2 || len(treeMap(root["invoices"])) != 2 {
		t.Fatal("runner-up was missing, duplicated, or same participant as winner")
	}
	if treeMap(treeNode(root, "holds", "1")["alice"])["status"] != "forfeited" || numberValue(treeRecord(root, "users", "alice")["saldo_hold"]) != 0 {
		t.Fatal("default did not consume hold once")
	}
	if err := applyInvoicePayment(root, "1", "LATE-FIXTURE", now.Add(25*time.Hour)); err == nil {
		t.Fatal("late payment reclaimed the former winner")
	}
}

func TestRTDBCancellationAndReserveMissRefundEveryHold(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		t.Run(map[bool]string{true: "cancel", false: "reserve-miss"}[cancel], func(t *testing.T) {
			now := time.Now()
			root := lifecycleRoot(now)
			alice := lifecycleClaims(1, "alice", now)
			requireNoError(t, lockAuctionHold(root, alice, "1", now))
			requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
			treeRecord(root, "auctions", "1")["reserve_price"] = 200000
			requireNoError(t, settleAuction(root, "1", cancel, now))
			requireNoError(t, settleAuction(root, "1", cancel, now))
			if numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 1000000 || len(treeMap(root["invoices"])) != 0 {
				t.Fatal("refund missing or fake invoice created")
			}
		})
	}
}

func TestRTDBProxyBidsRemainServerOwnedAndRetainRealRunnerUp(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	for id, uid := range map[int]string{1: "alice", 2: "bob"} {
		requireNoError(t, lockAuctionHold(root, lifecycleClaims(id, uid, now), "1", now))
	}
	auction, item := treeRecord(root, "auctions", "1"), treeRecord(root, "items", "1")
	treeNode(root, "autoBids", "1")["alice"] = map[string]interface{}{"max_amount": 500000, "created_at": now.Format(time.RFC3339Nano)}
	resolveProxyBids(root, auction, item, now)
	treeNode(root, "autoBids", "1")["bob"] = map[string]interface{}{"max_amount": 400000, "created_at": now.Add(time.Second).Format(time.RFC3339Nano)}
	resolveProxyBids(root, auction, item, now.Add(time.Second))
	if rtdbNumericID(auction["id_user"]) != 1 || numberValue(auction["harga_akhir"]) != 450000 {
		t.Fatalf("proxy price/winner incorrect: %v", auction)
	}
	ranked := rankedAuctionBids(root, "1")
	if len(ranked) != 2 || ranked[1].uid != "bob" || ranked[1].amount != 400000 {
		t.Fatal("proxy opponent was not recorded as a real distinct bidder")
	}
	delete(treeNode(root, "autoBids", "1"), "alice")
	if numberValue(auction["harga_akhir"]) != 450000 {
		t.Fatal("canceling proxy erased committed bid")
	}
}

func TestRTDBBidRejectsInvalidMoneySelfBidUnverifiedAndExpired(t *testing.T) {
	for _, testCase := range []string{"self", "unverified", "expired", "no-hold", "fraction", "nan", "too-low", "historical"} {
		t.Run(testCase, func(t *testing.T) {
			now := time.Now()
			root := lifecycleRoot(now)
			claims := lifecycleClaims(1, "alice", now)
			requireNoError(t, lockAuctionHold(root, claims, "1", now))
			amount := 100000.0
			switch testCase {
			case "self":
				treeRecord(root, "items", "1")["id_user"] = 1
			case "unverified":
				claims.EmailVerified = false
			case "expired":
				treeRecord(root, "auctions", "1")["tgl_selesai"] = now.Add(-time.Second).Format(time.RFC3339Nano)
			case "no-hold":
				delete(treeNode(root, "holds", "1"), "alice")
			case "fraction":
				amount = 100000.5
			case "nan":
				amount = math.NaN()
			case "too-low":
				amount = 99999
			case "historical":
				treeRecord(root, "auctions", "1")["legacy_historical"] = true
			}
			if err := placeTreeBid(root, claims, "1", amount, now); err == nil {
				t.Fatal("invalid bid accepted")
			}
			if len(treeNode(root, "bids", "1")) != 0 {
				t.Fatal("rejected bid changed history")
			}
		})
	}
}

func TestRTDBAntiSnipeCooldownAndHistoricalWorker(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	alice, bob := lifecycleClaims(1, "alice", now), lifecycleClaims(2, "bob", now)
	treeRecord(root, "auctions", "1")["tgl_selesai"] = now.Add(time.Minute).Format(time.RFC3339Nano)
	requireNoError(t, lockAuctionHold(root, alice, "1", now))
	requireNoError(t, lockAuctionHold(root, bob, "1", now))
	requireNoError(t, placeTreeBid(root, alice, "1", 100000, now))
	requireNoError(t, placeTreeBid(root, bob, "1", 150000, now.Add(time.Second)))
	if err := placeTreeBid(root, alice, "1", 200000, now.Add(2*time.Second)); err == nil {
		t.Fatal("bid cooldown was not enforced by server")
	}
	if rtdbNumericID(treeRecord(root, "auctions", "1")["extension_count"]) != 2 {
		t.Fatal("anti-snipe extension not persisted")
	}
	legacy := lifecycleRoot(now)
	treeRecord(legacy, "auctions", "1")["legacy_historical"] = true
	treeRecord(legacy, "auctions", "1")["tgl_selesai"] = now.Add(-time.Minute).Format(time.RFC3339Nano)
	before, _ := json.Marshal(legacy)
	err := sweepAuctions(legacy, now)
	if !errors.Is(err, errNoLifecycleWork) {
		t.Fatalf("historical worker did unexpected work: %v", err)
	}
	after, _ := json.Marshal(legacy)
	if string(before) != string(after) {
		t.Fatal("worker reprocessed migrated history")
	}
}

func TestRTDBConcurrentDepositsCannotSpendSameBalance(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	treeRecord(root, "users", "alice")["saldo_wallet"] = 150000
	second := map[string]interface{}{}
	for k, v := range treeRecord(root, "auctions", "1") {
		second[k] = v
	}
	second["id_lelang"] = 2
	treeNode(root, "auctions")["2"] = second
	snapshot := paymentRTDBFixture(t, root)
	claims := lifecycleClaims(1, "alice", now)
	var group sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"1", "2"} {
		group.Add(1)
		go func(id string) {
			defer group.Done()
			results <- rtdbTransaction(context.Background(), func(tree map[string]interface{}) error { return lockAuctionHold(tree, claims, id, now) })
		}(id)
	}
	group.Wait()
	close(results)
	succeeded := 0
	for err := range results {
		if err == nil {
			succeeded++
		}
	}
	profile := treeRecord(snapshot(), "users", "alice")
	if succeeded != 1 || numberValue(profile["saldo_wallet"]) != 50000 || numberValue(profile["saldo_hold"]) != 100000 {
		t.Fatalf("concurrent hold corrupted balances: successes=%d profile=%v", succeeded, profile)
	}
}

func TestRTDBWithdrawalRetryAndRecentAuthentication(t *testing.T) {
	now := time.Now()
	root := lifecycleRoot(now)
	claims := lifecycleClaims(1, "alice", now)
	req := withdrawRequest{Amount: 100000, Bank: "BCA", Account: "1234567890", Holder: "Fixture", RequestID: "123e4567-e89b-42d3-a456-426614174000"}
	first, err := requestWithdrawal(root, claims, req, now)
	requireNoError(t, err)
	second, err := requestWithdrawal(root, claims, req, now)
	requireNoError(t, err)
	if first != second || len(treeMap(root["withdrawals"])) != 1 || numberValue(treeRecord(root, "users", "alice")["saldo_wallet"]) != 900000 {
		t.Fatal("withdrawal retry debited balance twice")
	}
	claims.AuthTime = now.Add(-6 * time.Minute).Unix()
	if _, err := requestWithdrawal(root, claims, req, now); err == nil {
		t.Fatal("stale reauthentication accepted")
	}
}

func TestRTDBDenseNumericKeysPreserveRecordsAndPhotoArrays(t *testing.T) {
	photos := []interface{}{"https://example.invalid/photo.jpg"}
	root := map[string]interface{}{"items": []interface{}{nil, map[string]interface{}{"id_barang": 1, "foto_barang": photos}, map[string]interface{}{"id_barang": 2}}}
	treeNode(root, "items")["3"] = map[string]interface{}{"id_barang": 3}
	if len(treeMap(root["items"])) != 3 || rtdbNumericID(treeRecord(root, "items", "1")["id_barang"]) != 1 {
		t.Fatal("adding a row erased dense numeric Firebase records")
	}
	if _, ok := treeRecord(root, "items", "1")["foto_barang"].([]interface{}); !ok {
		t.Fatal("photos were converted into a database collection")
	}
	fixtureRTDB(t, map[string]interface{}{"/items.json": []interface{}{nil, map[string]interface{}{"id_barang": 1, "foto_barang": photos}}}, "")
	var records map[string]map[string]interface{}
	requireNoError(t, rtdbGet(context.Background(), "items", &records))
	if rtdbNumericID(records["1"]["id_barang"]) != 1 || len(records["1"]["foto_barang"].([]interface{})) != 1 {
		t.Fatal("REST array response failed to decode as a numeric-key collection")
	}
}
