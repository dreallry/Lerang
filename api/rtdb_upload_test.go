package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConfiguredBucketWithoutStorageAccessDoesNotOfferFileUpload(t *testing.T) {
	previousClient, previousBucket := firebaseStorage, firebaseBucket
	previousRoot := photoRoot
	photoRoot = nil
	firebaseStorage, firebaseBucket = nil, "fixture-bucket"
	t.Cleanup(func() { firebaseStorage, firebaseBucket, photoRoot = previousClient, previousBucket, previousRoot })
	w := httptest.NewRecorder()
	GetUploadAvailabilityRTDB(w, httptest.NewRequest("GET", "/api/upload", nil))
	var response struct {
		Data struct {
			Enabled bool `json:"enabled"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || response.Data.Enabled {
		t.Fatal("a configured name without bucket access offered uploads")
	}
	w = httptest.NewRecorder()
	UploadFotoRTDB(w, httptest.NewRequest("POST", "/api/upload", strings.NewReader("fixture")))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "URL foto") {
		t.Fatal("unavailable upload did not offer the supported URL path")
	}
}
