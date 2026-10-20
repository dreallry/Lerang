package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGoogleMetadataPreservesLegalIdentityRoleAndBalance(t *testing.T) {
	profile := map[string]interface{}{"role": "masyarakat", "nama_lengkap": "Nama resmi", "saldo_wallet": 100000, "nik": "fixture"}
	applyGoogleProfile(profile, &FirebaseIdentity{Provider: "google.com", EmailVerified: true, DisplayName: "Nama Google", PhotoURL: "https://lh3.googleusercontent.com/fixture"})
	if profile["display_name"] != "Nama Google" || profile["avatar_url"] != "https://lh3.googleusercontent.com/fixture" || profile["role"] != "masyarakat" || profile["nama_lengkap"] != "Nama resmi" || profile["saldo_wallet"] != 100000 || profile["nik"] != "fixture" {
		t.Fatal("Google profile sync changed privileged or legal profile fields")
	}
	for _, photo := range []string{"javascript:alert(1)", "http://lh3.googleusercontent.com/fixture", "https://googleusercontent.com.attacker.example/x", "https://user@lh3.googleusercontent.com/x"} {
		value := map[string]interface{}{}
		applyGoogleProfile(value, &FirebaseIdentity{Provider: "google.com", EmailVerified: true, PhotoURL: photo})
		if value["avatar_url"] != nil {
			t.Fatalf("untrusted profile image accepted: %s", photo)
		}
	}
}

func TestGoogleCannotClaimAnExistingStaffProfileByEmail(t *testing.T) {
	written := fixtureRTDB(t, map[string]interface{}{"staff/owner.json": map[string]interface{}{"uid": "owner", "email": "staff@example.invalid", "role": "administrator", "active": true}}, "")
	r := httptest.NewRequest(http.MethodPost, "/api/auth/google-profile", nil)
	r = r.WithContext(context.WithValue(r.Context(), FirebaseIdentityKey, &FirebaseIdentity{UID: "different-uid", Email: "staff@example.invalid", Provider: "google.com", EmailVerified: true}))
	w := httptest.NewRecorder()
	SyncGoogleProfileRTDB(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"profile_required":true`) || treeRecord(*written, "staff", "different-uid") != nil || treeRecord(*written, "users", "different-uid") != nil {
		t.Fatalf("Google must not assign staff access or incomplete financial profiles: %s", w.Body)
	}
}

func TestGoogleSyncRejectsOtherProvidersAndUnverifiedEmail(t *testing.T) {
	for _, identity := range []*FirebaseIdentity{{UID: "fixture", Provider: "password", EmailVerified: true}, {UID: "fixture", Provider: "google.com"}} {
		r := httptest.NewRequest(http.MethodPost, "/api/auth/google-profile", nil)
		r = r.WithContext(context.WithValue(r.Context(), FirebaseIdentityKey, identity))
		w := httptest.NewRecorder()
		SyncGoogleProfileRTDB(w, r)
		if w.Code != 403 {
			t.Fatalf("non-Google or unverified session accepted: %d", w.Code)
		}
	}
}

func TestGoogleRegistrationKeepsIdentityCompletionRequired(t *testing.T) {
	written := fixtureRTDB(t, nil, "")
	r := registrationRequest(true)
	r = r.WithContext(context.WithValue(r.Context(), FirebaseIdentityKey, &FirebaseIdentity{UID: "new-uid", Email: "fixture@example.invalid", EmailVerified: true, Provider: "google.com", DisplayName: "Google fixture", PhotoURL: "https://lh3.googleusercontent.com/fixture"}))
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, r)
	profile := treeRecord(*written, "users", "new-uid")
	if w.Code != 201 || profile["display_name"] != "Google fixture" || profile["email_verified"] != true || profile["is_verified"] != false || profile["nik"] != "1234567890123456" {
		t.Fatalf("Google registration omitted identity or invented KYC approval: %d", w.Code)
	}
}
