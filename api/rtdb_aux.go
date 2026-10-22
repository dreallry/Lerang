package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func rtdbCollection(ctx context.Context, node string) (map[string]map[string]interface{}, error) {
	values := map[string]map[string]interface{}{}
	return values, rtdbGet(ctx, node, &values)
}

func collectionList(values map[string]map[string]interface{}) []map[string]interface{} {
	list := make([]map[string]interface{}, 0, len(values))
	for key, value := range values {
		if value == nil {
			continue
		}
		if _, ok := value["id"]; !ok {
			value["id"] = key
		}
		list = append(list, value)
	}
	return list
}

func ListSesiRTDB(w http.ResponseWriter, r *http.Request) {
	values, err := rtdbCollection(r.Context(), "sessions")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	for _, value := range values {
		formatDisplayFields(value, "judul", "deskripsi", "kurator")
	}
	JSON(w, 200, Response{Success: true, Data: collectionList(values)})
}

func ListThemesRTDB(w http.ResponseWriter, r *http.Request) {
	values, err := rtdbCollection(r.Context(), "themes")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	for _, value := range values {
		formatDisplayFields(value, "nama_theme", "subjudul_jadwal", "badge_waktu", "nama_kurator", "deskripsi")
	}
	JSON(w, 200, Response{Success: true, Data: collectionList(values)})
}

func ListNotificationsRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	var values map[string]map[string]interface{}
	if err := rtdbGet(r.Context(), "notifications/"+claims.UID, &values); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Data: collectionList(values)})
}

func MarkNotificationReadRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	id := r.PathValue("id")
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		values := treeMap(treeMap(root["notifications"])[claims.UID])
		if id != "" {
			row := treeMap(values[id])
			if row == nil {
				return domainError(404, "Notifikasi tidak ditemukan")
			}
			row["dibaca"] = true
			return nil
		}
		for _, value := range values {
			if row := treeMap(value); row != nil {
				row["dibaca"] = true
			}
		}
		return nil
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Notifikasi diperbarui"})
}

func ListSchedulesRTDB(w http.ResponseWriter, r *http.Request) {
	values, err := rtdbCollection(r.Context(), "schedules")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Data: collectionList(values)})
}

func SetScheduleRTDB(w http.ResponseWriter, r *http.Request) {
	var req AturJadwalRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	if len(req.JamBuka) == 5 {
		req.JamBuka += ":00"
	}
	_, dateErr := time.Parse("2006-01-02", req.TanggalLelang)
	_, timeErr := time.Parse("15:04:05", req.JamBuka)
	if dateErr != nil || timeErr != nil || len(req.Catatan) > 2000 {
		Error(w, 400, "Tanggal, jam buka, atau catatan jadwal belum valid")
		return
	}
	var value map[string]interface{}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		value = map[string]interface{}{"id_jadwal": req.TanggalLelang, "tanggal_lelang": req.TanggalLelang, "jam_buka": req.JamBuka, "status": "terjadwal", "catatan": req.Catatan, "updated_at": rtdbNow()}
		treeNode(root, "schedules")[req.TanggalLelang] = value
		return nil
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Data: value})
}

func ListCategoriesRTDB(w http.ResponseWriter, r *http.Request) {
	values, err := rtdbCollection(r.Context(), "categories")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Data: collectionList(values)})
}

func SetCategoryRTDB(w http.ResponseWriter, r *http.Request) {
	var req AturDurasiKategoriRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	req.NamaKategori = strings.TrimSpace(req.NamaKategori)
	if req.NamaKategori == "" || len(req.NamaKategori) > 100 || strings.ContainsAny(req.NamaKategori, ".#$[]/\\") || req.DurasiJam < 1 || req.DurasiJam > 168 {
		Error(w, 400, "Kategori harus valid dan durasi antara 1 sampai 168 jam")
		return
	}
	key := strings.NewReplacer(" ", "_", "&", "and", "/", "_").Replace(strings.ToLower(req.NamaKategori))
	var value map[string]interface{}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		value = map[string]interface{}{"nama_kategori": req.NamaKategori, "durasi_jam": req.DurasiJam, "updated_at": rtdbNow()}
		treeNode(root, "categories")[key] = value
		return nil
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Data: value})
}

func OpenAuctionsRTDB(w http.ResponseWriter, r *http.Request) {
	zone := time.FixedZone("WIB", 7*3600)
	opened := 0
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		today := now.In(zone).Format("2006-01-02")
		opened = 0
		schedule := treeRecord(root, "schedules", today)
		if schedule == nil {
			return domainError(409, "Atur jadwal harian untuk hari ini terlebih dahulu")
		}
		start, err := auctionTime(today + " " + stringValue(schedule["jam_buka"], ""))
		if err != nil || now.Before(start) {
			return domainError(409, "Jadwal harian belum dimulai atau belum valid")
		}
		for _, value := range treeMap(root["auctions"]) {
			auction := treeMap(value)
			if auction == nil || auction["legacy_historical"] == true || rtdbNumericID(auction["id_sesi"]) > 0 {
				continue
			}
			status := stringValue(auction["status"], "")
			if status != "draft" && status != "terjadwal" {
				continue
			}
			item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(auction["id_barang"])))
			if item == nil || stringValue(item["status_verifikasi"], "") != "approved" {
				continue
			}
			if status == "draft" || stringValue(auction["tgl_mulai"], "") == "" {
				duration := 8
				for _, categoryValue := range treeMap(root["categories"]) {
					category := treeMap(categoryValue)
					if stringValue(category["nama_kategori"], "") == stringValue(item["kategori"], "") {
						duration = rtdbNumericID(category["durasi_jam"])
						break
					}
				}
				if duration < 1 || duration > 168 {
					return domainError(409, "Durasi kategori belum valid")
				}
				auction["tgl_mulai"], auction["tgl_selesai"], auction["durasi_jam"] = start.UTC().Format(time.RFC3339Nano), start.Add(time.Duration(duration)*time.Hour).UTC().Format(time.RFC3339Nano), duration
			}
			aStart, e1 := auctionTime(auction["tgl_mulai"])
			end, e2 := auctionTime(auction["tgl_selesai"])
			if e1 != nil || e2 != nil || aStart.In(zone).Format("2006-01-02") != today || now.Before(aStart) || !now.Before(end) {
				continue
			}
			auction["status"] = "dibuka"
			opened++
		}
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Lelang hari ini diproses sesuai jadwal", Data: map[string]interface{}{"opened": opened}})
}

func CreateOfficerAuctionRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Barang map[string]interface{} `json:"barang"`
		Lelang map[string]interface{} `json:"lelang"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	item := map[string]interface{}{}
	for _, key := range []string{"nama_barang", "harga_awal", "kategori", "deskripsi_barang", "foto_barang", "dokumen_pendukung", "spesifikasi", "reserve_price", "estimasi_pasar"} {
		if value, ok := req.Barang[key]; ok {
			item[key] = value
		}
	}
	if err := validateItemData(item); err != nil {
		rtdbJSONError(w, err)
		return
	}
	increment, hold, reserve := numberValue(req.Lelang["kelipatan_minimal"]), numberValue(req.Lelang["uang_jaminan"]), numberValue(item["reserve_price"])
	if !wholeRupiah(increment, 1) || !wholeRupiah(hold, 0) || !wholeRupiah(reserve, 0) {
		Error(w, 400, "Konfigurasi nilai lelang belum valid")
		return
	}
	auction := map[string]interface{}{"status": "draft", "harga_akhir": 0, "id_user": nil, "kelipatan_minimal": increment, "uang_jaminan": hold, "reserve_price": reserve, "id_petugas": rtdbClaimsFromRequest(r).ID, "tgl_mulai": "", "tgl_selesai": ""}
	startText, endText := stringValue(req.Lelang["tgl_mulai"], ""), stringValue(req.Lelang["tgl_selesai"], "")
	var itemID, auctionID int
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		auction["created_at"] = now.UTC().Format(time.RFC3339Nano)
		if startText != "" || endText != "" {
			start, e1 := auctionTime(startText)
			end, e2 := auctionTime(endText)
			if e1 != nil || e2 != nil || !end.After(start) || !end.After(now) || start.Before(now.Add(-5*time.Minute)) || end.Sub(start) > 168*time.Hour {
				return domainError(400, "Jadwal lelang harus valid dan belum berakhir")
			}
			auction["tgl_mulai"], auction["tgl_selesai"], auction["status"] = start.UTC().Format(time.RFC3339Nano), end.UTC().Format(time.RFC3339Nano), "terjadwal"
			if !now.Before(start) {
				auction["status"] = "dibuka"
			}
		}
		itemID, auctionID = nextTreeID(root, "items"), nextTreeID(root, "auctions")
		item["id_barang"], item["id_user"], item["status_verifikasi"], item["tanggal"], item["created_at"] = itemID, nil, "approved", now.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano)
		auction["id_lelang"], auction["id_barang"] = auctionID, itemID
		treeNode(root, "items")[rtdbPathID(itemID)] = item
		treeNode(root, "auctions")[rtdbPathID(auctionID)] = auction
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 201, Response{Success: true, Data: map[string]interface{}{"id_barang": itemID, "id_lelang": auctionID}})
}

func UpdateAuctionStatusRTDB(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		Error(w, 400, "ID lelang tidak valid")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	if req.Status != "dibuka" && req.Status != "ditutup" && req.Status != "dibatalkan" {
		Error(w, 400, "Status lelang tidak valid")
		return
	}
	err = rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		auction := treeRecord(root, "auctions", rtdbPathID(id))
		if auction == nil {
			return domainError(404, "Lelang tidak ditemukan")
		}
		if req.Status == "ditutup" || req.Status == "dibatalkan" {
			return settleAuction(root, rtdbPathID(id), req.Status == "dibatalkan", now)
		}
		if auction["legacy_historical"] == true || auction["settled_at"] != nil || stringValue(auction["status"], "") != "terjadwal" {
			return domainError(409, "Hanya lelang terjadwal yang dapat dibuka")
		}
		start, e1 := auctionTime(auction["tgl_mulai"])
		end, e2 := auctionTime(auction["tgl_selesai"])
		if e1 != nil || e2 != nil || now.Before(start) || !now.Before(end) {
			return domainError(409, "Lelang tidak berada dalam jadwal aktif")
		}
		auction["status"] = "dibuka"
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Status lelang diperbarui"})
}
