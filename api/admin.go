package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ListPendingBarang - ALUR 2: Admin melihat antrean barang yang harus dicek dan divalidasi
func ListPendingBarang(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT b.id_barang, b.nama_barang, b.tanggal, b.harga_awal, b.deskripsi_barang, b.kategori,
		       b.foto_barang, IFNULL(b.dokumen_pendukung,'[]'), IFNULL(b.spesifikasi,'{}'),
		       b.status_verifikasi, IFNULL(b.catatan_kurasi,''), IFNULL(b.estimasi_pasar,0),
		       IFNULL(b.reserve_price,0), IFNULL(b.tanggal_lelang_target,''),
		       b.id_user, u.nama_lengkap, u.username, u.telp, u.email
		FROM tb_barang b
		JOIN tb_masyarakat u ON u.id_user = b.id_user
		WHERE b.status_verifikasi = 'pending'
		ORDER BY b.id_barang ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil antrean verifikasi: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, idUser int
		var nama, tgl, desk, kat, fotoStr, dokStr, spekStr, status, catatan, tglTarget, namaUser, username, telp, email string
		var harga, estimasi, reserve float64

		if err := rows.Scan(
			&id, &nama, &tgl, &harga, &desk, &kat, &fotoStr, &dokStr, &spekStr,
			&status, &catatan, &estimasi, &reserve, &tglTarget,
			&idUser, &namaUser, &username, &telp, &email,
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
			"tanggal_masuk":         tgl,
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
			"penjual": map[string]any{
				"id_user":      idUser,
				"nama_lengkap": namaUser,
				"username":     username,
				"telp":         telp,
				"email":        email,
			},
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// ValidasiBarang - ALUR 2 & ALUR 3 & ALUR 4:
// Admin memvalidasi (approve atau reject) barang yang masuk.
// Jika approve: barang disetujui, dihubungkan ke jadwal buka serentak pada hari lelang target (3 hari ke depan),
// dan durasi buka dihitung sesuai durasi kategori (5 jam, 8 jam, atau 10 jam).
func ValidasiBarang(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	idBarang, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID barang tidak valid")
		return
	}

	var req ValidasiBarangRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	req.Status = strings.ToLower(strings.TrimSpace(req.Status))
	if req.Status != "approved" && req.Status != "rejected" {
		Error(w, http.StatusBadRequest, "Status validasi harus 'approved' atau 'rejected'")
		return
	}

	// Ambil data barang
	var namaBarang, kategori string
	var tglMasuk, tglTarget string
	var hargaAwal, existingReserve float64
	var idUser sql.NullInt64

	err = DB.QueryRow(`
		SELECT nama_barang, kategori, tanggal, IFNULL(tanggal_lelang_target,''), harga_awal, IFNULL(reserve_price,0), id_user
		FROM tb_barang WHERE id_barang = ?`, idBarang,
	).Scan(&namaBarang, &kategori, &tglMasuk, &tglTarget, &hargaAwal, &existingReserve, &idUser)

	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Barang tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query data barang: "+err.Error())
		return
	}

	// Kasus REJECT
	if req.Status == "rejected" {
		alasan := req.CatatanKurasi
		if alasan == "" {
			alasan = "Barang tidak memenuhi kelayakan inspeksi dan standar lelang."
		}

		_, err = DB.Exec(`
			UPDATE tb_barang SET status_verifikasi = 'rejected', catatan_kurasi = ?
			WHERE id_barang = ?`, alasan, idBarang)
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memperbarui status: "+err.Error())
			return
		}

		if idUser.Valid {
			notifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano()%10000000)
			pesan := fmt.Sprintf("Pengajuan barang \"%s\" belum disetujui petugas: %s", namaBarang, alasan)
			_, _ = DB.Exec(`
				INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
				VALUES (?, ?, 'Hasil Kurasi: Pengajuan Ditolak', ?, 'system', 0, 'my-listings')`,
				notifID, idUser.Int64, pesan,
			)
		}

		JSON(w, http.StatusOK, Response{
			Success: true,
			Message: fmt.Sprintf("Barang \"%s\" berhasil ditolak dengan catatan kurasi.", namaBarang),
		})
		return
	}

	// Kasus APPROVE
	// ALUR 3: Pastikan tanggal lelang target (3 hari ke depan dari tanggal masuk = tanggal masuk + 2 hari)
	parsedTglMasuk, errParse := time.Parse("2006-01-02", tglMasuk)
	if errParse != nil {
		parsedTglMasuk = time.Now()
	}
	if tglTarget == "" {
		tglTarget = parsedTglMasuk.AddDate(0, 0, 2).Format("2006-01-02")
	}

	// ALUR 4: Ambil jam buka lelang pada hari lelang target dari tb_jadwal_harian (default "09:00:00")
	var jamBuka string
	err = DB.QueryRow(`
		SELECT jam_buka FROM tb_jadwal_harian WHERE tanggal_lelang = ?`, tglTarget).Scan(&jamBuka)
	if err == sql.ErrNoRows {
		// Jika belum ada jadwal khusus untuk tanggal tersebut, buatkan jadwal default 09:00:00
		jamBuka = "09:00:00"
		_, _ = DB.Exec(`
			INSERT IGNORE INTO tb_jadwal_harian (tanggal_lelang, jam_buka, status, catatan)
			VALUES (?, '09:00:00', 'terjadwal', 'Jadwal Serentak Otomatis Sistem')`, tglTarget)
	}

	// ALUR 4: Ambil durasi buka lelang per kategori (5 jam, 8 jam, atau 10 jam)
	var durasiJam int = 8
	_ = DB.QueryRow(`
		SELECT durasi_jam FROM tb_kategori WHERE nama_kategori = ?`, kategori).Scan(&durasiJam)

	// Validasi durasi harus 5, 8, atau 12 jam
	if durasiJam != 5 && durasiJam != 8 && durasiJam != 10 && durasiJam != 12 {
		durasiJam = 8
	}

	// Hitung waktu mulai dan selesai serentak
	// tgl_mulai = YYYY-MM-DD HH:MM:SS
	startStr := fmt.Sprintf("%s %s", tglTarget, jamBuka)
	layout := "2006-01-02 15:04:05"
	startTime, errTime := time.Parse(layout, startStr)
	if errTime != nil {
		startTime = time.Now()
		startStr = startTime.Format(layout)
	}
	endTime := startTime.Add(time.Duration(durasiJam) * time.Hour)
	endStr := endTime.Format(layout)

	// Tentukan kelipatan minimal dan uang jaminan
	kelipatan := req.KelipatanMinimal
	if kelipatan <= 0 {
		if hargaAwal >= 100000000 {
			kelipatan = 2500000
		} else if hargaAwal >= 20000000 {
			kelipatan = 1000000
		} else {
			kelipatan = 500000
		}
	}

	uangJaminan := req.UangJaminan
	if uangJaminan <= 0 {
		uangJaminan = hargaAwal * 0.1 // 10% dari harga limit
		if uangJaminan < 1000000 {
			uangJaminan = 1000000
		}
	}

	finalReserve := existingReserve
	if req.ReservePrice > 0 {
		finalReserve = req.ReservePrice
	}

	// Tentukan status awal lelang ('dibuka' jika waktu saat ini sudah masuk range, atau 'terjadwal')
	statusLelang := "terjadwal"
	now := time.Now()
	if now.After(startTime) && now.Before(endTime) {
		statusLelang = "dibuka"
	}

	// 1. Update tb_barang menjadi 'approved'
	_, err = DB.Exec(`
		UPDATE tb_barang SET
			status_verifikasi = 'approved',
			catatan_kurasi = ?,
			tanggal_lelang_target = ?,
			reserve_price = ?
		WHERE id_barang = ?`,
		"Disetujui kurator balai lelang. Siap dilelang serentak pada hari yang ditentukan.",
		tglTarget, finalReserve, idBarang,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal update verifikasi barang: "+err.Error())
		return
	}

	// 2. Insert ke tb_lelang
	resLelang, err := DB.Exec(`
		INSERT INTO tb_lelang (
			id_barang, id_sesi, tgl_mulai, tgl_selesai, durasi_jam,
			kelipatan_minimal, uang_jaminan, harga_akhir, id_user,
			id_petugas, status, reserve_price, is_reserve_met
		) VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0)`,
		idBarang, startStr, endStr, durasiJam,
		kelipatan, uangJaminan, hargaAwal, claims.ID, statusLelang, finalReserve,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuat lot lelang: "+err.Error())
		return
	}

	idLelang, _ := resLelang.LastInsertId()

	// 3. Buat notifikasi untuk user penjual
	if idUser.Valid {
		notifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano()%10000000)
		pesan := fmt.Sprintf(
			"Kabar Gembira! Barang \"%s\" telah divalidasi dan disetujui kurator. Lelang dibuka serentak pada hari lelang %s pukul %s WIB (durasi lelang: %d jam).",
			namaBarang, tglTarget, jamBuka, durasiJam,
		)
		_, _ = DB.Exec(`
			INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
			VALUES (?, ?, 'Pengajuan Barang Disetujui!', ?, 'win', 0, 'my-listings')`,
			notifID, idUser.Int64, pesan,
		)
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Barang \"%s\" berhasil divalidasi dan dijadwalkan untuk lelang serentak pada %s pukul %s WIB!", namaBarang, tglTarget, jamBuka),
		Data: map[string]any{
			"id_lelang":             idLelang,
			"id_barang":             idBarang,
			"nama_barang":           namaBarang,
			"tanggal_lelang_target": tglTarget,
			"jam_buka_serentak":     jamBuka,
			"durasi_jam":            durasiJam,
			"tgl_mulai":             startStr,
			"tgl_selesai":           endStr,
			"status_lelang":         statusLelang,
			"kelipatan_minimal":     kelipatan,
			"uang_jaminan":          uangJaminan,
		},
	})
}

// AturJadwalHarian - ALUR 4: Admin mengatur jam buka lelang serentak pada hari tertentu
// Semua barang yang dijadwalkan pada hari tersebut akan otomatis tersinkronisasi jam mulainya
func AturJadwalHarian(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	var req AturJadwalRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	req.TanggalLelang = strings.TrimSpace(req.TanggalLelang)
	req.JamBuka = strings.TrimSpace(req.JamBuka)

	if req.TanggalLelang == "" || req.JamBuka == "" {
		Error(w, http.StatusBadRequest, "Tanggal lelang (YYYY-MM-DD) dan jam buka (HH:MM:SS) wajib diisi")
		return
	}

	// Validasi format jam
	if len(req.JamBuka) == 5 {
		req.JamBuka += ":00" // format HH:MM -> HH:MM:00
	}

	// 1. Simpan ke tb_jadwal_harian (insert or update)
	_, err := DB.Exec(`
		INSERT INTO tb_jadwal_harian (tanggal_lelang, jam_buka, status, catatan)
		VALUES (?, ?, 'terjadwal', ?)
		ON DUPLICATE KEY UPDATE jam_buka = VALUES(jam_buka), catatan = VALUES(catatan)`,
		req.TanggalLelang, req.JamBuka, req.Catatan,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyimpan jadwal harian: "+err.Error())
		return
	}

	// 2. Sinkronisasi semua lot lelang pada tanggal tersebut
	// tgl_mulai baru = Tanggal + JamBuka
	startStr := fmt.Sprintf("%s %s", req.TanggalLelang, req.JamBuka)
	startTime, errParse := time.Parse("2006-01-02 15:04:05", startStr)
	if errParse == nil {
		// Ambil semua lelang yang terjadwal untuk barang dengan tanggal_lelang_target = req.TanggalLelang
		rows, errQuery := DB.Query(`
			SELECT l.id_lelang, l.durasi_jam
			FROM tb_lelang l
			JOIN tb_barang b ON b.id_barang = l.id_barang
			WHERE b.tanggal_lelang_target = ? AND l.status IN ('terjadwal', 'draft')`, req.TanggalLelang)
		if errQuery == nil {
			defer rows.Close()
			for rows.Next() {
				var idLelang, durasi int
				if errScan := rows.Scan(&idLelang, &durasi); errScan == nil {
					newEnd := startTime.Add(time.Duration(durasi) * time.Hour).Format("2006-01-02 15:04:05")
					_, _ = DB.Exec(`
						UPDATE tb_lelang SET tgl_mulai = ?, tgl_selesai = ? WHERE id_lelang = ?`,
						startStr, newEnd, idLelang,
					)
				}
			}
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Jadwal lelang serentak untuk hari %s berhasil diatur buka pukul %s WIB!", req.TanggalLelang, req.JamBuka),
		Data: map[string]any{
			"tanggal_lelang": req.TanggalLelang,
			"jam_buka":       req.JamBuka,
			"catatan":        req.Catatan,
		},
	})
}

// AturDurasiKategori - ALUR 4: Admin mengatur berapa lama lelang dibuka berdasarkan kategori
// Pilihan waktu: 5 jam, 8 jam, dan 10 jam
func AturDurasiKategori(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	var req AturDurasiKategoriRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	req.NamaKategori = strings.TrimSpace(req.NamaKategori)

	// Validasi durasi harus 5 jam, 8 jam, atau 12 jam
	if req.DurasiJam != 5 && req.DurasiJam != 8 && req.DurasiJam != 10 && req.DurasiJam != 12 {
		Error(w, http.StatusBadRequest, fmt.Sprintf("Durasi buka lelang hanya diperbolehkan 5 jam, 8 jam, atau 12 jam (input Anda: %d jam)", req.DurasiJam))
		return
	}

	res, err := DB.Exec(`
		UPDATE tb_kategori SET durasi_jam = ? WHERE nama_kategori = ?`,
		req.DurasiJam, req.NamaKategori,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal memperbarui durasi kategori: "+err.Error())
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		// Insert jika belum ada
		_, _ = DB.Exec(`
			INSERT INTO tb_kategori (nama_kategori, durasi_jam, keterangan)
			VALUES (?, ?, 'Durasi kustom diatur oleh admin')`,
			req.NamaKategori, req.DurasiJam,
		)
	}

	// Sinkronisasikan durasi lelang terjadwal untuk kategori tersebut
	rows, errQuery := DB.Query(`
		SELECT l.id_lelang, l.tgl_mulai
		FROM tb_lelang l
		JOIN tb_barang b ON b.id_barang = l.id_barang
		WHERE b.kategori = ? AND l.status IN ('terjadwal', 'draft')`, req.NamaKategori)
	if errQuery == nil {
		defer rows.Close()
		for rows.Next() {
			var idLelang int
			var tglMulaiStr string
			if errScan := rows.Scan(&idLelang, &tglMulaiStr); errScan == nil {
				startTime, errParse := time.Parse("2006-01-02 15:04:05", tglMulaiStr)
				if errParse == nil {
					newEnd := startTime.Add(time.Duration(req.DurasiJam) * time.Hour).Format("2006-01-02 15:04:05")
					_, _ = DB.Exec(`
						UPDATE tb_lelang SET durasi_jam = ?, tgl_selesai = ? WHERE id_lelang = ?`,
						req.DurasiJam, newEnd, idLelang,
					)
				}
			}
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Durasi buka lelang untuk kategori \"%s\" berhasil diatur menjadi %d jam!", req.NamaKategori, req.DurasiJam),
		Data: map[string]any{
			"nama_kategori": req.NamaKategori,
			"durasi_jam":    req.DurasiJam,
		},
	})
}

// ListKategoriDurasi menampilkan semua kategori dan durasi buka lelangnya
func ListKategoriDurasi(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT id_kategori, nama_kategori, durasi_jam, IFNULL(keterangan,'')
		FROM tb_kategori ORDER BY id_kategori ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil data kategori: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, durasi int
		var nama, ket string
		if err := rows.Scan(&id, &nama, &durasi, &ket); err == nil {
			list = append(list, map[string]any{
				"id_kategori":   id,
				"nama_kategori": nama,
				"durasi_jam":    durasi,
				"keterangan":    ket,
			})
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// ListJadwalHarian menampilkan daftar hari lelang dan jam buka yang telah diatur admin
func ListJadwalHarian(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT id_jadwal, tanggal_lelang, jam_buka, status, IFNULL(catatan,'')
		FROM tb_jadwal_harian ORDER BY tanggal_lelang ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil jadwal: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var tgl, jam, status, catatan string
		if err := rows.Scan(&id, &tgl, &jam, &status, &catatan); err == nil {
			list = append(list, map[string]any{
				"id_jadwal":      id,
				"tanggal_lelang": tgl,
				"jam_buka":       jam,
				"status":         status,
				"catatan":        catatan,
			})
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// BukaLelangSerentakHariIni - ALUR 4: Membuka semua lelang yang terjadwal untuk hari ini
func BukaLelangSerentakHariIni(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	today := time.Now().Format("2006-01-02")
	res, err := DB.Exec(`
		UPDATE tb_lelang l
		JOIN tb_barang b ON b.id_barang = l.id_barang
		SET l.status = 'dibuka'
		WHERE b.tanggal_lelang_target = ? AND l.status = 'terjadwal'`, today)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuka lelang serentak: "+err.Error())
		return
	}

	rowsAffected, _ := res.RowsAffected()

	// Update juga status di tb_jadwal_harian
	_, _ = DB.Exec(`UPDATE tb_jadwal_harian SET status = 'dibuka' WHERE tanggal_lelang = ?`, today)

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Berhasil membuka %d lot lelang serentak untuk hari ini (%s)!", rowsAffected, today),
		Data: map[string]any{
			"tanggal":     today,
			"lot_dibuka":  rowsAffected,
			"status_sesi": "dibuka",
		},
	})
}

// CreateOfficerAuctionHandler membuat lelang baru langsung dari petugas
func CreateOfficerAuctionHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	var req struct {
		BarangData struct {
			NamaBarang       string            `json:"nama_barang"`
			HargaAwal        float64           `json:"harga_awal"`
			DeskripsiBarang  string            `json:"deskripsi_barang"`
			Kategori         string            `json:"kategori"`
			FotoBarang       []string          `json:"foto_barang"`
			DokumenPendukung []string          `json:"dokumen_pendukung"`
			Spesifikasi      map[string]string `json:"spesifikasi"`
			ReservePrice     float64           `json:"reserve_price"`
		} `json:"barang"`
		LelangData struct {
			TglMulai         string  `json:"tgl_mulai"`
			TglSelesai       string  `json:"tgl_selesai"`
			KelipatanMinimal float64 `json:"kelipatan_minimal"`
			UangJaminan      float64 `json:"uang_jaminan"`
			DurasiJam        int     `json:"durasi_jam"`
		} `json:"lelang"`
	}

	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	fotoJSON, _ := json.Marshal(req.BarangData.FotoBarang)
	dokumenJSON, _ := json.Marshal(req.BarangData.DokumenPendukung)
	spekJSON, _ := json.Marshal(req.BarangData.Spesifikasi)
	nowStr := time.Now().Format("2006-01-02")

	resB, err := DB.Exec(`
		INSERT INTO tb_barang (
			nama_barang, tanggal, harga_awal, deskripsi_barang, kategori,
			foto_barang, dokumen_pendukung, spesifikasi, id_user,
			status_verifikasi, catatan_kurasi, reserve_price, is_featured
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved', 'Barang Inventaris Resmi Petugas', ?, 1)`,
		req.BarangData.NamaBarang, nowStr, req.BarangData.HargaAwal, req.BarangData.DeskripsiBarang,
		req.BarangData.Kategori, string(fotoJSON), string(dokumenJSON), string(spekJSON),
		req.BarangData.ReservePrice,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuat barang: "+err.Error())
		return
	}
	idBarang, _ := resB.LastInsertId()

	durasi := req.LelangData.DurasiJam
	if durasi <= 0 {
		durasi = 8
	}

	start := req.LelangData.TglMulai
	if start == "" {
		start = time.Now().Format("2006-01-02 15:04:05")
	}
	end := req.LelangData.TglSelesai
	if end == "" {
		sTime, _ := time.Parse("2006-01-02 15:04:05", start)
		end = sTime.Add(time.Duration(durasi) * time.Hour).Format("2006-01-02 15:04:05")
	}

	resL, err := DB.Exec(`
		INSERT INTO tb_lelang (
			id_barang, id_sesi, tgl_mulai, tgl_selesai, durasi_jam,
			kelipatan_minimal, uang_jaminan, harga_akhir, id_petugas, status, reserve_price
		) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'dibuka', ?)`,
		idBarang, start, end, durasi,
		req.LelangData.KelipatanMinimal, req.LelangData.UangJaminan,
		req.BarangData.HargaAwal, claims.ID, req.BarangData.ReservePrice,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuat lelang: "+err.Error())
		return
	}
	idLelang, _ := resL.LastInsertId()

	JSON(w, http.StatusCreated, Response{
		Success: true,
		Message: "Lot lelang resmi berhasil dibuat dan dibuka!",
		Data: map[string]any{
			"id_barang": idBarang,
			"id_lelang": idLelang,
		},
	})
}

// UpdateAuctionStatusHandler mengubah status lelang (dibuka, ditutup, dibatalkan)
func UpdateAuctionStatusHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	idLelang, _ := strconv.Atoi(idStr)

	var req struct {
		Status string `json:"status"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	_, err := DB.Exec(`UPDATE tb_lelang SET status = ? WHERE id_lelang = ?`, req.Status, idLelang)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengubah status: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Status lot lelang #%d diubah menjadi '%s'", idLelang, req.Status),
	})
}

// ListUsersHandler mengembalikan daftar semua user masyarakat untuk admin
func ListUsersHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	rows, err := DB.Query(`
		SELECT id_user, IFNULL(hash_id,''), ft_ktp, nama_lengkap, username, IFNULL(email,''),
		       telp, IFNULL(alamat,''), IFNULL(avatar_url,''), saldo_wallet, saldo_hold, is_verified, created_at
		FROM tb_masyarakat ORDER BY id_user ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil daftar pengguna: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idUser int
		var hashID, nik, nama, username, email, telp, alamat, avatar, createdAt string
		var saldoWallet, saldoHold float64
		var isVerified bool

		if errScan := rows.Scan(
			&idUser, &hashID, &nik, &nama, &username, &email,
			&telp, &alamat, &avatar, &saldoWallet, &saldoHold, &isVerified, &createdAt,
		); errScan == nil {
			list = append(list, map[string]any{
				"id_user":      idUser,
				"hash_id":      hashID,
				"ft_ktp":       nik,
				"nik":          nik,
				"nama_lengkap": nama,
				"username":     username,
				"email":        email,
				"telp":         telp,
				"alamat":       alamat,
				"avatar_url":   avatar,
				"saldo_wallet": saldoWallet,
				"saldo_hold":   saldoHold,
				"is_verified":  isVerified,
				"created_at":   createdAt,
			})
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}
