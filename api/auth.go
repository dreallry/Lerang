package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// RegisterMasyarakat mendaftarkan user baru
func RegisterMasyarakat(w http.ResponseWriter, r *http.Request) {
	identity := FirebaseIdentityFromRequest(r)
	if identity == nil || identity.UID == "" {
		Error(w, http.StatusUnauthorized, "Sesi masuk yang valid diperlukan")
		return
	}

	var req RegisterRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	req.NIK = strings.TrimSpace(req.NIK)
	req.NamaLengkap = strings.TrimSpace(req.NamaLengkap)
	req.Username = strings.TrimSpace(req.Username)
	req.Telp = strings.TrimSpace(req.Telp)

	if len(req.NIK) != 16 || strings.Trim(req.NIK, "0123456789") != "" ||
		req.NamaLengkap == "" || req.Username == "" || req.Telp == "" {
		Error(w, http.StatusBadRequest, "NIK harus 16 digit; nama, username, dan nomor telepon wajib diisi")
		return
	}
	if len(req.NamaLengkap) > 100 || len(req.Username) > 50 || len(req.Telp) > 25 {
		Error(w, http.StatusBadRequest, "Panjang nama, username, atau nomor telepon melebihi batas")
		return
	}

	firebaseUser, err := GetFirebaseUser(r.Context(), identity.UID)
	if err != nil {
		Error(w, http.StatusUnauthorized, "Tidak dapat memverifikasi akun")
		return
	}
	email := strings.ToLower(strings.TrimSpace(firebaseUser.Email))
	if email == "" || len(email) > 100 {
		Error(w, http.StatusBadRequest, "Akun harus memiliki alamat email yang valid")
		return
	}

	var existingID int
	err = DB.QueryRowContext(r.Context(),
		`SELECT id_user FROM tb_masyarakat WHERE firebase_uid = ?`, identity.UID,
	).Scan(&existingID)
	if err == nil {
		Error(w, http.StatusConflict, "Akun ini sudah memiliki profil masyarakat; silakan masuk")
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		Error(w, http.StatusInternalServerError, "Gagal memeriksa profil di database")
		return
	}

	err = DB.QueryRowContext(r.Context(),
		`SELECT id_user FROM tb_masyarakat WHERE email = ?`, email,
	).Scan(&existingID)
	if err == nil {
		Error(w, http.StatusConflict, "Email sudah terhubung dengan profil lama; akun tidak ditautkan otomatis")
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		Error(w, http.StatusInternalServerError, "Gagal memeriksa email profil")
		return
	}

	hashID, err := NewHashID()
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membuat hash ID")
		return
	}

	res, err := DB.Exec(`
		INSERT INTO tb_masyarakat
			(hash_id, firebase_uid, ft_ktp, nama_lengkap, username, password, email, telp, alamat, saldo_wallet, saldo_hold, is_verified)
		VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 0.00, 0.00, 0)`,
		hashID, identity.UID, req.NIK, req.NamaLengkap, req.Username, email, req.Telp, req.Alamat)
	if err != nil {
		Error(w, http.StatusConflict, "Username, email, NIK, nomor telepon, atau akun sudah terdaftar")
		return
	}

	id, err := res.LastInsertId()
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membaca ID pengguna yang dibuat")
		return
	}
	JSON(w, http.StatusCreated, Response{
		Success: true,
		Message: "Registrasi akun berhasil!",
		Data: map[string]any{
			"id_user":      id,
			"hash_id":      hashID,
			"nama":         req.NamaLengkap,
			"nama_lengkap": req.NamaLengkap,
			"username":     req.Username,
			"role":         "masyarakat",
			"email":        email,
			"telp":         req.Telp,
			"nik":          req.NIK,
			"alamat":       req.Alamat,
		},
	})
}

// LoginPetugas login untuk petugas dan admin
func LoginPetugas(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	var id, idLevel int
	var nama, username, passHash, level, nip, avatar string
	err := DB.QueryRow(`
		SELECT p.id_petugas, p.id_level, l.level, p.nama_petugas, p.username, p.password, '' AS nip, '' AS avatar_url
		FROM tb_petugas p
		JOIN tb_level l ON l.id_level = p.id_level
		WHERE p.username = ?`, strings.TrimSpace(req.Username),
	).Scan(&id, &idLevel, &level, &nama, &username, &passHash, &nip, &avatar)

	if err == sql.ErrNoRows {
		Error(w, http.StatusUnauthorized, "Username petugas atau password salah")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query database: "+err.Error())
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passHash), []byte(req.Password)); err != nil {
		Error(w, http.StatusUnauthorized, "Username petugas atau password salah")
		return
	}

	token, err := BuatToken(id, "", level, nama)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal generate token")
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Login petugas berhasil!",
		Data: map[string]any{
			"token":        token,
			"id_petugas":   id,
			"id_level":     idLevel,
			"role":         level,
			"nama_petugas": nama,
			"username":     username,
			"nip":          nip,
			"avatar_url":   avatar,
		},
	})
}

// Me mengembalikan data profil pengguna yang sedang login
func Me(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Belum login")
		return
	}

	if claims.Role == "masyarakat" {
		var id int
		var hashID, nama, username, email, telp, nik, avatar, alamat string
		var saldoWallet, saldoHold float64
		var isVerified bool

		err := DB.QueryRowContext(r.Context(), `
			SELECT id_user, IFNULL(hash_id,''), nama_lengkap, username, IFNULL(email,''), telp, ft_ktp, IFNULL(avatar_url,''), IFNULL(alamat,''), saldo_wallet, saldo_hold, is_verified
			FROM tb_masyarakat WHERE firebase_uid = ?`, claims.FirebaseUID,
		).Scan(&id, &hashID, &nama, &username, &email, &telp, &nik, &avatar, &alamat, &saldoWallet, &saldoHold, &isVerified)

		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				Error(w, http.StatusNotFound, "Profil masyarakat belum terdaftar")
				return
			}
			Error(w, http.StatusInternalServerError, "Gagal membaca profil masyarakat")
			return
		}

		JSON(w, http.StatusOK, Response{
			Success: true,
			Data: map[string]any{
				"id_user":      id,
				"hash_id":      hashID,
				"role":         "masyarakat",
				"nama_lengkap": nama,
				"username":     username,
				"email":        email,
				"telp":         telp,
				"nik":          nik,
				"alamat":       alamat,
				"avatar_url":   avatar,
				"saldo_wallet": saldoWallet,
				"saldo_hold":   saldoHold,
				"is_verified":  isVerified,
			},
		})
		return
	}

	// Petugas / Admin
	var id, idLevel int
	var nama, username, level, nip, avatar string
	err := DB.QueryRow(`
		SELECT p.id_petugas, p.id_level, l.level, p.nama_petugas, p.username, '' AS nip, '' AS avatar_url
		FROM tb_petugas p
		JOIN tb_level l ON l.id_level = p.id_level
		WHERE p.id_petugas = ?`, claims.ID,
	).Scan(&id, &idLevel, &level, &nama, &username, &nip, &avatar)

	if err != nil {
		Error(w, http.StatusNotFound, "Petugas tidak ditemukan")
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]any{
			"id_petugas":   id,
			"id_level":     idLevel,
			"role":         level,
			"nama_petugas": nama,
			"username":     username,
			"nip":          nip,
			"avatar_url":   avatar,
		},
	})
}
