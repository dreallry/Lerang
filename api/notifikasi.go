package api

import (
	"net/http"
)

// ListNotifikasi mengembalikan daftar notifikasi milik user
func ListNotifikasi(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	rows, err := DB.Query(`
		SELECT id, judul, pesan, tipe, dibaca, IFNULL(link_target,''), created_at
		FROM tb_notifikasi
		WHERE id_user = ?
		ORDER BY created_at DESC`, claims.ID)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query notifikasi: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, judul, pesan, tipe, link, createdAt string
		var dibaca bool
		if errS := rows.Scan(&id, &judul, &pesan, &tipe, &dibaca, &link, &createdAt); errS == nil {
			list = append(list, map[string]any{
				"id":          id,
				"judul":       judul,
				"pesan":       pesan,
				"tipe":        tipe,
				"dibaca":      dibaca,
				"link_target": link,
				"created_at":  createdAt,
			})
		}
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// MarkNotifikasiRead menandai notifikasi telah dibaca
func MarkNotifikasiRead(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		_, _ = DB.Exec(`UPDATE tb_notifikasi SET dibaca = 1 WHERE id_user = ?`, claims.ID)
	} else {
		_, _ = DB.Exec(`UPDATE tb_notifikasi SET dibaca = 1 WHERE id = ? AND id_user = ?`, id, claims.ID)
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Notifikasi telah ditandai dibaca",
	})
}
