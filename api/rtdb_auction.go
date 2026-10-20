package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func rtdbAuctions(ctx context.Context) (map[string]map[string]interface{}, error) {
	items := map[string]map[string]interface{}{}
	return items, rtdbGet(ctx, "auctions", &items)
}

func rtdbAuctionList(auctions map[string]map[string]interface{}) []map[string]interface{} {
	list := make([]map[string]interface{}, 0, len(auctions))
	for key, auction := range auctions {
		if auction == nil {
			continue
		}
		if _, ok := auction["id_lelang"]; !ok {
			auction["id_lelang"] = rtdbNumericID(key)
		}
		list = append(list, auction)
	}
	sort.SliceStable(list, func(i, j int) bool { return rtdbNumericID(list[i]["id_lelang"]) > rtdbNumericID(list[j]["id_lelang"]) })
	return list
}

func auctionTime(value interface{}) (time.Time, error) {
	text := stringValue(value, "")
	if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
		return parsed, nil
	}
	return time.ParseInLocation("2006-01-02 15:04:05", text, time.FixedZone("WIB", 7*3600))
}

func dynamicIncrement(price float64) float64 {
	switch {
	case price < 1_000_000:
		return 50_000
	case price < 10_000_000:
		return 100_000
	case price < 50_000_000:
		return 500_000
	case price < 200_000_000:
		return 1_000_000
	default:
		return 5_000_000
	}
}

func auctionMinimum(auction, item map[string]interface{}) (float64, float64) {
	price, opening := numberValue(auction["harga_akhir"]), numberValue(item["harga_awal"])
	if opening == 0 {
		opening = numberValue(auction["harga_awal"])
	}
	base := price
	if base < opening {
		base = opening
	}
	increment := numberValue(auction["kelipatan_minimal"])
	if increment < dynamicIncrement(base) {
		increment = dynamicIncrement(base)
	}
	if rtdbNumericID(auction["id_user"]) == 0 {
		return opening, increment
	}
	return price + increment, increment
}

func rtdbAuctionJoined(ctx context.Context, auction map[string]interface{}, private bool) (map[string]interface{}, error) {
	var item map[string]interface{}
	if err := rtdbGet(ctx, "items/"+rtdbPathID(rtdbNumericID(auction["id_barang"])), &item); err != nil {
		return nil, err
	}
	if item == nil {
		item = map[string]interface{}{}
	}
	minimum, increment := auctionMinimum(auction, item)
	copyAuction := map[string]interface{}{}
	for key, value := range auction {
		if private || key != "reserve_price" {
			copyAuction[key] = value
		}
	}
	copyAuction["minimum_bid"], copyAuction["bid_increment"] = minimum, increment
	if !private {
		item = publicItem(item)
	} else {
		formatDisplayFields(item, "nama_barang", "deskripsi_barang")
	}
	return map[string]interface{}{"lelang": copyAuction, "barang": item}, nil
}

func listLelang(w http.ResponseWriter, r *http.Request, private bool) {
	auctions, err := rtdbAuctions(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	list := make([]map[string]interface{}, 0)
	for _, auction := range rtdbAuctionList(auctions) {
		state := stringValue(auction["status"], "")
		if !private && (state == "draft" || state == "dibatalkan") {
			continue
		}
		if status != "" && state != status {
			continue
		}
		joined, err := rtdbAuctionJoined(r.Context(), auction, private)
		if err != nil {
			rtdbJSONError(w, err)
			return
		}
		if !private && stringValue(treeMap(joined["barang"])["status_verifikasi"], "") != "approved" {
			continue
		}
		list = append(list, joined)
	}
	JSON(w, 200, Response{Success: true, Data: list})
}
func ListLelangRTDB(w http.ResponseWriter, r *http.Request)    { listLelang(w, r, false) }
func ListAllLelangRTDB(w http.ResponseWriter, r *http.Request) { listLelang(w, r, true) }

func DetailLelangRTDB(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		Error(w, 400, "ID lelang tidak valid")
		return
	}
	var auction map[string]interface{}
	if err := rtdbGet(r.Context(), "auctions/"+rtdbPathID(id), &auction); err != nil {
		rtdbJSONError(w, err)
		return
	}
	if auction == nil || stringValue(auction["status"], "") == "draft" || stringValue(auction["status"], "") == "dibatalkan" {
		Error(w, 404, "Lot lelang tidak ditemukan")
		return
	}
	joined, err := rtdbAuctionJoined(r.Context(), auction, false)
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	if stringValue(treeMap(joined["barang"])["status_verifikasi"], "") != "approved" {
		Error(w, 404, "Lot lelang tidak ditemukan")
		return
	}
	var bids map[string]map[string]interface{}
	if err := rtdbGet(r.Context(), "bids/"+rtdbPathID(id), &bids); err != nil {
		rtdbJSONError(w, err)
		return
	}
	history := collectionList(bids)
	sort.SliceStable(history, func(i, j int) bool {
		return numberValue(history[i]["penawaran_harga"]) > numberValue(history[j]["penawaran_harga"])
	})
	joined["history"], joined["total_bids"] = history, len(history)
	JSON(w, 200, Response{Success: true, Data: joined})
}

func biddingAuction(root map[string]interface{}, id string, now time.Time, allowScheduled bool) (map[string]interface{}, map[string]interface{}, error) {
	auction := treeRecord(root, "auctions", id)
	if auction == nil {
		return nil, nil, domainError(404, "Lelang tidak ditemukan")
	}
	if auction["legacy_historical"] == true {
		return nil, nil, domainError(409, "Lelang ini merupakan riwayat dan tidak menerima transaksi baru")
	}
	status := stringValue(auction["status"], "")
	if status != "dibuka" && !(allowScheduled && status == "terjadwal") {
		return nil, nil, domainError(409, "Lelang belum menerima transaksi atau sudah ditutup")
	}
	start, err1 := auctionTime(auction["tgl_mulai"])
	end, err2 := auctionTime(auction["tgl_selesai"])
	if err1 != nil || err2 != nil || !end.After(start) {
		return nil, nil, domainError(409, "Jadwal lelang belum valid")
	}
	if !now.Before(end) || (!allowScheduled && now.Before(start)) {
		return nil, nil, domainError(409, "Penawaran berada di luar jadwal lelang")
	}
	item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(auction["id_barang"])))
	if item == nil || stringValue(item["status_verifikasi"], "") != "approved" {
		return nil, nil, domainError(409, "Barang belum disetujui")
	}
	return auction, item, nil
}

func lockAuctionHold(root map[string]interface{}, claims *RTDBClaims, id string, now time.Time) error {
	profile, err := transactionProfile(root, claims)
	if err != nil {
		return err
	}
	auction, item, err := biddingAuction(root, id, now, true)
	if err != nil {
		return err
	}
	if rtdbNumericID(item["id_user"]) == claims.ID {
		return domainError(403, "Pemilik barang tidak dapat mengikuti lelang sendiri")
	}
	holds := treeNode(root, "holds", id)
	if stringValue(treeMap(holds[claims.UID])["status"], "") == "held" {
		return nil
	}
	amount := numberValue(auction["uang_jaminan"])
	if !wholeRupiah(amount, 0) {
		return domainError(409, "Nilai jaminan lelang belum valid")
	}
	if numberValue(profile["saldo_wallet"]) < amount {
		return domainError(409, "Saldo wallet tidak mencukupi")
	}
	profile["saldo_wallet"], profile["saldo_hold"] = numberValue(profile["saldo_wallet"])-amount, numberValue(profile["saldo_hold"])+amount
	holds[claims.UID] = map[string]interface{}{"id_user": claims.ID, "owner_uid": claims.UID, "nominal": amount, "status": "held", "created_at": now.UTC().Format(time.RFC3339Nano)}
	recordWallet(root, claims.UID, "hold-"+id, "hold", amount, "Kunci jaminan lelang #"+id, "LELANG-"+id, now)
	return nil
}

func appendBid(root map[string]interface{}, auction, item map[string]interface{}, uid string, amount float64, auto bool, now time.Time) {
	id := rtdbPathID(rtdbNumericID(auction["id_lelang"]))
	profile := treeRecord(root, "users", uid)
	previousUID := userUID(root, rtdbNumericID(auction["id_user"]))
	sequence := rtdbNumericID(auction["bid_count"]) + 1
	key := fmt.Sprintf("BID-%s-%d", id, sequence)
	for treeMap(treeNode(root, "bids", id)[key]) != nil {
		sequence++
		key = fmt.Sprintf("BID-%s-%d", id, sequence)
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	treeNode(root, "bids", id)[key] = map[string]interface{}{"id_history": key, "id_lelang": auction["id_lelang"], "id_barang": auction["id_barang"], "id_user": profile["id_user"], "owner_uid": uid, "nama_user": profile["nama_lengkap"], "penawaran_harga": amount, "created_at": stamp, "is_auto_bid": auto}
	auction["harga_akhir"], auction["id_user"], auction["bid_count"], auction["last_bid_at"] = amount, profile["id_user"], sequence, stamp
	reserve := numberValue(auction["reserve_price"])
	if reserve == 0 {
		reserve = numberValue(item["reserve_price"])
	}
	auction["is_reserve_met"] = amount >= reserve
	end, _ := auctionTime(auction["tgl_selesai"])
	extensions := rtdbNumericID(auction["extension_count"])
	if !auto && end.Sub(now) <= 5*time.Minute && extensions < 5 {
		auction["tgl_selesai"], auction["is_extended"], auction["extension_count"] = end.Add(3*time.Minute).UTC().Format(time.RFC3339Nano), true, extensions+1
	}
	if previousUID != "" && previousUID != uid {
		notifyUser(root, previousUID, key, "Tawaran terlampaui", "Ada tawaran lebih tinggi pada lelang #"+id, "outbid", "auction-detail", now)
	}
}

func resolveProxyBids(root map[string]interface{}, auction, item map[string]interface{}, now time.Time) {
	id := rtdbPathID(rtdbNumericID(auction["id_lelang"]))
	leader := userUID(root, rtdbNumericID(auction["id_user"]))
	type candidate struct {
		uid      string
		cap      float64
		priority string
	}
	values := map[string]candidate{}
	if leader != "" {
		values[leader] = candidate{leader, numberValue(auction["harga_akhir"]), stringValue(auction["last_bid_at"], "")}
	}
	for uid, value := range treeMap(treeMap(root["autoBids"])[id]) {
		config, profile := treeMap(value), treeRecord(root, "users", uid)
		hold := treeMap(treeMap(treeMap(root["holds"])[id])[uid])
		if profile == nil || profile["financial_review_required"] == true || rtdbNumericID(profile["id_user"]) == rtdbNumericID(item["id_user"]) || stringValue(hold["status"], "") != "held" || !validAuctionAmount(numberValue(config["max_amount"])) {
			continue
		}
		cap := numberValue(config["max_amount"])
		if existing, ok := values[uid]; ok && existing.cap > cap {
			cap = existing.cap
		}
		values[uid] = candidate{uid, cap, stringValue(config["created_at"], "")}
	}
	list := make([]candidate, 0, len(values))
	for _, value := range values {
		list = append(list, value)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].cap != list[j].cap {
			return list[i].cap > list[j].cap
		}
		if list[i].priority != list[j].priority {
			return list[i].priority < list[j].priority
		}
		return list[i].uid < list[j].uid
	})
	if len(list) == 0 {
		return
	}
	minimum, increment := auctionMinimum(auction, item)
	winner := list[0]
	target := minimum
	if len(list) > 1 && list[1].cap >= minimum {
		target = list[1].cap + increment
	}
	if target > winner.cap {
		target = winner.cap
	}
	if target < minimum || (winner.uid == leader && (len(list) < 2 || list[1].cap < minimum)) {
		return
	}
	if len(list) > 1 && list[1].uid != leader && list[1].cap >= minimum {
		appendBid(root, auction, item, list[1].uid, list[1].cap, true, now)
	}
	appendBid(root, auction, item, winner.uid, target, true, now)
}

func placeTreeBid(root map[string]interface{}, claims *RTDBClaims, id string, amount float64, now time.Time) error {
	_, err := transactionProfile(root, claims)
	if err != nil {
		return err
	}
	auction, item, err := biddingAuction(root, id, now, false)
	if err != nil {
		return err
	}
	if rtdbNumericID(item["id_user"]) == claims.ID {
		return domainError(403, "Pemilik barang dilarang menawar barang sendiri")
	}
	if rtdbNumericID(auction["id_user"]) == claims.ID {
		return domainError(409, "Anda sudah menjadi penawar tertinggi")
	}
	if stringValue(treeMap(treeMap(treeMap(root["holds"])[id])[claims.UID])["status"], "") != "held" {
		return domainError(409, "Kunci uang jaminan sebelum mengajukan penawaran")
	}
	minimum, _ := auctionMinimum(auction, item)
	if !validAuctionAmount(amount) || amount < minimum {
		return domainError(400, fmt.Sprintf("Tawaran minimal Rp %.0f", minimum))
	}
	last := treeNode(root, "bidCooldowns", id)
	if previous, err := auctionTime(last[claims.UID]); err == nil && now.Sub(previous) < 5*time.Second {
		return domainError(429, "Tunggu 5 detik sebelum menawar kembali")
	}
	appendBid(root, auction, item, claims.UID, amount, false, now)
	last[claims.UID] = now.UTC().Format(time.RFC3339Nano)
	resolveProxyBids(root, auction, item, now)
	return nil
}

func PlaceBidRTDB(w http.ResponseWriter, r *http.Request) {
	var req BidRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	id := r.PathValue("id")
	if rtdbNumericID(id) <= 0 {
		Error(w, 400, "ID lelang tidak valid")
		return
	}
	now := time.Now()
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return placeTreeBid(root, rtdbClaimsFromRequest(r), id, req.PenawaranHarga, now)
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Penawaran tersimpan. Posisi tertinggi mengikuti tawaran dan batas otomatis peserta lain."})
}

func LockDepositRTDB(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if rtdbNumericID(id) <= 0 {
		Error(w, 400, "ID lelang tidak valid")
		return
	}
	now := time.Now()
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return lockAuctionHold(root, rtdbClaimsFromRequest(r), id, now)
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Jaminan lelang tersimpan dan tidak dipotong ulang saat menawar"})
}

func SetAutoBidRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Max float64 `json:"max_amount"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	claims, id, now := rtdbClaimsFromRequest(r), r.PathValue("id"), time.Now()
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		if _, err := transactionProfile(root, claims); err != nil {
			return err
		}
		auction, item, err := biddingAuction(root, id, now, false)
		if err != nil {
			return err
		}
		if rtdbNumericID(item["id_user"]) == claims.ID {
			return domainError(403, "Pemilik barang dilarang menawar barang sendiri")
		}
		if stringValue(treeMap(treeMap(treeMap(root["holds"])[id])[claims.UID])["status"], "") != "held" {
			return domainError(409, "Kunci jaminan terlebih dahulu")
		}
		minimum, _ := auctionMinimum(auction, item)
		if !validAuctionAmount(req.Max) || req.Max < minimum {
			return domainError(400, "Batas tawaran otomatis belum memenuhi minimum")
		}
		configs := treeNode(root, "autoBids", id)
		previous := treeMap(configs[claims.UID])
		created := stringValue(previous["created_at"], now.UTC().Format(time.RFC3339Nano))
		configs[claims.UID] = map[string]interface{}{"max_amount": req.Max, "created_at": created, "updated_at": now.UTC().Format(time.RFC3339Nano)}
		before := rtdbNumericID(auction["bid_count"])
		resolveProxyBids(root, auction, item, now)
		if rtdbNumericID(auction["bid_count"]) > before {
			end, _ := auctionTime(auction["tgl_selesai"])
			count := rtdbNumericID(auction["extension_count"])
			if end.Sub(now) <= 5*time.Minute && count < 5 {
				auction["tgl_selesai"], auction["is_extended"], auction["extension_count"] = end.Add(3*time.Minute).UTC().Format(time.RFC3339Nano), true, count+1
			}
		}
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Batas tawaran otomatis tersimpan di server"})
}

func CancelAutoBidRTDB(w http.ResponseWriter, r *http.Request) {
	claims, id := rtdbClaimsFromRequest(r), r.PathValue("id")
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		if _, err := transactionProfile(root, claims); err != nil {
			return err
		}
		delete(treeNode(root, "autoBids", id), claims.UID)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Tawaran otomatis dinonaktifkan; tawaran yang sudah masuk tetap berlaku"})
}

func ListAllHistoryRTDB(w http.ResponseWriter, r *http.Request) {
	var bids map[string]map[string]map[string]interface{}
	if err := rtdbGet(r.Context(), "bids", &bids); err != nil {
		rtdbJSONError(w, err)
		return
	}
	auctions, err := rtdbAuctions(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0)
	for id, values := range bids {
		auction := auctions[id]
		status := stringValue(auction["status"], "")
		if status == "draft" || status == "dibatalkan" || auction == nil {
			continue
		}
		for _, bid := range values {
			if bid != nil {
				list = append(list, bid)
			}
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		return stringValue(list[i]["created_at"], "") > stringValue(list[j]["created_at"], "")
	})
	JSON(w, 200, Response{Success: true, Data: list})
}

func numberValue(value interface{}) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		n, _ := strconv.ParseFloat(v, 64)
		return n
	default:
		return 0
	}
}
