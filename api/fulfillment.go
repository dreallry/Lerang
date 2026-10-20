package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ListFulfillment mengembalikan daftar pesanan pengiriman user/admin
func ListFulfillment(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	query := `
		SELECT f.id_fulfillment, f.id_pembayaran, p.id_lelang, f.id_barang,
		       f.id_user_pembeli, IFNULL(b.id_user,0),
		       IFNULL(f.nama_penerima,''), IFNULL(f.telp_penerima,''),
		       IFNULL(f.alamat_lengkap,''), IFNULL(f.kota,''), IFNULL(f.kode_pos,''),
		       IFNULL(f.kurir,''), IFNULL(f.layanan_kurir,''), IFNULL(f.nomor_resi,''),
		       f.ongkir, f.status, IFNULL(f.tracking_history,'[]'),
		       IFNULL(f.rating,0), IFNULL(f.ulasan,''), f.tgl_update,
		       b.nama_barang, b.kategori, b.foto_barang
		FROM tb_pengiriman f
		JOIN tb_pembayaran p ON p.id_pembayaran = f.id_pembayaran
		JOIN tb_barang b ON b.id_barang = f.id_barang`

	var args []any
	if claims.Role == "masyarakat" {
		query += " WHERE (f.id_user_pembeli = ? OR b.id_user = ?)"
		args = append(args, claims.ID, claims.ID)
	}
	query += " ORDER BY f.tgl_update DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query fulfillment: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idFulfill, penerima, telp, alamat, kota, kodePos, kurir, layanan, resi, status, trackStr, ulasan, tglUpdate, namaBarang, kategori, fotoStr string
		var idPay, idLelang, idBarang, idPembeli, idPenjual, rating int
		var ongkir float64

		if err := rows.Scan(
			&idFulfill, &idPay, &idLelang, &idBarang,
			&idPembeli, &idPenjual,
			&penerima, &telp, &alamat, &kota, &kodePos,
			&kurir, &layanan, &resi,
			&ongkir, &status, &trackStr,
			&rating, &ulasan, &tglUpdate,
			&namaBarang, &kategori, &fotoStr,
		); err != nil {
			continue
		}

		var fotoArr []string
		_ = json.Unmarshal([]byte(fotoStr), &fotoArr)
		var trackArr []map[string]any
		_ = json.Unmarshal([]byte(trackStr), &trackArr)

		list = append(list, map[string]any{
			"id_fulfillment":   idFulfill,
			"id_pembayaran":    idPay,
			"id_lelang":        idLelang,
			"id_barang":        idBarang,
			"id_user_pembeli":  idPembeli,
			"id_user_penjual":  idPenjual,
			"nama_penerima":    penerima,
			"telp_penerima":    telp,
			"alamat_lengkap":   alamat,
			"kota":             kota,
			"kode_pos":         kodePos,
			"kurir":            kurir,
			"layanan_kurir":    layanan,
			"nomor_resi":       resi,
			"ongkir":           ongkir,
			"status":           status,
			"tracking_history": trackArr,
			"rating":           rating,
			"ulasan":           ulasan,
			"tgl_update":       tglUpdate,
			"nama_barang":      namaBarang,
			"kategori":         kategori,
			"foto_barang":      fotoArr,
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// UpdateAlamatPengiriman pembeli mengisi detail alamat pengiriman
func UpdateAlamatPengiriman(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	idFulfill := r.PathValue("id")
	var req UpdateAlamatRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	var trackStr string
	err := DB.QueryRow(`
		SELECT IFNULL(tracking_history,'[]') FROM tb_pengiriman
		WHERE id_fulfillment = ? AND id_user_pembeli = ?`, idFulfill, claims.ID).Scan(&trackStr)
	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Pesanan pengiriman tidak ditemukan")
		return
	}

	var trackArr []map[string]any
	_ = json.Unmarshal([]byte(trackStr), &trackArr)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	trackArr = append(trackArr, map[string]any{
		"status":    "dikemas",
		"deskripsi": fmt.Sprintf("Alamat penerima (%s, %s) telah dikonfirmasi. Barang sedang disiapkan untuk pengiriman via %s.", req.NamaPenerima, req.Kota, req.Kurir),
		"waktu":     nowStr,
	})
	newTrackJSON, _ := json.Marshal(trackArr)

	_, err = DB.Exec(`
		UPDATE tb_pengiriman SET
			nama_penerima = ?,
			telp_penerima = ?,
			alamat_lengkap = ?,
			kota = ?,
			kode_pos = ?,
			kurir = ?,
			layanan_kurir = ?,
			ongkir = ?,
			status = 'dikemas',
			tracking_history = ?,
			tgl_update = ?
		WHERE id_fulfillment = ?`,
		req.NamaPenerima, req.TelpPenerima, req.AlamatLengkap, req.Kota, req.KodePos,
		req.Kurir, req.LayananKurir, req.Ongkir,
		string(newTrackJSON), nowStr, idFulfill,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal update alamat: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Alamat pengiriman berhasil disimpan! Status barang kini: Dikemas.",
	})
}

// UpdateResiPengiriman petugas atau kurir mengisi nomor resi pengiriman
func UpdateResiPengiriman(w http.ResponseWriter, r *http.Request) {
	idFulfill := r.PathValue("id")
	var req UpdateResiRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	var trackStr, kurir string
	var idPembeli int
	err := DB.QueryRow(`
		SELECT IFNULL(tracking_history,'[]'), IFNULL(kurir,'Ekspedisi Rekanan'), id_user_pembeli
		FROM tb_pengiriman WHERE id_fulfillment = ?`, idFulfill).Scan(&trackStr, &kurir, &idPembeli)
	if err != nil {
		Error(w, http.StatusNotFound, "Pesanan tidak ditemukan")
		return
	}

	var trackArr []map[string]any
	_ = json.Unmarshal([]byte(trackStr), &trackArr)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	trackArr = append(trackArr, map[string]any{
		"status":    "dikirim",
		"deskripsi": fmt.Sprintf("Paket telah diserahkan ke kurir %s dengan nomor resi %s. Dalam perjalanan.", kurir, req.NomorResi),
		"waktu":     nowStr,
	})
	newTrackJSON, _ := json.Marshal(trackArr)

	_, _ = DB.Exec(`
		UPDATE tb_pengiriman SET
			nomor_resi = ?,
			status = 'dikirim',
			tracking_history = ?,
			tgl_update = ?
		WHERE id_fulfillment = ?`,
		req.NomorResi, string(newTrackJSON), nowStr, idFulfill,
	)

	// Kirim notifikasi ke pembeli
	notifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano()%10000000)
	_, _ = DB.Exec(`
		INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
		VALUES (?, ?, 'Pesanan Sedang Dikirim', ?, 'info', 0, 'fulfillment')`,
		notifID, idPembeli, fmt.Sprintf("Barang Anda telah dikirim via %s dengan no resi %s.", kurir, req.NomorResi),
	)

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Nomor resi berhasil diupdate! Status barang: Dikirim.",
	})
}

// SelesaikanOrderHandler menyelesaikan pesanan barang oleh pembeli dengan rating & ulasan
func SelesaikanOrderHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	idFulfill := r.PathValue("id")
	if idFulfill == "" {
		idFulfill = r.URL.Query().Get("id")
	}

	var req SelesaikanOrderRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	var trackStr string
	err := DB.QueryRow(`
		SELECT IFNULL(tracking_history,'[]') FROM tb_pengiriman
		WHERE id_fulfillment = ? AND id_user_pembeli = ?`, idFulfill, claims.ID).Scan(&trackStr)
	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "Pesanan pengiriman tidak ditemukan")
		return
	}

	var trackArr []map[string]any
	_ = json.Unmarshal([]byte(trackStr), &trackArr)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	trackArr = append(trackArr, map[string]any{
		"status":    "selesai",
		"deskripsi": fmt.Sprintf("Pesanan telah diterima pembeli. Rating: %d/5. Ulasan: %s", req.Rating, req.Ulasan),
		"waktu":     nowStr,
	})
	newTrackJSON, _ := json.Marshal(trackArr)

	_, err = DB.Exec(`
		UPDATE tb_pengiriman SET
			status = 'selesai',
			rating = ?,
			ulasan = ?,
			tracking_history = ?,
			tgl_update = ?
		WHERE id_fulfillment = ?`,
		req.Rating, req.Ulasan, string(newTrackJSON), nowStr, idFulfill,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyelesaikan order: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Pesanan berhasil diselesaikan! Terima kasih atas ulasan Anda.",
	})
}
