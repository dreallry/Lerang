package api

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type stalledUploadBody struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *stalledUploadBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return 0, io.EOF
}
func (b *stalledUploadBody) Close() error { return nil }

func TestUploadBusyAccountIsRejectedBeforeReadingBody(t *testing.T) {
	previousRoot, previousStorage := photoRoot, firebaseStorage
	var err error
	photoRoot, err = os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	firebaseStorage = nil
	t.Cleanup(func() { photoRoot.Close(); photoRoot, firebaseStorage = previousRoot, previousStorage })
	blocked := &stalledUploadBody{entered: make(chan struct{}), release: make(chan struct{})}
	request := withRTDBClaims(httptest.NewRequest("POST", "/api/upload", blocked), &RTDBClaims{UID: "upload-fixture", ID: 1, Role: RoleMasyarakat})
	request.Header.Set("Content-Type", "multipart/form-data; boundary=fixture")
	done := make(chan struct{})
	go func() { defer close(done); UploadFotoRTDB(httptest.NewRecorder(), request) }()
	<-blocked.entered
	t.Cleanup(func() { close(blocked.release); <-done })
	other := withRTDBClaims(httptest.NewRequest("POST", "/api/upload", strings.NewReader("invalid")), &RTDBClaims{UID: "upload-fixture", ID: 1, Role: RoleMasyarakat})
	w := httptest.NewRecorder()
	UploadFotoRTDB(w, other)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Fatalf("busy upload was parsed instead of rejected: %d", w.Code)
	}
}

func TestUploadAdmissionBoundsOneHundredAccountsAndReleases(t *testing.T) {
	var wg sync.WaitGroup
	var attempted sync.WaitGroup
	var accepted atomic.Int32
	start, release := make(chan struct{}), make(chan struct{})
	for i := 0; i < 100; i++ {
		wg.Add(1)
		attempted.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			uid := fmt.Sprintf("upload-%d", i)
			admitted := reservePhotoUpload(uid)
			attempted.Done()
			if admitted {
				accepted.Add(1)
				<-release
				releasePhotoUpload(uid)
			}
		}(i)
	}
	close(start)
	attempted.Wait()
	close(release)
	wg.Wait()
	if accepted.Load() != 4 {
		t.Fatalf("expected4 admitted uploads, got%d", accepted.Load())
	}
	if !reservePhotoUpload("after-burst") {
		t.Fatal("completed uploads leaked admission slots")
	}
	releasePhotoUpload("after-burst")
}
