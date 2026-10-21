package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"time"
)

var errNoLifecycleWork = errors.New("tidak ada perubahan siklus lelang")

func validateAuctionHolds(root map[string]interface{}, id string) error {
	for uid, value := range treeMap(treeMap(root["holds"])[id]) {
		hold := treeMap(value)
		if stringValue(hold["status"], "") != "held" {
			continue
		}
		profile := treeRecord(root, "users", uid)
		amount := numberValue(hold["nominal"])
		if profile == nil || !validStoredBalance(profile) || !wholeRupiah(amount, 0) || numberValue(profile["saldo_hold"]) < amount {
			return domainError(409, "Saldo jaminan perlu rekonsiliasi sebelum lelang diselesaikan")
		}
	}
	return nil
}

type rankedBid struct {
	uid    string
	amount float64
	at     string
}

func rankedAuctionBids(root map[string]interface{}, id string) []rankedBid {
	best := map[string]rankedBid{}
	for _, value := range treeMap(treeMap(root["bids"])[id]) {
		bid := treeMap(value)
		uid := stringValue(bid["owner_uid"], userUID(root, rtdbNumericID(bid["id_user"])))
		if uid == "" {
			continue
		}
		amount := numberValue(bid["penawaran_harga"])
		previous, ok := best[uid]
		if !ok || amount > previous.amount {
			best[uid] = rankedBid{uid, amount, stringValue(bid["created_at"], "")}
		}
	}
	list := make([]rankedBid, 0, len(best))
	for _, bid := range best {
		if stringValue(treeMap(treeMap(treeMap(root["holds"])[id])[bid.uid])["status"], "") == "held" {
			list = append(list, bid)
		}
	}
	winner := userUID(root, rtdbNumericID(treeRecord(root, "auctions", id)["id_user"]))
	sort.Slice(list, func(i, j int) bool {
		if list[i].amount != list[j].amount {
			return list[i].amount > list[j].amount
		}
		if list[i].uid == winner {
			return true
		}
		if list[j].uid == winner {
			return false
		}
		if list[i].at != list[j].at {
			return list[i].at < list[j].at
		}
		return list[i].uid < list[j].uid
	})
	return list
}

func buyersPremium(amount float64) (float64, float64) {
	percent := 8.0
	if amount < 10_000_000 {
		percent = 10
	}
	if amount > 100_000_000 {
		percent = 5
	}
	return percent, math.Round(amount * percent / 100)
}

func validAuctionAmount(amount float64) bool {
	_, premium := buyersPremium(amount)
	return wholeRupiah(amount, 1) && wholeRupiah(amount+premium, 1)
}

func createWinnerInvoice(root map[string]interface{}, auction, item map[string]interface{}, bid rankedBid, now time.Time) (string, error) {
	id := rtdbPathID(rtdbNumericID(auction["id_lelang"]))
	profile := treeRecord(root, "users", bid.uid)
	hold := treeMap(treeMap(treeMap(root["holds"])[id])[bid.uid])
	if profile == nil || stringValue(hold["status"], "") != "held" {
		return "", domainError(409, "Jaminan pemenang belum tersedia")
	}
	percent, premium := buyersPremium(bid.amount)
	total := bid.amount + premium
	if !validAuctionAmount(bid.amount) {
		return "", domainError(409, "Nilai tagihan lelang perlu diperiksa pengelola")
	}
	deduction := math.Min(total, numberValue(hold["nominal"]))
	commission := 0.0
	if rtdbNumericID(item["id_user"]) > 0 {
		commission = math.Round(bid.amount * 0.05)
	}
	invoiceID := nextTreeID(root, "invoices")
	key := rtdbPathID(invoiceID)
	invoice := map[string]interface{}{
		"id_pembayaran": invoiceID, "id_lelang": auction["id_lelang"], "id_barang": auction["id_barang"], "id_user": profile["id_user"], "owner_uid": bid.uid,
		"jumlah_pembayaran": bid.amount, "premi_persen": percent, "premi_pembeli": premium, "total_keseluruhan": total, "uang_jaminan_dipotong": deduction, "sisa_tagihan": total - deduction,
		"biaya_komisi_platform": commission, "dana_penjual_diterima": bid.amount - commission, "status": "Belum Dibayar", "created_at": now.UTC().Format(time.RFC3339Nano),
		"batas_pembayaran": now.Add(24 * time.Hour).UTC().Format(time.RFC3339Nano), "id_user_penjual": item["id_user"],
	}
	treeNode(root, "invoices")[key] = invoice
	auction["id_user"], auction["harga_akhir"], auction["invoice_id"] = profile["id_user"], bid.amount, invoiceID
	notifyUser(root, bid.uid, "invoice-"+key, "Tagihan lelang tersedia", fmt.Sprintf("Pelunasan lelang #%s paling lambat 24 jam. Sisa tagihan Rp %.0f.", id, total-deduction), "win", "invoices", now)
	if total == deduction {
		if err := applyInvoicePayment(root, key, "DEPOSIT-"+key, now); err != nil {
			return "", err
		}
	}
	return key, nil
}

func settleAuction(root map[string]interface{}, id string, cancel bool, now time.Time) error {
	auction := treeRecord(root, "auctions", id)
	if auction == nil {
		return domainError(404, "Lelang tidak ditemukan")
	}
	if auction["legacy_historical"] == true {
		return domainError(409, "Riwayat lelang lama tidak boleh diproses ulang")
	}
	if auction["settled_at"] != nil {
		if cancel && stringValue(auction["status"], "") != "dibatalkan" {
			return domainError(409, "Lelang sudah menghasilkan keputusan dan tidak dapat dibatalkan")
		}
		return nil
	}
	if err := validateAuctionHolds(root, id); err != nil {
		return err
	}
	item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(auction["id_barang"])))
	if item == nil {
		return domainError(409, "Barang lelang tidak ditemukan")
	}
	list := rankedAuctionBids(root, id)
	reserve := numberValue(auction["reserve_price"])
	if reserve == 0 {
		reserve = numberValue(item["reserve_price"])
	}
	accepted := !cancel && len(list) > 0 && list[0].amount >= reserve
	retained := map[string]bool{}
	if accepted {
		retained[list[0].uid] = true
		if len(list) > 1 && list[1].amount >= reserve {
			retained[list[1].uid] = true
			auction["runner_up_uid"] = list[1].uid
		}
	}
	for uid := range treeMap(treeMap(root["holds"])[id]) {
		if !retained[uid] {
			if err := releaseAuctionHold(root, id, uid, true, "Pengembalian jaminan lelang #"+id, now); err != nil {
				return err
			}
		}
	}
	auction["status"], auction["settled_at"], auction["is_reserve_met"] = "ditutup", now.UTC().Format(time.RFC3339Nano), accepted
	if cancel {
		auction["status"] = "dibatalkan"
	}
	delete(treeNode(root, "autoBids"), id)
	if !accepted {
		auction["id_user"] = nil
		return nil
	}
	_, err := createWinnerInvoice(root, auction, item, list[0], now)
	return err
}

func applyInvoicePayment(root map[string]interface{}, invoiceKey, orderID string, now time.Time) error {
	invoice := treeRecord(root, "invoices", invoiceKey)
	if invoice == nil {
		return domainError(404, "Tagihan tidak ditemukan")
	}
	if invoice["payment_review_required"] == true {
		return domainError(409, "Tagihan menunggu pemeriksaan pembayaran oleh pengelola")
	}
	if stringValue(invoice["status"], "") == "Sudah Dibayar" {
		return nil
	}
	auctionID := rtdbPathID(rtdbNumericID(invoice["id_lelang"]))
	auction := treeRecord(root, "auctions", auctionID)
	if invoice["legacy_historical"] == true || auction == nil || auction["legacy_historical"] == true {
		return domainError(409, "Tagihan migrasi memerlukan pemeriksaan sebelum menerima pembayaran")
	}
	deadline, err := auctionTime(invoice["batas_pembayaran"])
	if err != nil || !now.Before(deadline) || stringValue(invoice["status"], "") != "Belum Dibayar" || rtdbNumericID(auction["id_user"]) != rtdbNumericID(invoice["id_user"]) {
		return domainError(409, "Pembayaran lewat waktu atau pemenang telah berubah; perlu rekonsiliasi")
	}
	if err := validateAuctionHolds(root, auctionID); err != nil {
		return err
	}
	uid := stringValue(invoice["owner_uid"], userUID(root, rtdbNumericID(invoice["id_user"])))
	profile := treeRecord(root, "users", uid)
	hold := treeMap(treeMap(treeMap(root["holds"])[auctionID])[uid])
	held := numberValue(hold["nominal"])
	deduction := numberValue(invoice["uang_jaminan_dipotong"])
	if profile == nil || stringValue(hold["status"], "") != "held" || held < deduction {
		return domainError(409, "Jaminan pembayaran tidak sesuai tagihan")
	}
	profile["saldo_hold"] = numberValue(profile["saldo_hold"]) - held
	if excess := held - deduction; excess > 0 {
		profile["saldo_wallet"] = numberValue(profile["saldo_wallet"]) + excess
		recordWallet(root, uid, "excess-"+invoiceKey, "unhold", excess, "Sisa jaminan setelah pelunasan", "INVOICE-"+invoiceKey, now)
	}
	hold["status"], hold["updated_at"] = "consumed", now.UTC().Format(time.RFC3339Nano)
	invoice["status"], invoice["order_id"], invoice["tgl_pembayaran"], invoice["escrow_status"] = "Sudah Dibayar", orderID, now.UTC().Format(time.RFC3339Nano), "held"
	recordWallet(root, uid, "settlement-"+invoiceKey, "pelunasan", numberValue(invoice["total_keseluruhan"]), "Pelunasan tagihan lelang", "INVOICE-"+invoiceKey, now)
	for otherUID := range treeMap(treeMap(root["holds"])[auctionID]) {
		if otherUID != uid {
			if err := releaseAuctionHold(root, auctionID, otherUID, true, "Pemenang sudah melunasi lelang #"+auctionID, now); err != nil {
				return err
			}
		}
	}
	fulfillmentID := "FUL-" + invoiceKey
	if treeRecord(root, "fulfillments", fulfillmentID) == nil {
		item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(invoice["id_barang"])))
		treeNode(root, "fulfillments")[fulfillmentID] = map[string]interface{}{"id_fulfillment": fulfillmentID, "id_pembayaran": invoice["id_pembayaran"], "id_lelang": invoice["id_lelang"], "id_barang": invoice["id_barang"], "id_user_pembeli": invoice["id_user"], "buyer_uid": uid, "id_user_penjual": item["id_user"], "seller_uid": userUID(root, rtdbNumericID(item["id_user"])), "status": "menunggu_alamat", "tgl_update": now.UTC().Format(time.RFC3339Nano), "tracking_history": []interface{}{map[string]interface{}{"status": "menunggu_alamat", "deskripsi": "Pembayaran terverifikasi. Menunggu alamat atau pengambilan barang.", "waktu": now.UTC().Format(time.RFC3339Nano)}}}
	}
	notifyUser(root, uid, "paid-"+invoiceKey, "Pembayaran terverifikasi", "Pembayaran lelang telah tersimpan. Lengkapi pengiriman atau pengambilan barang.", "payment", "fulfillment", now)
	return nil
}

func expireInvoice(root map[string]interface{}, key string, now time.Time) error {
	invoice := treeRecord(root, "invoices", key)
	if invoice == nil || invoice["legacy_historical"] == true || invoice["payment_review_required"] == true || stringValue(invoice["status"], "") != "Belum Dibayar" {
		return nil
	}
	id := rtdbPathID(rtdbNumericID(invoice["id_lelang"]))
	auction := treeRecord(root, "auctions", id)
	if auction == nil || auction["legacy_historical"] == true {
		return nil
	}
	if err := validateAuctionHolds(root, id); err != nil {
		return err
	}
	uid := stringValue(invoice["owner_uid"], userUID(root, rtdbNumericID(invoice["id_user"])))
	if treeRecord(root, "users", uid)["financial_review_required"] == true {
		return errNoLifecycleWork
	}
	if err := releaseAuctionHold(root, id, uid, false, "Jaminan hangus karena batas pelunasan lelang #"+id+" terlewati", now); err != nil {
		return err
	}
	invoice["status"], invoice["expired_at"] = "Kadaluarsa", now.UTC().Format(time.RFC3339Nano)
	list := rankedAuctionBids(root, id)
	item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(invoice["id_barang"])))
	reserve := numberValue(auction["reserve_price"])
	if reserve == 0 {
		reserve = numberValue(item["reserve_price"])
	}
	if len(list) > 0 && list[0].amount >= reserve {
		_, err := createWinnerInvoice(root, auction, item, list[0], now)
		return err
	}
	for otherUID := range treeMap(treeMap(root["holds"])[id]) {
		if err := releaseAuctionHold(root, id, otherUID, true, "Pengembalian jaminan lelang tanpa pemenang pengganti", now); err != nil {
			return err
		}
	}
	auction["id_user"] = nil
	return nil
}

func auctionLifecycleAction(auction map[string]interface{}, now time.Time) string {
	if auction == nil || auction["legacy_historical"] == true {
		return ""
	}
	status := stringValue(auction["status"], "")
	if status != "dibuka" && status != "terjadwal" {
		return ""
	}
	start, err1 := auctionTime(auction["tgl_mulai"])
	end, err2 := auctionTime(auction["tgl_selesai"])
	if err1 != nil || err2 != nil || !end.After(start) {
		return ""
	}
	if !now.Before(end) {
		return "close"
	}
	if !now.Before(start) && status == "terjadwal" {
		return "open"
	}
	return ""
}

func advanceAuctionLifecycle(root map[string]interface{}, id string, now time.Time) error {
	auction := treeRecord(root, "auctions", id)
	switch auctionLifecycleAction(auction, now) {
	case "close":
		return settleAuction(root, id, false, now)
	case "open":
		auction["status"] = "dibuka"
		return nil
	default:
		return errNoLifecycleWork
	}
}

func invoiceLifecycleDue(invoice map[string]interface{}, now time.Time) bool {
	if invoice == nil || invoice["legacy_historical"] == true || invoice["payment_review_required"] == true || stringValue(invoice["status"], "") != "Belum Dibayar" {
		return false
	}
	end, err := auctionTime(invoice["batas_pembayaran"])
	return err == nil && !now.Before(end)
}

func advanceInvoiceLifecycle(root map[string]interface{}, id string, now time.Time) error {
	if !invoiceLifecycleDue(treeRecord(root, "invoices", id), now) {
		return errNoLifecycleWork
	}
	return expireInvoice(root, id, now)
}

func auctionSessionStatus(session map[string]interface{}, auctions map[string]interface{}) string {
	if session == nil || session["legacy_historical"] == true || stringValue(session["status"], "") == "closed" {
		return ""
	}
	live, upcoming, count := false, false, 0
	for _, value := range auctions {
		auction := treeMap(value)
		if rtdbNumericID(auction["id_sesi"]) != rtdbNumericID(session["id_sesi"]) {
			continue
		}
		count++
		switch stringValue(auction["status"], "") {
		case "dibuka":
			live = true
		case "terjadwal":
			upcoming = true
		}
	}
	if live && session["status"] != "live" {
		return "live"
	}
	if !live && !upcoming && count > 0 {
		return "closed"
	}
	return ""
}

func syncAuctionSessions(root map[string]interface{}) error {
	changed := false
	for _, value := range treeMap(root["sessions"]) {
		session := treeMap(value)
		if status := auctionSessionStatus(session, treeMap(root["auctions"])); status != "" {
			session["status"] = status
			changed = true
		}
	}
	if !changed {
		return errNoLifecycleWork
	}
	return nil
}

func sweepAuctions(root map[string]interface{}, now time.Time) error {
	changed := false
	for id := range treeMap(root["auctions"]) {
		if err := advanceAuctionLifecycle(root, id, now); err == nil {
			changed = true
		} else if !errors.Is(err, errNoLifecycleWork) {
			return err
		}
	}
	for id := range treeMap(root["invoices"]) {
		if err := advanceInvoiceLifecycle(root, id, now); err == nil {
			changed = true
		} else if !errors.Is(err, errNoLifecycleWork) {
			return err
		}
	}
	if err := syncAuctionSessions(root); err == nil {
		changed = true
	}
	if !changed {
		return errNoLifecycleWork
	}
	return nil
}

func runAuctionLifecycle(ctx context.Context, clock func() time.Time) error {
	// Isolate each money transition so one corrupt lot cannot roll back healthy settlements.
	auctions, firstErr := rtdbAuctions(ctx)
	changed := false
	for id, auction := range auctions {
		if auctionLifecycleAction(auction, clock()) == "" {
			continue
		}
		err := rtdbTransaction(ctx, func(root map[string]interface{}) error {
			return advanceAuctionLifecycle(root, id, clock())
		})
		if err == nil {
			changed = true
		} else if !errors.Is(err, errNoLifecycleWork) && firstErr == nil {
			firstErr = err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	invoices, err := rtdbCollection(ctx, "invoices")
	if err != nil && firstErr == nil {
		firstErr = err
	}
	for id, invoice := range invoices {
		if !invoiceLifecycleDue(invoice, clock()) {
			continue
		}
		err := rtdbTransaction(ctx, func(root map[string]interface{}) error {
			return advanceInvoiceLifecycle(root, id, clock())
		})
		if err == nil {
			changed = true
		} else if !errors.Is(err, errNoLifecycleWork) && firstErr == nil {
			firstErr = err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	sessions, err := rtdbCollection(ctx, "sessions")
	if err != nil && firstErr == nil {
		firstErr = err
	}
	needsSessionSync := changed
	auctionValues := make(map[string]interface{}, len(auctions))
	for id, auction := range auctions {
		auctionValues[id] = auction
	}
	for _, session := range sessions {
		if auctionSessionStatus(session, auctionValues) != "" {
			needsSessionSync = true
			break
		}
	}
	if needsSessionSync {
		if err := rtdbTransaction(ctx, syncAuctionSessions); err == nil {
			changed = true
		} else if !errors.Is(err, errNoLifecycleWork) && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return firstErr
	}
	if !changed {
		return errNoLifecycleWork
	}
	return nil
}

func StartAuctionWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := runAuctionLifecycle(ctx, time.Now); err != nil && !errors.Is(err, errNoLifecycleWork) {
					log.Printf("Penyelesaian lelang belum berhasil: %v", err)
				}
			}
		}
	}()
}
