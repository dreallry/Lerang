package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// SubmitBarang - ALUR 1: User memasukkan barang ke sistem lelang C2C
// ALUR 3: Dihitung target lelang 3 hari ke depan (tanggal masuk + 2 hari kalender: misal Senin -> Rabu)
func SubmitBarang(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login terlebih dahulu untuk mengajukan barang")
		return
	}

	var req SubmitBarangRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	req.NamaBarang = strings.TrimSpace(req.NamaBarang)
	req.DeskripsiBarang = strings.TrimSpace(req.DeskripsiBarang)
	req.Kategori = strings.TrimSpace(req.Kategori)

	if req.NamaBarang == "" {
		Error(w, http.StatusBadRequest, "Nama barang wajib diisi")
		return
	}
	if req.HargaAwal < 100000 {
		Error(w, http.StatusBadRequest, "Harga limit awal pembuka lelang minimal Rp 100.000")
		return
	}
	if req.ReservePrice > 0 && req.ReservePrice < req.HargaAwal {
		Error(w, http.StatusBadRequest, "Harga cadangan rahasia (reserve price) tidak boleh lebih rendah dari harga awal")
		return
	}
	if len(req.FotoBarang) < 3 {
		Error(w, http.StatusBadRequest, fmt.Sprintf("Lampirkan minimal 3 foto barang dari berbagai sudut (saat ini %d foto)", len(req.FotoBarang)))
		return
	}
	if len(req.DeskripsiBarang) < 20 {
		Error(w, http.StatusBadRequest, "Deskripsi barang minimal 20 karakter untuk kejelasan kondisi fisik")
		return
	}

	// Tanggal barang masuk (Hari ini)
	now := time.Now()
	tglMasukStr := now.Format("2006-01-02")

	// ALUR 3: Barang dilelang di 3 hari kedepannya
	// Contoh kasus: masuk Senin -> Rabu (+2 hari), masuk Selasa -> Kamis (+2 hari), dst.
	tglLelangTarget := now.AddDate(0, 0, 2)
	tglLelangTargetStr := tglLelangTarget.Format("2006-01-02")

	fotoJSON, _ := json.Marshal(req.FotoBarang)
	dokumenJSON, _ := json.Marshal(req.DokumenPendukung)
	spekJSON, _ := json.Marshal(req.Spesifikasi)

	res, err := DB.Exec(`
		INSERT INTO tb_barang (
			nama_barang, tanggal, harga_awal, deskripsi_barang, kategori,
			foto_barang, dokumen_pendukung, spesifikasi, id_user,
			status_verifikasi, catatan_kurasi, estimasi_pasar, reserve_price,
			tanggal_lelang_target, is_featured
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'Menunggu verifikasi dan kurasi dari Admin/Petugas', ?, ?, ?, 0)`,
		req.NamaBarang, tglMasukStr, req.HargaAwal, req.DeskripsiBarang, req.Kategori,
		string(fotoJSON), string(dokumenJSON), string(spekJSON), claims.ID,
		req.EstimasiPasar, req.ReservePrice, tglLelangTargetStr,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyimpan barang ke database: "+err.Error())
		return
	}

	idBarang, _ := res.LastInsertId()

	// Buat notifikasi otomatis untuk user
	notifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano()%10000000)
	namaHariMasuk := NamaHariIndo(now.Weekday())
	namaHariLelang := NamaHariIndo(tglLelangTarget.Weekday())

	pesanNotif := fmt.Sprintf(
		"Pengajuan lelang barang \"%s\" berhasil diajukan pada hari %s (%s). Menunggu cek dan validasi admin. Jika disetujui, lelang akan dijadwalkan pada hari %s (%s).",
		req.NamaBarang, namaHariMasuk, tglMasukStr, namaHariLelang, tglLelangTargetStr,
	)

	_, _ = DB.Exec(`
		INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
		VALUES (?, ?, 'Pengajuan Barang C2C Terkirim', ?, 'system', 0, 'my-listings')`,
		notifID, claims.ID, pesanNotif,
	)

	JSON(w, http.StatusCreated, Response{
		Success: true,
		Message: fmt.Sprintf("Barang berhasil diajukan! Dijadwalkan lelang pada %s (%s) setelah divalidasi admin.", namaHariLelang, tglLelangTargetStr),
		Data: map[string]any{
			"id_barang":             idBarang,
			"nama_barang":           req.NamaBarang,
			"tanggal_masuk":         tglMasukStr,
			"hari_masuk":            namaHariMasuk,
			"tanggal_lelang_target": tglLelangTargetStr,
			"hari_lelang_target":    namaHariLelang,
			"status_verifikasi":     "pending",
		},
	})
}

// GetBarangUser menampilkan daftar barang yang diajukan oleh user login
func GetBarangUser(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login terlebih dahulu")
		return
	}

	rows, err := DB.Query(`
		SELECT id_barang, nama_barang, tanggal, harga_awal, deskripsi_barang, kategori,
		       foto_barang, IFNULL(dokumen_pendukung,'[]'), IFNULL(spesifikasi,'{}'),
		       status_verifikasi, IFNULL(catatan_kurasi,''), IFNULL(estimasi_pasar,0),
		       IFNULL(reserve_price,0), IFNULL(tanggal_lelang_target,'')
		FROM tb_barang WHERE id_user = ? ORDER BY id_barang DESC`, claims.ID)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil data barang: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var nama, tgl, desk, kat, fotoStr, dokStr, spekStr, status, catatan, tglTarget string
		var harga, estimasi, reserve float64

		if err := rows.Scan(&id, &nama, &tgl, &harga, &desk, &kat, &fotoStr, &dokStr, &spekStr, &status, &catatan, &estimasi, &reserve, &tglTarget); err != nil {
			continue
		}

		var fotoArr []string
		_ = json.Unmarshal([]byte(fotoStr), &fotoArr)
		var dokArr []string
		_ = json.Unmarshal([]byte(dokStr), &dokArr)
		var spekMap map[string]string
		_ = json.Unmarshal([]byte(spekStr), &spekMap)

		list = append(list, map[string]any{
			"id_barang":             id,
			"nama_barang":           nama,
			"tanggal":               tgl,
			"harga_awal":            harga,
			"deskripsi_barang":      desk,
			"kategori":              kat,
			"foto_barang":           fotoArr,
			"dokumen_pendukung":     dokArr,
			"spesifikasi":           spekMap,
			"status_verifikasi":     status,
			"catatan_kurasi":        catatan,
			"estimasi_pasar":        estimasi,
			"reserve_price":         reserve,
			"tanggal_lelang_target": tglTarget,
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// GetCatalogBarang menampilkan barang yang disetujui (approved) untuk katalog publik
func GetCatalogBarang(w http.ResponseWriter, r *http.Request) {
	kategori := r.URL.Query().Get("kategori")
	query := `
		SELECT b.id_barang, b.nama_barang, b.tanggal, b.harga_awal, b.deskripsi_barang, b.kategori,
		       b.foto_barang, IFNULL(b.dokumen_pendukung,'[]'), IFNULL(b.spesifikasi,'{}'),
		       b.status_verifikasi, IFNULL(b.estimasi_pasar,0), IFNULL(b.reserve_price,0),
		       IFNULL(b.tanggal_lelang_target,''), IFNULL(b.id_user,0),
		       IFNULL(l.id_lelang, 0), IFNULL(l.status, 'draft'), IFNULL(l.harga_akhir, b.harga_awal),
		       IFNULL(l.tgl_mulai, ''), IFNULL(l.tgl_selesai, ''), IFNULL(l.kelipatan_minimal, 500000), IFNULL(l.uang_jaminan, 2000000)
		FROM tb_barang b
		LEFT JOIN tb_lelang l ON l.id_barang = b.id_barang
		WHERE b.status_verifikasi = 'approved'`

	var args []any
	if kategori != "" {
		query += " AND b.kategori = ?"
		args = append(args, kategori)
	}
	query += " ORDER BY b.id_barang DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil katalog: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, idUser, idLelang int
		var nama, tgl, desk, kat, fotoStr, dokStr, spekStr, statusVerif, tglTarget, statusLelang, tglMulai, tglSelesai string
		var hargaAwal, estimasi, reserve, hargaAkhir, kelipatan, uangJaminan float64

		if err := rows.Scan(
			&id, &nama, &tgl, &hargaAwal, &desk, &kat, &fotoStr, &dokStr, &spekStr, &statusVerif,
			&estimasi, &reserve, &tglTarget, &idUser,
			&idLelang, &statusLelang, &hargaAkhir, &tglMulai, &tglSelesai, &kelipatan, &uangJaminan,
		); err != nil {
			continue
		}

		var fotoArr []string
		_ = json.Unmarshal([]byte(fotoStr), &fotoArr)
		var dokArr []string
		_ = json.Unmarshal([]byte(dokStr), &dokArr)
		var spekMap map[string]string
		_ = json.Unmarshal([]byte(spekStr), &spekMap)

		list = append(list, map[string]any{
			"id_barang":             id,
			"nama_barang":           nama,
			"tanggal":               tgl,
			"harga_awal":            hargaAwal,
			"deskripsi_barang":      desk,
			"kategori":              kat,
			"foto_barang":           fotoArr,
			"dokumen_pendukung":     dokArr,
			"spesifikasi":           spekMap,
			"status_verifikasi":     statusVerif,
			"estimasi_pasar":        estimasi,
			"tanggal_lelang_target": tglTarget,
			"id_user":               idUser,
			"lelang": map[string]any{
				"id_lelang":         idLelang,
				"status":            statusLelang,
				"harga_akhir":       hargaAkhir,
				"tgl_mulai":         tglMulai,
				"tgl_selesai":       tglSelesai,
				"kelipatan_minimal": kelipatan,
				"uang_jaminan":      uangJaminan,
			},
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// GetDetailBarang mengembalikan detail spesifik sebuah barang
func GetDetailBarang(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID barang tidak valid")
		return
	}

	var nama, tgl, desk, kat, fotoStr, dokStr, spekStr, statusVerif, catatan, tglTarget string
	var idUser sql.NullInt64
	var hargaAwal, estimasi, reserve float64

	err = DB.QueryRow(`
		SELECT id_barang, nama_barang, tanggal, harga_awal, deskripsi_barang, kategori,
		       foto_barang, IFNULL(dokumen_pendukung,'[]'), IFNULL(spesifikasi,'{}'),
		       id_user, status_verifikasi, IFNULL(catatan_kurasi,''), IFNULL(estimasi_pasar,0),
		       IFNULL(reserve_price,0), IFNULL(tanggal_lelang_target,'')
		FROM tb_barang WHERE id_barang = ?`, id,
	).Scan(&id, &nama, &tgl, &hargaAwal, &desk, &kat, &fotoStr, &dokStr, &spekStr, &idUser, &statusVerif, &catatan, &estimasi, &reserve, &tglTarget)

	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Barang tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query database: "+err.Error())
		return
	}

	var fotoArr []string
	_ = json.Unmarshal([]byte(fotoStr), &fotoArr)
	var dokArr []string
	_ = json.Unmarshal([]byte(dokStr), &dokArr)
	var spekMap map[string]string
	_ = json.Unmarshal([]byte(spekStr), &spekMap)

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]any{
			"id_barang":             id,
			"nama_barang":           nama,
			"tanggal":               tgl,
			"harga_awal":            hargaAwal,
			"deskripsi_barang":      desk,
			"kategori":              kat,
			"foto_barang":           fotoArr,
			"dokumen_pendukung":     dokArr,
			"spesifikasi":           spekMap,
			"id_user":               idUser.Int64,
			"status_verifikasi":     statusVerif,
			"catatan_kurasi":        catatan,
			"estimasi_pasar":        estimasi,
			"reserve_price":         reserve,
			"tanggal_lelang_target": tglTarget,
		},
	})
}

// CancelSubmission membatalkan pengajuan barang sebelum diverifikasi admin
func CancelSubmission(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID tidak valid")
		return
	}

	res, err := DB.Exec(`DELETE FROM tb_barang WHERE id_barang = ? AND id_user = ? AND status_verifikasi = 'pending'`, id, claims.ID)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membatalkan pengajuan: "+err.Error())
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		Error(w, http.StatusBadRequest, "Barang tidak ditemukan atau sudah diverifikasi oleh admin")
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Pengajuan barang berhasil dibatalkan dan dihapus dari antrean kurasi.",
	})
}

func NamaHariIndo(w time.Weekday) string {
	switch w {
	case time.Sunday:
		return "Minggu"
	case time.Monday:
		return "Senin"
	case time.Tuesday:
		return "Selasa"
	case time.Wednesday:
		return "Rabu"
	case time.Thursday:
		return "Kamis"
	case time.Friday:
		return "Jumat"
	case time.Saturday:
		return "Sabtu"
	default:
		return ""
	}
}

// UploadFotoHandler mengunggah file foto barang ke Firebase Storage
func UploadFotoHandler(w http.ResponseWriter, r *http.Request) {
	// Limit 10MB
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		Error(w, http.StatusBadRequest, "Ukuran file terlalu besar (maksimal 10MB)")
		return
	}

	file, header, err := r.FormFile("foto")
	if err != nil {
		// Fallback cek nama 'file' atau 'image'
		file, header, err = r.FormFile("file")
		if err != nil {
			file, header, err = r.FormFile("image")
			if err != nil {
				Error(w, http.StatusBadRequest, "Pilih berkas foto untuk diunggah")
				return
			}
		}
	}
	defer file.Close()

	urlStr, storedInFirebase, err := UploadFileToFirebase(r.Context(), file, header.Filename)
	if err != nil {
		log.Printf("Gagal mengunggah foto: %v", err)
		Error(w, http.StatusInternalServerError, "Gagal mengunggah foto ke penyimpanan")
		return
	}

	message := "Foto berhasil disimpan."
	if !storedInFirebase {
		message = "Penyimpanan cloud belum dikonfigurasi; foto disimpan di perangkat server."
	}
	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: message,
		Data: map[string]any{
			"url":      urlStr,
			"filename": header.Filename,
			"firebase": storedInFirebase,
		},
	})
}

// UpdateBarangInfoHandler mengedit informasi minor barang
func UpdateBarangInfoHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID barang tidak valid")
		return
	}

	var req struct {
		NamaBarang      string   `json:"nama_barang"`
		DeskripsiBarang string   `json:"deskripsi_barang"`
		HargaAwal       float64  `json:"harga_awal"`
		Kategori        string   `json:"kategori"`
		ReservePrice    float64  `json:"reserve_price"`
		FotoBarang      []string `json:"foto_barang,omitempty"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	// Update field jika disediakan
	if len(req.FotoBarang) > 0 {
		fotoJSON, _ := json.Marshal(req.FotoBarang)
		_, _ = DB.Exec(`UPDATE tb_barang SET foto_barang = ? WHERE id_barang = ?`, string(fotoJSON), id)
	}

	_, err = DB.Exec(`
		UPDATE tb_barang SET
			nama_barang = IF(? != '', ?, nama_barang),
			deskripsi_barang = IF(? != '', ?, deskripsi_barang),
			harga_awal = IF(? > 0, ?, harga_awal),
			kategori = IF(? != '', ?, kategori),
			reserve_price = IF(? > 0, ?, reserve_price)
		WHERE id_barang = ?`,
		req.NamaBarang, req.NamaBarang,
		req.DeskripsiBarang, req.DeskripsiBarang,
		req.HargaAwal, req.HargaAwal,
		req.Kategori, req.Kategori,
		req.ReservePrice, req.ReservePrice,
		id,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal memperbarui barang: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Informasi barang berhasil diperbarui!",
	})
}
