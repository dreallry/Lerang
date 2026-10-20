package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const maxPhotoBytes = 10 << 20
const maxServerPhotoBytes = 500 << 20

var photoRoot *os.Root
var photoWriteMu sync.Mutex
var serverPhotoPath = regexp.MustCompile(`^/api/photos/[a-f0-9]{32}\.(jpg|png|webp|gif)$`)

func InitPhotoUploads() error {
	directory := strings.TrimSpace(os.Getenv("PHOTO_UPLOAD_DIR"))
	if directory == "" {
		return nil
	}
	if err := os.MkdirAll(directory, 0750); err != nil {
		return err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		root.Close()
		return err
	}
	probeName := ".write-check-" + hex.EncodeToString(random)
	probe, err := root.OpenFile(probeName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		root.Close()
		return err
	}
	err = probe.Close()
	removeErr := root.Remove(probeName)
	if err != nil || removeErr != nil {
		root.Close()
		return errors.New("folder foto tidak dapat ditulis")
	}
	photoRoot = root
	return nil
}

func readPhoto(data io.Reader, filename string) ([]byte, string, string, error) {
	fileBytes, err := io.ReadAll(io.LimitReader(data, maxPhotoBytes+1))
	if err != nil {
		return nil, "", "", errors.New("gagal membaca foto")
	}
	if len(fileBytes) == 0 || len(fileBytes) > maxPhotoBytes {
		return nil, "", "", errors.New("foto harus berisi data dan tidak melebihi 10 MB")
	}
	contentType := http.DetectContentType(fileBytes)
	extension, err := imageExtension(contentType)
	if err != nil {
		return nil, "", "", err
	}
	suppliedExt := strings.ToLower(filepath.Ext(filename))
	if suppliedExt != ".jpg" && suppliedExt != ".jpeg" && suppliedExt != ".png" && suppliedExt != ".webp" && suppliedExt != ".gif" {
		return nil, "", "", errors.New("gunakan file JPG, PNG, WebP, atau GIF")
	}
	if suppliedType := strings.Split(mime.TypeByExtension(suppliedExt), ";")[0]; suppliedType != contentType {
		return nil, "", "", errors.New("tipe file tidak sesuai dengan isi foto")
	}
	return fileBytes, contentType, extension, nil
}

// shortcut: abandoned photos are retained; add reference-aware cleanup when the 500 MB capacity becomes limiting.
func saveServerPhoto(data []byte, extension string) (string, error) {
	photoWriteMu.Lock()
	defer photoWriteMu.Unlock()
	directory, err := photoRoot.Open(".")
	if err != nil {
		return "", err
	}
	entries, err := directory.ReadDir(-1)
	directory.Close()
	if err != nil {
		return "", err
	}
	var total int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return "", err
		}
		total += info.Size()
	}
	if total+int64(len(data)) > maxServerPhotoBytes {
		return "", domainError(507, "Penyimpanan foto server penuh. Hubungi administrator sebelum mengunggah lagi")
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	name := hex.EncodeToString(random) + extension
	file, err := photoRoot.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	_, writeErr := io.Copy(file, bytes.NewReader(data))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = photoRoot.Remove(name)
		return "", errors.New("foto belum tersimpan; coba unggah kembali")
	}
	return "/api/photos/" + name, nil
}

func ServeLotPhoto(w http.ResponseWriter, r *http.Request) {
	if photoRoot == nil || !serverPhotoPath.MatchString(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	file, err := photoRoot.Open(r.PathValue("name"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(info.Name())))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", fmt.Sprintf(`"%s"`, info.Name()))
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
