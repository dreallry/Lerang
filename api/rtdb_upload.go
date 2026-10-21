package api

import (
	"log"
	"net/http"
	"strings"
	"sync"
)

var activePhotoUploads = struct {
	sync.Mutex
	users map[string]bool
}{users: map[string]bool{}}

func reservePhotoUpload(uid string) bool {
	activePhotoUploads.Lock()
	defer activePhotoUploads.Unlock()
	if activePhotoUploads.users[uid] || len(activePhotoUploads.users) >= 4 {
		return false
	}
	activePhotoUploads.users[uid] = true
	return true
}

func releasePhotoUpload(uid string) {
	activePhotoUploads.Lock()
	defer activePhotoUploads.Unlock()
	delete(activePhotoUploads.users, uid)
}

func GetUploadAvailabilityRTDB(w http.ResponseWriter, r *http.Request) {
	JSON(w, http.StatusOK, Response{Success: true, Data: map[string]interface{}{"enabled": FirebaseStorageReady() || photoRoot != nil}})
}

func UploadFotoRTDB(w http.ResponseWriter, r *http.Request) {
	if !FirebaseStorageReady() && photoRoot == nil {
		Error(w, 503, "Unggah file belum tersedia. Gunakan URL foto untuk melanjutkan pengajuan")
		return
	}
	claims := rtdbClaimsFromRequest(r)
	if claims == nil || claims.UID == "" {
		Error(w, http.StatusUnauthorized, "Sesi masuk diperlukan untuk mengunggah foto")
		return
	}
	if !reservePhotoUpload(claims.UID) {
		w.Header().Set("Retry-After", "2")
		Error(w, http.StatusTooManyRequests, "Unggahan sedang diproses. Tunggu sebentar lalu coba lagi")
		return
	}
	defer releasePhotoUpload(claims.UID)
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		Error(w, 400, "Form upload tidak valid")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("foto")
	if err != nil {
		Error(w, 400, "File foto wajib diisi")
		return
	}
	defer file.Close()
	if photoRoot != nil && !FirebaseStorageReady() {
		data, _, extension, err := readPhoto(file, strings.TrimSpace(header.Filename))
		if err != nil {
			Error(w, 400, err.Error())
			return
		}
		photoURL, err := saveServerPhoto(data, extension)
		if err != nil {
			log.Printf("Gagal menyimpan foto lot: %v", err)
			if failure, ok := err.(*transactionError); ok {
				Error(w, failure.status, failure.message)
				return
			}
			Error(w, 503, "Foto belum tersimpan di server. Coba unggah kembali")
			return
		}
		JSON(w, 200, Response{Success: true, Data: map[string]interface{}{"url": photoURL, "firebase": false}})
		return
	}
	url, _, err := UploadFileToFirebase(r.Context(), file, strings.TrimSpace(header.Filename))
	if err != nil {
		Error(w, 400, err.Error())
		return
	}
	JSON(w, 200, Response{Success: true, Data: map[string]interface{}{"url": url, "firebase": true}})
}
