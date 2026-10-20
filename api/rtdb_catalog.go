package api

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

func rtdbItems(ctx context.Context) (map[string]map[string]interface{}, error) {
	items := map[string]map[string]interface{}{}
	err := rtdbGet(ctx, "items", &items)
	return items, err
}

func rtdbItemList(items map[string]map[string]interface{}) []map[string]interface{} {
	list := make([]map[string]interface{}, 0, len(items))
	for key, item := range items {
		if item == nil {
			continue
		}
		if _, ok := item["id_barang"]; !ok {
			item["id_barang"] = rtdbNumericID(key)
		}
		formatDisplayFields(item, "nama_barang", "deskripsi_barang")
		list = append(list, item)
	}
	sort.SliceStable(list, func(i, j int) bool { return rtdbNumericID(list[i]["id_barang"]) > rtdbNumericID(list[j]["id_barang"]) })
	return list
}

func publicItem(item map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{}
	for key, value := range item {
		switch key {
		case "reserve_price", "firebase_uid", "dokumen_pendukung", "catatan_kurasi":
			continue
		}
		result[key] = value
	}
	formatDisplayFields(result, "nama_barang", "deskripsi_barang")
	return result
}

func validateItemData(item map[string]interface{}) error {
	name, category := strings.TrimSpace(stringValue(item["nama_barang"], "")), stringValue(item["kategori"], "")
	allowed := map[string]bool{"Kendaraan": true, "Elektronik & Gadget": true, "Properti": true, "Barang Mewah & Jam": true, "Koleksi & Seni": true, "Lainnya": true}
	if name == "" || len(name) > 200 || !allowed[category] || !wholeRupiah(numberValue(item["harga_awal"]), 100000) || len(stringValue(item["deskripsi_barang"], "")) > 20000 || !wholeRupiah(numberValue(item["reserve_price"]), 0) {
		return domainError(400, "Nama, kategori, harga awal minimal Rp 100.000, atau harga cadangan belum valid")
	}
	for _, field := range []string{"foto_barang", "dokumen_pendukung"} {
		var values []string
		switch list := item[field].(type) {
		case []string:
			values = list
		case []interface{}:
			for _, value := range list {
				text, ok := value.(string)
				if !ok {
					return domainError(400, "Tautan foto atau dokumen belum valid")
				}
				values = append(values, text)
			}
		case nil:
		default:
			return domainError(400, "Daftar foto atau dokumen belum valid")
		}
		if len(values) > 12 {
			return domainError(400, "Maksimal 12 foto atau dokumen per barang")
		}
		for _, value := range values {
			if field == "foto_barang" && serverPhotoPath.MatchString(value) {
				continue
			}
			parsed, err := url.Parse(value)
			if err != nil || len(value) > 4096 || ((parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "") {
				return domainError(400, "Gunakan tautan foto atau dokumen HTTP/HTTPS yang valid")
			}
		}
	}
	item["nama_barang"] = name
	return nil
}

func ListCatalogRTDB(w http.ResponseWriter, r *http.Request) {
	items, err := rtdbItems(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	category := strings.TrimSpace(r.URL.Query().Get("kategori"))
	list := rtdbItemList(items)
	filtered := make([]map[string]interface{}, 0, len(list))
	for _, item := range list {
		status := stringValue(item["status_verifikasi"], "approved")
		if status != "approved" {
			continue
		}
		if category != "" && stringValue(item["kategori"], "") != category {
			continue
		}
		filtered = append(filtered, publicItem(item))
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: filtered})
}

func ListAllItemsRTDB(w http.ResponseWriter, r *http.Request) {
	items, err := rtdbItems(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: rtdbItemList(items)})
}

func GetMyItemsRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	items, err := rtdbItems(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0)
	for _, item := range rtdbItemList(items) {
		if rtdbNumericID(item["id_user"]) == claims.ID {
			list = append(list, item)
		}
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: list})
}

func GetDetailBarangRTDB(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		Error(w, 400, "ID barang tidak valid")
		return
	}
	var item map[string]interface{}
	if err := rtdbGet(r.Context(), "items/"+rtdbPathID(id), &item); err != nil || len(item) == 0 || stringValue(item["status_verifikasi"], "approved") != "approved" {
		Error(w, 404, "Barang tidak ditemukan")
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: publicItem(item)})
}

func SubmitBarangRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	if claims == nil {
		Error(w, 401, "Silakan login")
		return
	}
	var req SubmitBarangRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	item := map[string]interface{}{
		"id_user": claims.ID, "firebase_uid": claims.UID,
		"nama_barang": strings.TrimSpace(req.NamaBarang), "tanggal": rtdbNow(),
		"harga_awal": req.HargaAwal, "deskripsi_barang": strings.TrimSpace(req.DeskripsiBarang),
		"kategori": req.Kategori, "foto_barang": req.FotoBarang, "dokumen_pendukung": req.DokumenPendukung,
		"spesifikasi": req.Spesifikasi, "reserve_price": req.ReservePrice, "estimasi_pasar": req.EstimasiPasar,
		"status_verifikasi": "pending", "created_at": rtdbNow(),
	}
	if err := validateItemData(item); err != nil {
		rtdbJSONError(w, err)
		return
	}
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		if _, err := transactionProfile(root, claims); err != nil {
			return err
		}
		id := nextTreeID(root, "items")
		item["id_barang"] = id
		treeNode(root, "items")[rtdbPathID(id)] = item
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusCreated, Response{Success: true, Data: item})
}

func updateItemInTree(root map[string]interface{}, claims *RTDBClaims, id string, req map[string]interface{}) error {
	if claims == nil {
		return domainError(401, "Sesi peserta atau petugas diperlukan")
	}
	item := treeRecord(root, "items", id)
	if item == nil {
		return domainError(404, "Barang tidak ditemukan")
	}
	status := stringValue(item["status_verifikasi"], "")
	if claims.Role == RoleMasyarakat && (rtdbNumericID(item["id_user"]) != claims.ID || (status != "pending" && status != "rejected")) {
		return domainError(403, "Barang bukan pengajuan yang dapat diubah akun ini")
	}
	if claims.Role != RoleMasyarakat {
		if err := sessionStaff(claims); err != nil {
			return err
		}
	}
	for key, value := range treeMap(root["auctions"]) {
		auction := treeMap(value)
		if rtdbNumericID(auction["id_barang"]) != rtdbNumericID(id) {
			continue
		}
		if auction["legacy_historical"] == true || auction["settled_at"] != nil || auction["status"] == "dibuka" || len(treeMap(treeMap(root["bids"])[key])) > 0 || len(treeMap(treeMap(root["holds"])[key])) > 0 {
			return domainError(409, "Barang yang sudah memiliki transaksi atau riwayat tidak dapat diubah")
		}
	}
	next := map[string]interface{}{}
	for key, value := range item {
		next[key] = value
	}
	count := 0
	for _, key := range []string{"nama_barang", "harga_awal", "kategori", "deskripsi_barang", "reserve_price", "estimasi_pasar", "foto_barang", "dokumen_pendukung", "spesifikasi"} {
		if value, ok := req[key]; ok {
			next[key] = value
			count++
		}
	}
	if count == 0 {
		return domainError(400, "Tidak ada perubahan yang dikirim")
	}
	if err := validateItemData(next); err != nil {
		return err
	}
	if claims.Role == RoleMasyarakat && status == "rejected" {
		next["status_verifikasi"], next["catatan_kurasi"] = "pending", ""
	}
	next["updated_at"] = rtdbNow()
	treeNode(root, "items")[id] = next
	return nil
}

func UpdateBarangInfoRTDB(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if rtdbNumericID(id) <= 0 {
		Error(w, 400, "ID barang tidak valid")
		return
	}
	var req map[string]interface{}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return updateItemInTree(root, rtdbClaimsFromRequest(r), id, req)
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Perubahan barang tersimpan"})
}

func CancelSubmissionRTDB(w http.ResponseWriter, r *http.Request) {
	claims, id := rtdbClaimsFromRequest(r), r.PathValue("id")
	if rtdbNumericID(id) <= 0 {
		Error(w, 400, "ID barang tidak valid")
		return
	}
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		if claims == nil || claims.Role != RoleMasyarakat {
			return domainError(403, "Hanya pemilik peserta dapat membatalkan pengajuan")
		}
		item := treeRecord(root, "items", id)
		if item == nil {
			return nil
		}
		if rtdbNumericID(item["id_user"]) != claims.ID || item["status_verifikasi"] != "pending" {
			return domainError(403, "Pengajuan tidak dapat dibatalkan")
		}
		delete(treeNode(root, "items"), id)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Pengajuan barang dibatalkan"})
}

func ListPendingBarangRTDB(w http.ResponseWriter, r *http.Request) {
	items, err := rtdbItems(r.Context())
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0)
	for _, item := range rtdbItemList(items) {
		if stringValue(item["status_verifikasi"], "") == "pending" {
			list = append(list, item)
		}
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: list})
}

func ValidateBarangRTDB(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		Error(w, 400, "ID barang tidak valid")
		return
	}
	var req ValidasiBarangRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	if req.Status != "approved" && req.Status != "rejected" || len(req.CatatanKurasi) > 2000 || req.Status == "rejected" && strings.TrimSpace(req.CatatanKurasi) == "" {
		Error(w, 400, "Keputusan kurasi atau catatan belum valid")
		return
	}
	if req.Status == "approved" && (!wholeRupiah(req.KelipatanMinimal, 1) || !wholeRupiah(req.UangJaminan, 0) || !wholeRupiah(req.ReservePrice, 0)) {
		Error(w, 400, "Nilai jaminan, kelipatan, atau cadangan belum valid")
		return
	}
	now := time.Now()
	err = rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		item := treeRecord(root, "items", rtdbPathID(id))
		if item == nil {
			return domainError(404, "Barang tidak ditemukan")
		}
		state := stringValue(item["status_verifikasi"], "")
		if state == req.Status {
			return nil
		}
		if state != "pending" {
			return domainError(409, "Hanya pengajuan menunggu kurasi yang dapat diputuskan")
		}
		if err := validateItemData(item); err != nil {
			return err
		}
		item["status_verifikasi"], item["catatan_kurasi"], item["updated_at"] = req.Status, strings.TrimSpace(req.CatatanKurasi), now.UTC().Format(time.RFC3339Nano)
		if req.Status == "approved" {
			auctionID := nextTreeID(root, "auctions")
			item["reserve_price"] = req.ReservePrice
			treeNode(root, "auctions")[rtdbPathID(auctionID)] = map[string]interface{}{"id_lelang": auctionID, "id_barang": id, "id_petugas": rtdbClaimsFromRequest(r).ID, "status": "draft", "tgl_mulai": "", "tgl_selesai": "", "durasi_jam": 8, "kelipatan_minimal": req.KelipatanMinimal, "uang_jaminan": req.UangJaminan, "harga_awal": item["harga_awal"], "harga_akhir": 0, "id_user": nil, "reserve_price": req.ReservePrice, "is_reserve_met": false, "created_at": now.UTC().Format(time.RFC3339Nano)}
		}
		uid := stringValue(item["firebase_uid"], userUID(root, rtdbNumericID(item["id_user"])))
		if treeRecord(root, "users", uid) != nil {
			notifyUser(root, uid, "curation-"+rtdbPathID(id)+"-"+req.Status, "Keputusan pengajuan barang", req.CatatanKurasi, "curation", "my-listings", now)
		}
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Status barang berhasil diperbarui"})
}
