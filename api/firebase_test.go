package api

import "testing"

func TestInitFirebaseRequiresCredentials(t *testing.T) {
	t.Setenv("FIREBASE_CREDENTIALS", "")
	err := initFirebase()
	if err == nil || err.Error() != "FIREBASE_CREDENTIALS belum dikonfigurasi" {
		t.Fatalf("expected missing credentials error, got %v", err)
	}
}
