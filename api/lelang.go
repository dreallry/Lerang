package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// ListLelang menampilkan daftar lot lelang dengan filter status ('dibuka', 'terjadwal', 'ditutup')
func ListLelang(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	query := `
		SELECT l.id_lelang, l.id_barang, IFNULL(l.id_sesi,0), l.tgl_mulai, l.tgl_selesai,
		       l.durasi_jam, l.kelipatan_minimal, l.uang_jaminan, l.harga_akhir,
		       IFNULL(l.id_user,0), IFNULL(u.nama_lengkap,''), l.status,
		       IFNULL(l.reserve_price,0), l.is_reserve_met,
		       b.nama_barang, b.kategori, b.harga_awal, b.foto_barang, b.deskripsi_barang
		FROM tb_lelang l
		JOIN tb_barang b ON b.id_barang = l.id_barang
		LEFT JOIN tb_masyarakat u ON u.id_user = l.id_user`

	var args []any
	if status != "" {
		query += " WHERE l.status = ?"
		args = append(args, status)
	}
	query += " ORDER BY l.id_lelang DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengambil daftar lelang: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idLelang, idBarang, idSesi, durasi, idUser int
		var tglMulai, tglSelesai, statusLelang, namaPemenang string
		var namaBarang, kategori, fotoStr, deskripsi string
		var kelipatan, uangJaminan, hargaAkhir, reserve, hargaAwal float64
		var isReserveMet bool

		if err := rows.Scan(
			&idLelang, &idBarang, &idSesi, &tglMulai, &tglSelesai,
			&durasi, &kelipatan, &uangJaminan, &hargaAkhir,
			&idUser, &namaPemenang, &statusLelang, &reserve, &isReserveMet,
			&namaBarang, &kategori, &hargaAwal, &fotoStr, &deskripsi,
		); err != nil {
			continue
		}

		var fotoArr []string
		_ = json.Unmarshal([]byte(fotoStr), &fotoArr)

		list = append(list, map[string]any{
			"id_lelang":         idLelang,
			"id_barang":         idBarang,
			"id_sesi":           idSesi,
			"tgl_mulai":         tglMulai,
			"tgl_selesai":       tglSelesai,
			"durasi_jam":        durasi,
			"kelipatan_minimal": kelipatan,
			"uang_jaminan":      uangJaminan,
			"harga_akhir":       hargaAkhir,
			"id_user":           idUser,
			"nama_pemenang":     namaPemenang,
			"status":            statusLelang,
			"reserve_price":     reserve,
			"is_reserve_met":    isReserveMet,
			"nama_barang":       namaBarang,
			"kategori":          kategori,
			"harga_awal":        hargaAwal,
			"foto_barang":       fotoArr,
			"deskripsi_barang":  deskripsi,
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// DetailLelang menampilkan detail lot lelang lengkap dengan barang dan histori bid
func DetailLelang(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	idLelang, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID lelang tidak valid")
		return
	}

	var idBarang, idSesi, durasi, idUser int
	var tglMulai, tglSelesai, statusLelang, namaPemenang string
	var namaBarang, kategori, fotoStr, dokStr, spekStr, deskripsi string
	var kelipatan, uangJaminan, hargaAkhir, reserve, hargaAwal float64
	var isReserveMet bool

	err = DB.QueryRow(`
		SELECT l.id_lelang, l.id_barang, IFNULL(l.id_sesi,0), l.tgl_mulai, l.tgl_selesai,
		       l.durasi_jam, l.kelipatan_minimal, l.uang_jaminan, l.harga_akhir,
		       IFNULL(l.id_user,0), IFNULL(u.nama_lengkap,''), l.status,
		       IFNULL(l.reserve_price,0), l.is_reserve_met,
		       b.nama_barang, b.kategori, b.harga_awal, b.foto_barang,
		       IFNULL(b.dokumen_pendukung,'[]'), IFNULL(b.spesifikasi,'{}'), b.deskripsi_barang
		FROM tb_lelang l
		JOIN tb_barang b ON b.id_barang = l.id_barang
		LEFT JOIN tb_masyarakat u ON u.id_user = l.id_user
		WHERE l.id_lelang = ?`, idLelang,
	).Scan(
		&idLelang, &idBarang, &idSesi, &tglMulai, &tglSelesai,
		&durasi, &kelipatan, &uangJaminan, &hargaAkhir,
		&idUser, &namaPemenang, &statusLelang, &reserve, &isReserveMet,
		&namaBarang, &kategori, &hargaAwal, &fotoStr,
		&dokStr, &spekStr, &deskripsi,
	)

	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Lot lelang tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query lelang: "+err.Error())
		return
	}

	var fotoArr []string
	_ = json.Unmarshal([]byte(fotoStr), &fotoArr)
	var dokArr []string
	_ = json.Unmarshal([]byte(dokStr), &dokArr)
	var spekMap map[string]string
	_ = json.Unmarshal([]byte(spekStr), &spekMap)

	// Ambil histori bid
	bidRows, errBids := DB.Query(`
		SELECT h.id_history, h.id_user, h.nama_user, h.penawaran_harga, h.created_at, h.is_auto_bid
		FROM tb_histori_lelang h
		WHERE h.id_lelang = ? ORDER BY h.id_history DESC`, idLelang)
	history := make([]map[string]any, 0)
	if errBids == nil {
		defer bidRows.Close()
		for bidRows.Next() {
			var idHist, idBidder int
			var namaBidder, waktuBid string
			var penawaran float64
			var isAuto bool
			if errS := bidRows.Scan(&idHist, &idBidder, &namaBidder, &penawaran, &waktuBid, &isAuto); errS == nil {
				history = append(history, map[string]any{
					"id_history":      idHist,
					"id_user":         idBidder,
					"nama_user":       namaBidder,
					"penawaran_harga": penawaran,
					"created_at":      waktuBid,
					"is_auto_bid":     isAuto,
				})
			}
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]any{
			"lelang": map[string]any{
				"id_lelang":         idLelang,
				"id_barang":         idBarang,
				"id_sesi":           idSesi,
				"tgl_mulai":         tglMulai,
				"tgl_selesai":       tglSelesai,
				"durasi_jam":        durasi,
				"kelipatan_minimal": kelipatan,
				"uang_jaminan":      uangJaminan,
				"harga_akhir":       hargaAkhir,
				"id_user":           idUser,
				"nama_pemenang":     namaPemenang,
				"status":            statusLelang,
				"reserve_price":     reserve,
				"is_reserve_met":    isReserveMet,
			},
			"barang": map[string]any{
				"id_barang":         idBarang,
				"nama_barang":       namaBarang,
				"kategori":          kategori,
				"harga_awal":        hargaAwal,
				"foto_barang":       fotoArr,
				"dokumen_pendukung": dokArr,
				"spesifikasi":       spekMap,
				"deskripsi_barang":  deskripsi,
			},
			"total_bids": len(history),
			"history":    history,
		},
	})
}

// PlaceBid menempatkan tawaran harga baru pada lot lelang yang sedang dibuka
func PlaceBid(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login untuk menawar lelang")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	idLelang, err := strconv.Atoi(idStr)
	if err != nil {
		Error(w, http.StatusBadRequest, "ID lelang tidak valid")
		return
	}

	var req BidRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	// 1. Ambil data lelang & barang
	var idBarang int
	var currentPrice, kelipatan, uangJaminan, reservePrice float64
	var statusLelang, tglSelesaiStr string
	var currentLeaderID sql.NullInt64

	err = DB.QueryRow(`
		SELECT id_barang, harga_akhir, kelipatan_minimal, uang_jaminan, IFNULL(reserve_price,0), status, tgl_selesai, id_user
		FROM tb_lelang WHERE id_lelang = ?`, idLelang,
	).Scan(&idBarang, &currentPrice, &kelipatan, &uangJaminan, &reservePrice, &statusLelang, &tglSelesaiStr, &currentLeaderID)

	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Lot lelang tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query lelang: "+err.Error())
		return
	}

	if statusLelang != "dibuka" {
		Error(w, http.StatusBadRequest, fmt.Sprintf("Lelang ini saat ini berstatus '%s', belum/tidak menerima penawaran", statusLelang))
		return
	}

	// Cek apakah lelang sudah lewat waktu selesai
	tglSelesai, errT := time.Parse("2006-01-02 15:04:05", tglSelesaiStr)
	if errT == nil && time.Now().After(tglSelesai) {
		Error(w, http.StatusBadRequest, "Waktu lelang ini telah berakhir")
		return
	}

	// Validasi minimal bid
	minBid := currentPrice + kelipatan
	if req.PenawaranHarga < minBid {
		Error(w, http.StatusBadRequest, fmt.Sprintf("Penawaran minimal adalah Rp %.0f (harga saat ini + kelipatan minimal Rp %.0f)", minBid, kelipatan))
		return
	}

	// Validasi saldo wallet cukup untuk uang jaminan jika belum pernah mengunci jaminan
	var saldoWallet, saldoHold float64
	err = DB.QueryRow(`
		SELECT saldo_wallet, saldo_hold FROM tb_masyarakat WHERE id_user = ?`, claims.ID,
	).Scan(&saldoWallet, &saldoHold)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal cek saldo user")
		return
	}

	// Cek apakah user sudah pernah bid di lot ini
	var countBid int
	_ = DB.QueryRow(`
		SELECT COUNT(*) FROM tb_histori_lelang WHERE id_lelang = ? AND id_user = ?`, idLelang, claims.ID).Scan(&countBid)

	// Jika ini bid pertama user di lelang ini, kunci saldo jaminan
	if countBid == 0 {
		if saldoWallet < uangJaminan {
			Error(w, http.StatusBadRequest, fmt.Sprintf("Saldo deposit wallet Anda (Rp %.0f) tidak mencukupi untuk uang jaminan lelang ini (Rp %.0f). Silakan Top Up terlebih dahulu.", saldoWallet, uangJaminan))
			return
		}

		// Kunci uang jaminan
		_, _ = DB.Exec(`
			UPDATE tb_masyarakat SET saldo_wallet = saldo_wallet - ?, saldo_hold = saldo_hold + ? WHERE id_user = ?`,
			uangJaminan, uangJaminan, claims.ID,
		)

		trxID := fmt.Sprintf("TRX-%d", time.Now().UnixNano()%10000000)
		_, _ = DB.Exec(`
			INSERT INTO tb_transaksi_wallet (id_transaksi, id_user, tipe, nominal, keterangan, status, referensi_id)
			VALUES (?, ?, 'hold', ?, ?, 'sukses', ?)`,
			trxID, claims.ID, uangJaminan, fmt.Sprintf("Kunci Uang Jaminan Lelang Lot #%d", idLelang), fmt.Sprintf("LELANG-%d", idLelang),
		)
	}

	isReserveMet := req.PenawaranHarga >= reservePrice

	// 2. Update harga_akhir dan pemenang saat ini di tb_lelang
	_, err = DB.Exec(`
		UPDATE tb_lelang SET
			harga_akhir = ?,
			id_user = ?,
			is_reserve_met = ?
		WHERE id_lelang = ?`,
		req.PenawaranHarga, claims.ID, isReserveMet, idLelang,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal update harga lelang: "+err.Error())
		return
	}

	// 3. Catat di tb_histori_lelang
	nowStr := time.Now().Format("2006-01-02 15:04:05")
	_, _ = DB.Exec(`
		INSERT INTO tb_histori_lelang (id_lelang, id_user, penawaran_harga, waktu_penawaran, is_autobid)
		VALUES (?, ?, ?, ?, 0)`,
		idLelang, claims.ID, req.PenawaranHarga, nowStr,
	)

	// 4. Notifikasi penawar sebelumnya yang ter-outbid
	if currentLeaderID.Valid && currentLeaderID.Int64 != int64(claims.ID) {
		outbidNotifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano()%10000000)
		pesan := fmt.Sprintf("Penawaran Anda di lot lelang #%d telah dilampaui oleh penawar lain dengan harga Rp %.0f. Ajukan penawaran baru untuk merebut kembali kepemimpinan!", idLelang, req.PenawaranHarga)
		_, _ = DB.Exec(`
			INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
			VALUES (?, ?, 'Penawaran Anda Terlampaui (Outbid)', ?, 'outbid', 0, ?)`,
			outbidNotifID, currentLeaderID.Int64, pesan, fmt.Sprintf("auction/%d", idLelang),
		)
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Penawaran sebesar Rp %.0f berhasil ditempatkan! Anda memimpin penawaran saat ini.", req.PenawaranHarga),
		Data: map[string]any{
			"id_lelang":       idLelang,
			"harga_akhir":     req.PenawaranHarga,
			"nama_pemenang":   claims.Nama,
			"is_reserve_met":  isReserveMet,
			"waktu_penawaran": nowStr,
		},
	})
}

// LockDepositHandler mengunci saldo uang jaminan pengguna untuk lot lelang
func LockDepositHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	idStr := r.PathValue("id")
	if idStr == "" {
		idStr = r.URL.Query().Get("id")
	}
	idLelang, _ := strconv.Atoi(idStr)

	var uangJaminan float64
	var status string
	err := DB.QueryRow(`SELECT uang_jaminan, status FROM tb_lelang WHERE id_lelang = ?`, idLelang).Scan(&uangJaminan, &status)
	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Lot lelang tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query lelang: "+err.Error())
		return
	}

	var saldoWallet float64
	_ = DB.QueryRow(`SELECT saldo_wallet FROM tb_masyarakat WHERE id_user = ?`, claims.ID).Scan(&saldoWallet)

	if saldoWallet < uangJaminan {
		Error(w, http.StatusBadRequest, fmt.Sprintf("Saldo wallet (Rp %.0f) tidak mencukupi untuk jaminan Rp %.0f. Silakan Top Up.", saldoWallet, uangJaminan))
		return
	}

	// Kunci deposit
	_, _ = DB.Exec(`
		UPDATE tb_masyarakat SET saldo_wallet = saldo_wallet - ?, saldo_hold = saldo_hold + ? WHERE id_user = ?`,
		uangJaminan, uangJaminan, claims.ID,
	)

	trxID := fmt.Sprintf("TRX-%d", time.Now().UnixNano()%10000000)
	_, _ = DB.Exec(`
		INSERT INTO tb_transaksi_wallet (id_transaksi, id_user, tipe, nominal, keterangan, status, referensi_id)
		VALUES (?, ?, 'hold', ?, ?, 'sukses', ?)`,
		trxID, claims.ID, uangJaminan, fmt.Sprintf("Kunci Uang Jaminan Lelang Lot #%d", idLelang), fmt.Sprintf("LELANG-%d", idLelang),
	)

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Uang jaminan lelang berhasil dikunci! Anda kini dapat mengajukan penawaran harga.",
		Data: map[string]any{
			"id_lelang":    idLelang,
			"uang_jaminan": uangJaminan,
		},
	})
}

// ListAllHistoryHandler mengembalikan seluruh histori bid terakhir di sistem
func ListAllHistoryHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT h.id_history, h.id_lelang, h.id_barang, h.id_user, h.nama_user,
		       h.penawaran_harga, h.created_at, h.is_auto_bid
		FROM tb_histori_lelang h
		ORDER BY h.id_history DESC LIMIT 100`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query histori: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idHist, idLelang, idBarang, idUser int
		var namaUser, createdAt string
		var harga float64
		var isAuto bool

		if errScan := rows.Scan(&idHist, &idLelang, &idBarang, &idUser, &namaUser, &harga, &createdAt, &isAuto); errScan == nil {
			list = append(list, map[string]any{
				"id_history":      idHist,
				"id_lelang":       idLelang,
				"id_barang":       idBarang,
				"id_user":         idUser,
				"nama_user":       namaUser,
				"penawaran_harga": harga,
				"created_at":      createdAt,
				"is_auto_bid":     isAuto,
			})
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}
