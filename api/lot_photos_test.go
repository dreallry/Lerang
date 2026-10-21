package api

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func fixturePhoto(t *testing.T) []byte {
	t.Helper()
	var encoded bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	picture.Set(0, 0, color.RGBA{R: 90, G: 120, B: 90, A: 255})
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func TestServerPhotoUploadPersistsAndServesOnlyPublicLotPhotos(t *testing.T) {
	directory := t.TempDir()
	previousRoot, previousStorage := photoRoot, firebaseStorage
	photoRoot, firebaseStorage = nil, nil
	t.Cleanup(func() {
		if photoRoot != nil {
			photoRoot.Close()
		}
		photoRoot, firebaseStorage = previousRoot, previousStorage
	})
	t.Setenv("PHOTO_UPLOAD_DIR", directory)
	if err := InitPhotoUploads(); err != nil {
		t.Fatal(err)
	}
	photo := fixturePhoto(t)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("foto", "../../fixture.png")
	if err != nil {
		t.Fatal(err)
	}
	part.Write(photo)
	form.Close()
	upload := httptest.NewRequest("POST", "/api/upload", &body)
	upload.Header.Set("Content-Type", form.FormDataContentType())
	upload = withRTDBClaims(upload, &RTDBClaims{UID: "photo-fixture", ID: 1, Role: RoleMasyarakat})
	w := httptest.NewRecorder()
	UploadFotoRTDB(w, upload)
	var result struct {
		Data struct {
			URL      string `json:"url"`
			Firebase bool   `json:"firebase"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || result.Data.Firebase || !serverPhotoPath.MatchString(result.Data.URL) {
		t.Fatalf("upload failed: %s", w.Body.String())
	}
	stored, err := photoRoot.ReadFile(strings.TrimPrefix(result.Data.URL, "/api/photos/"))
	if err != nil || !bytes.Equal(stored, photo) {
		t.Fatal("successful upload did not persist its actual bytes")
	}
	secondURL, err := saveServerPhoto(photo, ".png")
	if err != nil || secondURL == result.Data.URL {
		t.Fatal("a later upload overwrote an existing photo")
	}
	w = httptest.NewRecorder()
	NewHandler().ServeHTTP(w, httptest.NewRequest("GET", result.Data.URL, nil))
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), photo) || w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("public photo does not round trip safely")
	}
	for _, path := range []string{"/api/photos/secret.json", "/api/photos/fixture.svg", "/uploads/ktp/fixture.jpg", "/api/photos/" + strings.Repeat("a", 32) + ".jpg"} {
		w = httptest.NewRecorder()
		NewHandler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("unexpected public file access at %s: %d", path, w.Code)
		}
	}
	w = httptest.NewRecorder()
	NewHandler().ServeHTTP(w, httptest.NewRequest("POST", "/api/upload", strings.NewReader("fixture")))
	if w.Code != http.StatusUnauthorized {
		t.Fatal("anonymous upload was accepted")
	}
	info, err := photoRoot.Stat(strings.TrimPrefix(result.Data.URL, "/api/photos/"))
	if err != nil || info.Size() != int64(len(photo)) {
		t.Fatal("photo file size changed")
	}
}

func TestPhotoValidationRejectsDisguisedUnsupportedEmptyAndOversizedFiles(t *testing.T) {
	photo := fixturePhoto(t)
	for _, fixture := range []struct {
		name string
		data []byte
	}{
		{"empty.png", nil}, {"photo.jpg", photo}, {"photo.html", photo},
		{"photo.png", []byte("<html><script>alert(1)</script></html>")},
		{"photo.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)},
		{"large.png", bytes.Repeat([]byte{1}, maxPhotoBytes+1)},
	} {
		if _, _, _, err := readPhoto(bytes.NewReader(fixture.data), fixture.name); err == nil {
			t.Fatalf("accepted %s", fixture.name)
		}
	}
	if _, contentType, extension, err := readPhoto(bytes.NewReader(photo), "PHOTO.PNG"); err != nil || contentType != "image/png" || extension != ".png" {
		t.Fatal("valid PNG rejected")
	}
	if _, _, _, err := readPhoto(io.LimitReader(bytes.NewReader(photo), 0), "file.png"); err == nil {
		t.Fatal("empty stream accepted")
	}
}

func TestItemPhotoPathsArePortableAndCannotReferencePrivateServerFiles(t *testing.T) {
	base := map[string]interface{}{"nama_barang": "FIXTURE", "kategori": "Lainnya", "harga_awal": 100000}
	for _, value := range []string{"/api/photos/" + strings.Repeat("a", 32) + ".png", "https://example.com/photo.png"} {
		base["foto_barang"] = []string{value}
		if err := validateItemData(base); err != nil {
			t.Fatalf("valid photo rejected: %v", err)
		}
	}
	for _, value := range []string{"/api/photos/../secrets/fixture.json", "/uploads/ktp/photo.png", "/api/photos/test.svg", "file:///secret.png"} {
		base["foto_barang"] = []string{value}
		if err := validateItemData(base); err == nil {
			t.Fatalf("private/invalid path accepted: %s", value)
		}
	}
	base["foto_barang"] = nil
	base["dokumen_pendukung"] = []string{"/api/photos/" + strings.Repeat("a", 32) + ".png"}
	if err := validateItemData(base); err == nil {
		t.Fatal("public photo path unexpectedly treated as private document")
	}
}

func TestDisabledAndUnwritablePhotoDirectories(t *testing.T) {
	previous := photoRoot
	photoRoot = nil
	t.Cleanup(func() { photoRoot = previous })
	t.Setenv("PHOTO_UPLOAD_DIR", "")
	if err := InitPhotoUploads(); err != nil || photoRoot != nil {
		t.Fatal("empty directory enabled server storage")
	}
	path := t.TempDir() + "/not-a-directory"
	if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PHOTO_UPLOAD_DIR", path)
	if err := InitPhotoUploads(); err == nil || photoRoot != nil {
		t.Fatal("unavailable directory offered uploads")
	}
}
