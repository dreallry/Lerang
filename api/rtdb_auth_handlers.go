package api

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
)

func RegisterMasyarakatRTDB(w http.ResponseWriter, r *http.Request) {
	identity := FirebaseIdentityFromRequest(r)
	if identity == nil || identity.UID == "" {
		Error(w, http.StatusUnauthorized, "Sesi Firebase diperlukan")
		return
	}
	var req RegisterRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}
	req.NIK, req.NamaLengkap, req.Username, req.Telp, req.Alamat = strings.TrimSpace(req.NIK), strings.TrimSpace(req.NamaLengkap), strings.TrimSpace(req.Username), strings.TrimSpace(req.Telp), strings.TrimSpace(req.Alamat)
	if len(req.NIK) != 16 || strings.Trim(req.NIK, "0123456789") != "" || req.NamaLengkap == "" || req.Username == "" || req.Telp == "" {
		Error(w, http.StatusBadRequest, "NIK harus 16 digit; nama, username, dan nomor telepon wajib diisi")
		return
	}
	if len(req.NamaLengkap) > 100 || len(req.Username) > 50 || len(req.Telp) > 25 || len(req.Alamat) > 500 {
		Error(w, http.StatusBadRequest, "Panjang data profil melebihi batas")
		return
	}

	var existing map[string]interface{}
	if err := rtdbGet(r.Context(), "users/"+identity.UID, &existing); err != nil {
		rtdbJSONError(w, err)
		return
	}
	if len(existing) > 0 {
		JSON(w, 200, Response{Success: true, Data: existing})
		return
	}
	email := strings.ToLower(strings.TrimSpace(identity.Email))
	if email == "" {
		Error(w, 400, "Gunakan akun Firebase dengan email untuk mendaftar")
		return
	}
	var profile map[string]interface{}
	created := false
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		created = false
		if treeRecord(root, "staff", identity.UID) != nil {
			return domainError(403, "Akun petugas tidak dapat didaftarkan sebagai peserta")
		}
		if saved := treeRecord(root, "users", identity.UID); saved != nil {
			profile = saved
			return nil
		}
		for _, node := range []string{"users", "legacy_users"} {
			for oldUID, value := range treeMap(root[node]) {
				old := treeMap(value)
				if old == nil || !strings.EqualFold(stringValue(old["email"], ""), email) || node == "users" && oldUID == identity.UID {
					continue
				}
				if node == "users" {
					return domainError(409, "Email profil sudah terkait dengan akun lain. Hubungi pengelola untuk pemeriksaan identitas")
				}
				if !identity.EmailVerified {
					return domainError(403, "Verifikasi email terlebih dahulu, lalu kirim ulang profil untuk menautkan akun lama")
				}
				for otherKey, otherValue := range treeMap(root["legacy_users"]) {
					if otherKey != oldUID && strings.EqualFold(stringValue(treeMap(otherValue)["email"], ""), email) {
						return domainError(409, "Email arsip terkait dengan beberapa profil. Hubungi pengelola untuk pemeriksaan identitas")
					}
				}
				id := rtdbNumericID(old["id_user"])
				if id <= 0 {
					return domainError(409, "ID profil lama belum valid. Hubungi pengelola")
				}
				for uid, liveValue := range treeMap(root["users"]) {
					live := treeMap(liveValue)
					if uid != oldUID && rtdbNumericID(live["id_user"]) == id {
						return domainError(409, "ID profil lama berbenturan dengan akun aktif. Hubungi pengelola")
					}
				}
				profile = map[string]interface{}{}
				for key, value := range old {
					profile[key] = value
				}
				profile["firebase_uid"], profile["email"], profile["updated_at"] = identity.UID, email, rtdbNow()
				if stringValue(profile["nik"], "") == "" {
					profile["nik"] = req.NIK
				}
				profile["role"] = string(RoleMasyarakat)
				profile["requires_identity_link"] = false
				applyGoogleProfile(profile, identity)
				for _, collection := range []string{"notifications", "walletTransactions"} {
					for _, sourceKey := range []struct{ node, key string }{{"legacy_" + collection, rtdbPathID(id)}, {collection, oldUID}} {
						if sourceKey.node == collection && sourceKey.key == identity.UID {
							continue
						}
						for key, value := range treeMap(treeMap(root[sourceKey.node])[sourceKey.key]) {
							destination := treeNode(root, collection, identity.UID)
							if destination[key] != nil {
								return domainError(409, "Riwayat akun berbenturan; pengelola perlu memeriksa sebelum penautan")
							}
							row := treeMap(value)
							if row != nil {
								row["owner_uid"] = identity.UID
							}
							destination[key] = value
						}
						delete(treeNode(root, sourceKey.node), sourceKey.key)
					}
				}
				delete(treeNode(root, node), oldUID)
				treeNode(root, "users")[identity.UID] = profile
				treeNode(root, "user_ids")[rtdbPathID(id)] = identity.UID
				return nil
			}
		}
		id := nextTreeID(root, "users")
		profile = map[string]interface{}{"id_user": id, "firebase_uid": identity.UID, "nama_lengkap": req.NamaLengkap, "username": req.Username, "email": email, "telp": req.Telp, "nik": req.NIK, "alamat": req.Alamat, "saldo_wallet": 0, "saldo_hold": 0, "is_verified": false, "created_at": rtdbNow(), "role": string(RoleMasyarakat)}
		applyGoogleProfile(profile, identity)
		treeNode(root, "users")[identity.UID] = profile
		treeNode(root, "user_ids")[rtdbPathID(id)] = identity.UID
		created = true
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	JSON(w, status, Response{Success: true, Message: "Profil peserta tersimpan", Data: profile})
}

func MeRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Belum login")
		return
	}
	if claims.Role == RoleMasyarakat {
		var profile map[string]interface{}
		if err := rtdbGet(r.Context(), "users/"+claims.UID, &profile); err != nil {
			rtdbJSONError(w, err)
			return
		}
		if len(profile) == 0 {
			Error(w, http.StatusNotFound, "Profil masyarakat belum terdaftar")
			return
		}
		profile["email_verified"] = claims.EmailVerified
		JSON(w, http.StatusOK, Response{Success: true, Data: profile})
		return
	}
	var profile map[string]interface{}
	if err := rtdbGet(r.Context(), "staff/"+claims.UID, &profile); err != nil {
		rtdbJSONError(w, err)
		return
	}
	if len(profile) == 0 {
		Error(w, http.StatusNotFound, "Profil petugas belum terdaftar")
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: profile})
}

func ListUsersRTDB(w http.ResponseWriter, r *http.Request) {
	var users map[string]map[string]interface{}
	if err := rtdbGet(r.Context(), "users", &users); err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0, len(users))
	for uid, user := range users {
		if user == nil {
			continue
		}
		user["firebase_uid"] = uid
		list = append(list, user)
	}
	var legacy map[string]map[string]interface{}
	if err := rtdbGet(r.Context(), "legacy_users", &legacy); err != nil {
		rtdbJSONError(w, err)
		return
	}
	for _, profile := range legacy {
		if profile != nil {
			profile["legacy_historical"] = true
			profile["requires_identity_link"] = true
			list = append(list, profile)
		}
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: list})
}

func rtdbJSONError(w http.ResponseWriter, err error) {
	var actionError *transactionError
	if errors.As(err, &actionError) {
		Error(w, actionError.status, actionError.message)
		return
	}
	if errors.Is(err, ErrRTDBUnavailable) {
		Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		Error(w, http.StatusNotFound, "Data tidak ditemukan")
		return
	}
	log.Printf("Realtime Database request failed: %v", err)
	Error(w, http.StatusInternalServerError, "Data belum dapat dimuat atau disimpan. Coba lagi beberapa saat lagi")
}
