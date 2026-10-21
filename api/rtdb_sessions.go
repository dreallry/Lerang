package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type createSessionRequest struct {
	Judul        string `json:"judul"`
	Deskripsi    string `json:"deskripsi"`
	Tipe         string `json:"tipe"`
	TglMulai     string `json:"tgl_mulai"`
	Durasi       int    `json:"durasi_default_jam"`
	Gambar       string `json:"gambar_banner"`
	Kurator      string `json:"kurator"`
	IDLelangList []int  `json:"id_lelang_list"`
}

func sessionStaff(claims *RTDBClaims) error {
	if claims == nil || (claims.Role != RoleAdministrator && claims.Role != RolePetugas) {
		return domainError(http.StatusForbidden, "Manajemen sesi memerlukan akun petugas")
	}
	return nil
}

func sessionCanChange(session map[string]interface{}, now time.Time) error {
	if session == nil {
		return domainError(http.StatusNotFound, "Sesi lelang tidak ditemukan")
	}
	if session["legacy_historical"] == true || session["status"] != "upcoming" || session["canceled_at"] != nil {
		return domainError(http.StatusConflict, "Sesi sudah berjalan, selesai, atau merupakan riwayat lama")
	}
	start, err := auctionTime(session["tgl_mulai"])
	if err != nil || !now.Before(start) {
		return domainError(http.StatusConflict, "Waktu mulai sesi sudah terlewati")
	}
	return nil
}

func sessionLotCanChange(root, auction map[string]interface{}, now time.Time) error {
	if auction == nil {
		return domainError(http.StatusNotFound, "Lot lelang tidak ditemukan")
	}
	id := rtdbPathID(rtdbNumericID(auction["id_lelang"]))
	status := stringValue(auction["status"], "")
	if auction["legacy_historical"] == true || auction["settled_at"] != nil || (status != "draft" && status != "terjadwal") || rtdbNumericID(auction["id_user"]) > 0 || len(treeMap(treeMap(root["bids"])[id])) > 0 || len(treeMap(treeMap(root["holds"])[id])) > 0 {
		return domainError(http.StatusConflict, "Lot yang sudah berjalan atau memiliki transaksi tidak dapat dipindahkan")
	}
	if status == "terjadwal" {
		start, err := auctionTime(auction["tgl_mulai"])
		if err != nil || !now.Before(start) {
			return domainError(http.StatusConflict, "Jadwal lot sudah dimulai atau perlu diperiksa")
		}
	}
	for _, value := range treeMap(root["invoices"]) {
		if rtdbNumericID(treeMap(value)["id_lelang"]) == rtdbNumericID(auction["id_lelang"]) {
			return domainError(http.StatusConflict, "Lot yang sudah memiliki tagihan tidak dapat diubah")
		}
	}
	item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(auction["id_barang"])))
	if item == nil || item["status_verifikasi"] != "approved" {
		return domainError(http.StatusConflict, "Barang lot belum disetujui kurator")
	}
	return nil
}

func rebuildSessionLots(root map[string]interface{}, sessionID int) {
	session := treeRecord(root, "sessions", rtdbPathID(sessionID))
	if session == nil {
		return
	}
	ids := make([]int, 0)
	for _, value := range treeMap(root["auctions"]) {
		auction := treeMap(value)
		if auction != nil && rtdbNumericID(auction["id_sesi"]) == sessionID {
			ids = append(ids, rtdbNumericID(auction["id_lelang"]))
		}
	}
	sort.Ints(ids)
	session["id_lelang_list"] = ids
}

func assignSessionLot(root map[string]interface{}, sessionID, auctionID, duration int, now time.Time) error {
	session := treeRecord(root, "sessions", rtdbPathID(sessionID))
	if err := sessionCanChange(session, now); err != nil {
		return err
	}
	auction := treeRecord(root, "auctions", rtdbPathID(auctionID))
	if err := sessionLotCanChange(root, auction, now); err != nil {
		return err
	}
	previousID := rtdbNumericID(auction["id_sesi"])
	if previousID > 0 && previousID != sessionID {
		if err := sessionCanChange(treeRecord(root, "sessions", rtdbPathID(previousID)), now); err != nil {
			return err
		}
	}
	if duration == 0 {
		duration = rtdbNumericID(session["durasi_default_jam"])
	}
	if duration < 1 || duration > 168 {
		return domainError(http.StatusBadRequest, "Durasi lot harus antara 1 dan 168 jam")
	}
	start, _ := auctionTime(session["tgl_mulai"])
	auction["id_sesi"], auction["status"], auction["durasi_jam"] = sessionID, "terjadwal", duration
	auction["tgl_mulai"], auction["tgl_selesai"], auction["updated_at"] = start.UTC().Format(time.RFC3339Nano), start.Add(time.Duration(duration)*time.Hour).UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano)
	if previousID > 0 && previousID != sessionID {
		rebuildSessionLots(root, previousID)
	}
	rebuildSessionLots(root, sessionID)
	return nil
}

func createSessionInTree(root map[string]interface{}, req createSessionRequest, claims *RTDBClaims, now time.Time) (map[string]interface{}, error) {
	if err := sessionStaff(claims); err != nil {
		return nil, err
	}
	req.Judul = strings.TrimSpace(req.Judul)
	if req.Judul == "" || len(req.Judul) > 200 || len(req.Deskripsi) > 5000 || len(req.Gambar) > 2000 || len(req.Kurator) > 200 || req.Durasi < 1 || req.Durasi > 168 || len(req.IDLelangList) > 1000 {
		return nil, domainError(http.StatusBadRequest, "Judul, durasi, atau isi sesi belum valid")
	}
	if req.Tipe != "reguler" && req.Tipe != "tematik" && req.Tipe != "flash" {
		return nil, domainError(http.StatusBadRequest, "Jenis sesi lelang tidak valid")
	}
	start, err := auctionTime(req.TglMulai)
	if err != nil || !start.After(now) {
		return nil, domainError(http.StatusBadRequest, "Waktu mulai sesi harus di masa depan")
	}
	seen := map[int]bool{}
	for _, id := range req.IDLelangList {
		if id <= 0 || seen[id] {
			return nil, domainError(http.StatusBadRequest, "Daftar lot berisi ID tidak valid atau duplikat")
		}
		seen[id] = true
		if err := sessionLotCanChange(root, treeRecord(root, "auctions", rtdbPathID(id)), now); err != nil {
			return nil, err
		}
	}
	id := nextTreeID(root, "sessions")
	session := map[string]interface{}{"id_sesi": id, "judul": req.Judul, "deskripsi": strings.TrimSpace(req.Deskripsi), "tipe": req.Tipe, "tgl_mulai": start.UTC().Format(time.RFC3339Nano), "durasi_default_jam": req.Durasi, "gambar_banner": strings.TrimSpace(req.Gambar), "kurator": strings.TrimSpace(req.Kurator), "id_lelang_list": []int{}, "status": "upcoming", "created_by": claims.ID, "created_at": now.UTC().Format(time.RFC3339Nano)}
	treeNode(root, "sessions")[rtdbPathID(id)] = session
	for _, auctionID := range req.IDLelangList {
		if err := assignSessionLot(root, id, auctionID, 0, now); err != nil {
			return nil, err
		}
	}
	return session, nil
}

func CreateSessionRTDB(w http.ResponseWriter, r *http.Request) {
	var req createSessionRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format sesi tidak valid")
		return
	}
	var saved map[string]interface{}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		var err error
		saved, err = createSessionInTree(root, req, rtdbClaimsFromRequest(r), time.Now())
		return err
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusCreated, Response{Success: true, Message: "Sesi dan jadwal lot tersimpan", Data: saved})
}

func sessionRequestIDs(r *http.Request) (int, int, error) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		return 0, 0, domainError(http.StatusBadRequest, "ID sesi tidak valid")
	}
	auctionID, err := strconv.Atoi(r.PathValue("lelangId"))
	if err != nil || auctionID <= 0 {
		return 0, 0, domainError(http.StatusBadRequest, "ID lot tidak valid")
	}
	return id, auctionID, nil
}

func AssignSessionLotRTDB(w http.ResponseWriter, r *http.Request) {
	if err := sessionStaff(rtdbClaimsFromRequest(r)); err != nil {
		rtdbJSONError(w, err)
		return
	}
	id, auctionID, err := sessionRequestIDs(r)
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	var req struct {
		Durasi int `json:"durasi_jam"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format durasi tidak valid")
		return
	}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return assignSessionLot(root, id, auctionID, req.Durasi, time.Now())
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Lot dijadwalkan dalam sesi"})
}

func RemoveSessionLotRTDB(w http.ResponseWriter, r *http.Request) {
	if err := sessionStaff(rtdbClaimsFromRequest(r)); err != nil {
		rtdbJSONError(w, err)
		return
	}
	id, auctionID, err := sessionRequestIDs(r)
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		if err := sessionCanChange(treeRecord(root, "sessions", rtdbPathID(id)), now); err != nil {
			return err
		}
		lot := treeRecord(root, "auctions", rtdbPathID(auctionID))
		if err := sessionLotCanChange(root, lot, now); err != nil {
			return err
		}
		if rtdbNumericID(lot["id_sesi"]) != id {
			return domainError(http.StatusConflict, "Lot tidak terhubung dengan sesi ini")
		}
		lot["id_sesi"], lot["tgl_mulai"], lot["tgl_selesai"], lot["status"], lot["updated_at"] = nil, nil, nil, "draft", now.UTC().Format(time.RFC3339Nano)
		rebuildSessionLots(root, id)
		return nil
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Lot dikembalikan ke daftar belum terjadwal"})
}

func cancelSessionInTree(root map[string]interface{}, id int, now time.Time) error {
	session := treeRecord(root, "sessions", rtdbPathID(id))
	if session == nil {
		return domainError(http.StatusNotFound, "Sesi tidak ditemukan")
	}
	if session["canceled_at"] != nil {
		return nil
	}
	if session["legacy_historical"] == true || session["status"] == "closed" {
		return domainError(http.StatusConflict, "Sesi lama atau selesai tidak dapat dibatalkan")
	}
	start, err := auctionTime(session["tgl_mulai"])
	if err != nil {
		return domainError(http.StatusConflict, "Waktu mulai sesi tidak valid")
	}
	upcoming := session["status"] == "upcoming" && now.Before(start)
	for key, value := range treeMap(root["auctions"]) {
		lot := treeMap(value)
		if lot == nil || rtdbNumericID(lot["id_sesi"]) != id {
			continue
		}
		if upcoming {
			if err := sessionLotCanChange(root, lot, now); err != nil {
				return err
			}
			lot["id_sesi"], lot["tgl_mulai"], lot["tgl_selesai"], lot["status"], lot["updated_at"] = nil, nil, nil, "draft", now.UTC().Format(time.RFC3339Nano)
		} else if lot["status"] != "ditutup" && lot["status"] != "dibatalkan" {
			if err := settleAuction(root, key, true, now); err != nil {
				return err
			}
		}
	}
	session["status"], session["canceled_at"] = "closed", now.UTC().Format(time.RFC3339Nano)
	rebuildSessionLots(root, id)
	return nil
}

func CancelSessionRTDB(w http.ResponseWriter, r *http.Request) {
	if err := sessionStaff(rtdbClaimsFromRequest(r)); err != nil {
		rtdbJSONError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		Error(w, http.StatusBadRequest, "ID sesi tidak valid")
		return
	}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error { return cancelSessionInTree(root, id, time.Now()) }); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Pembatalan sesi dan status seluruh lot tersimpan"})
}
