package api

import (
	"encoding/json"
	"net/http"
	"time"
)

// ListSesiLelang menampilkan semua sesi lelang balai resmi
func ListSesiLelang(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT s.id_sesi, s.judul, IFNULL(s.deskripsi,''), s.tipe, s.tgl_mulai,
		       s.durasi_default_jam, IFNULL(s.gambar_banner,''), s.status,
		       IFNULL(s.kurator,''), IFNULL(s.created_by,0), s.created_at
		FROM tb_sesi_lelang s ORDER BY s.id_sesi ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query sesi: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idSesi, durasi, createdBy int
		var judul, desk, tipe, tglMulai, banner, status, kurator, createdAt string

		if errS := rows.Scan(&idSesi, &judul, &desk, &tipe, &tglMulai, &durasi, &banner, &status, &kurator, &createdBy, &createdAt); errS != nil {
			Error(w, http.StatusInternalServerError, "Gagal membaca sesi: "+errS.Error())
			return
		}

		lelangIDs := make([]int, 0)
		lRows, errL := DB.Query(`SELECT id_lelang FROM tb_lelang WHERE id_sesi = ?`, idSesi)
		if errL != nil {
			Error(w, http.StatusInternalServerError, "Gagal membaca daftar lelang sesi: "+errL.Error())
			return
		}
		for lRows.Next() {
			var lid int
			if err := lRows.Scan(&lid); err != nil {
				lRows.Close()
				Error(w, http.StatusInternalServerError, "Gagal membaca daftar lelang sesi: "+err.Error())
				return
			}
			lelangIDs = append(lelangIDs, lid)
		}
		if err := lRows.Err(); err != nil {
			lRows.Close()
			Error(w, http.StatusInternalServerError, "Gagal membaca daftar lelang sesi: "+err.Error())
			return
		}
		lRows.Close()

		list = append(list, map[string]any{
			"id_sesi":            idSesi,
			"judul":              judul,
			"deskripsi":          desk,
			"tipe":               tipe,
			"tgl_mulai":          tglMulai,
			"durasi_default_jam": durasi,
			"gambar_banner":      banner,
			"status":             status,
			"kurator":            kurator,
			"created_by":         createdBy,
			"created_at":         createdAt,
			"id_lelang_list":     lelangIDs,
		})
	}
	if err := rows.Err(); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membaca sesi: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// ListThemes menampilkan katalog tema kurasi
func ListThemes(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`
		SELECT id_theme, nama_theme, IFNULL(subjudul_jadwal,''), IFNULL(badge_waktu,''),
		       nama_kurator, gambar_cover, tipe, IFNULL(id_lelang_list,'[]'),
		       IFNULL(deskripsi,'')
		FROM tb_theme ORDER BY id_theme ASC`)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query tema: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idTheme int
		var namaTheme, subjudul, badge, kurator, gambar, tipe, lelangJSON, deskripsi string
		if err := rows.Scan(&idTheme, &namaTheme, &subjudul, &badge, &kurator, &gambar, &tipe, &lelangJSON, &deskripsi); err != nil {
			Error(w, http.StatusInternalServerError, "Gagal membaca tema: "+err.Error())
			return
		}

		var lelangIDs []int
		if err := json.Unmarshal([]byte(lelangJSON), &lelangIDs); err != nil {
			Error(w, http.StatusInternalServerError, "Format daftar lelang pada tema tidak valid")
			return
		}
		if lelangIDs == nil {
			lelangIDs = make([]int, 0)
		}

		list = append(list, map[string]any{
			"id_theme":        idTheme,
			"nama_theme":      namaTheme,
			"subjudul_jadwal": subjudul,
			"badge_waktu":     badge,
			"nama_kurator":    kurator,
			"gambar_cover":    gambar,
			"tipe":            tipe,
			"id_lelang_list":  lelangIDs,
			"deskripsi":       deskripsi,
		})
	}
	if err := rows.Err(); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membaca tema: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// CreateSessionHandler membuat sesi kurasi lelang baru
func CreateSessionHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil || (claims.Role != "administrator" && claims.Role != "petugas") {
		Error(w, http.StatusForbidden, "Akses khusus Petugas dan Administrator")
		return
	}

	var req struct {
		Judul            string `json:"judul"`
		Deskripsi        string `json:"deskripsi"`
		Tipe             string `json:"tipe"`
		TglMulai         string `json:"tgl_mulai"`
		DurasiDefaultJam int    `json:"durasi_default_jam"`
		GambarBanner     string `json:"gambar_banner"`
		Kurator          string `json:"kurator"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	if req.DurasiDefaultJam <= 0 {
		req.DurasiDefaultJam = 24
	}
	if req.Tipe == "" {
		req.Tipe = "reguler"
	}
	_, err := time.Parse("2006-01-02 15:04:05", req.TglMulai)
	if err != nil {
		Error(w, http.StatusBadRequest, "tgl_mulai harus berformat YYYY-MM-DD HH:MM:SS")
		return
	}
	res, err := DB.Exec(`
		INSERT INTO tb_sesi_lelang
		(judul, deskripsi, tipe, tgl_mulai, durasi_default_jam, gambar_banner, status, kurator, created_by)
		VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?)`,
		req.Judul, req.Deskripsi, req.Tipe, req.TglMulai,
		req.DurasiDefaultJam, req.GambarBanner, req.Kurator, claims.ID,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuat sesi: "+err.Error())
		return
	}

	idSesi, _ := res.LastInsertId()
	JSON(w, http.StatusCreated, Response{
		Success: true,
		Message: "Sesi lelang resmi berhasil dibuat!",
		Data: map[string]any{
			"id_sesi": idSesi,
			"judul":   req.Judul,
		},
	})
}
