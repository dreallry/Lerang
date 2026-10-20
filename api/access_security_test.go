package api

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	firebase "firebase.google.com/go/v4"
	"github.com/golang-jwt/jwt/v5"
	"google.golang.org/api/option"
)

func fixtureAuth(t *testing.T, disabled bool, validSince int64) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{SerialNumber: big.NewInt(1)}, &x509.Certificate{SerialNumber: big.NewInt(1)}, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/robot/") {
			w.Header().Set("Cache-Control", "max-age=3600")
			_ = json.NewEncoder(w).Encode(map[string]string{"fixture-key": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate}))})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"users": []interface{}{map[string]interface{}{
			"localId": "fixture-staff", "email": "staff@example.invalid", "disabled": disabled,
			"validSince": strconv.FormatInt(validSince, 10),
		}}})
	}))
	t.Cleanup(server.Close)
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
	previousTransport := http.DefaultTransport
	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig.ServerName = "example.com"
	dialer := &net.Dialer{}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if strings.Contains(address, ".googleapis.com:") {
			address = server.Listener.Addr().String()
		}
		return dialer.DialContext(ctx, network, address)
	}
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previousTransport; transport.CloseIdleConnections() })
	app, err := firebase.NewApp(context.Background(), &firebase.Config{ProjectID: "fixture-project"}, option.WithoutAuthentication(), option.WithHTTPClient(&http.Client{Transport: transport}))
	if err != nil {
		t.Fatal(err)
	}
	client, err := app.Auth(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	previous := firebaseAuth
	firebaseAuth = client
	t.Cleanup(func() { firebaseAuth = previous })
	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"aud": "fixture-project", "iss": "https://securetoken.google.com/fixture-project", "sub": "fixture-staff",
		"iat": now - 120, "exp": now + 3600, "auth_time": now - 120, "email": "staff@example.invalid",
	})
	token.Header["kid"] = "fixture-key"
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestFirebaseRejectsDisabledAndRevokedSessions(t *testing.T) {
	for _, tc := range []struct {
		name     string
		disabled bool
		revoked  bool
	}{
		{"disabled account", true, false},
		{"revoked token", false, true},
		{"active account", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			validSince := int64(0)
			if tc.revoked {
				validSince = time.Now().Unix()
			}
			token := fixtureAuth(t, tc.disabled, validSince)
			identity, err := VerifyFirebaseIDToken(context.Background(), token)
			if tc.disabled || tc.revoked {
				if err == nil || identity != nil {
					t.Fatal("disabled or revoked sessions must not authenticate")
				}
			} else if err != nil || identity == nil || identity.UID != "fixture-staff" {
				t.Fatalf("active session rejected: %v", err)
			}
		})
	}
}

func TestInactiveStaffCannotRestoreAccess(t *testing.T) {
	for _, active := range []interface{}{false, nil, "true"} {
		fixtureRTDB(t, map[string]interface{}{"staff/fixture-staff.json": map[string]interface{}{
			"uid": "fixture-staff", "id_petugas": 3, "id_level": 1, "role": "administrator", "active": active,
		}}, "")
		if _, err := rtdbLoadClaims(context.Background(), &FirebaseIdentity{UID: "fixture-staff"}); err == nil {
			t.Fatalf("inactive or invalid staff flag granted access: %v", active)
		}
	}
}

func TestStaffIdentityMustMatchTheProfile(t *testing.T) {
	fixtureRTDB(t, map[string]interface{}{"staff/fixture-staff.json": map[string]interface{}{
		"uid": "another-uid", "id_petugas": 3, "id_level": 1, "role": "administrator", "active": true,
	}}, "")
	if _, err := rtdbLoadClaims(context.Background(), &FirebaseIdentity{UID: "fixture-staff"}); err == nil {
		t.Fatal("a profile for another identity must not grant staff privileges")
	}
}

func TestDirectoryRoutesRequireAnAdministrator(t *testing.T) {
	for _, role := range []string{"administrator", "petugas"} {
		t.Run(role, func(t *testing.T) {
			token := fixtureAuth(t, false, 0)
			level := 1
			if role == "petugas" {
				level = 2
			}
			fixtureRTDB(t, map[string]interface{}{"staff/fixture-staff.json": map[string]interface{}{
				"uid": "fixture-staff", "id_petugas": 3, "id_level": level, "role": role, "active": true,
			}}, "")
			for _, path := range []string{"/api/admin/users", "/api/admin/staff"} {
				r := httptest.NewRequest(http.MethodGet, path, nil)
				r.Header.Set("Authorization", "Bearer "+token)
				w := httptest.NewRecorder()
				NewHandler().ServeHTTP(w, r)
				want := http.StatusForbidden
				if role == "administrator" {
					want = http.StatusOK
				}
				if w.Code != want {
					t.Fatalf("%s on %s returned %d, want %d: %s", role, path, w.Code, want, w.Body)
				}
			}
		})
	}
}

func TestPaymentMonitorRoutesRejectParticipantsAndGuests(t *testing.T) {
	token := fixtureAuth(t, false, 0)
	for _, role := range []string{"administrator", "petugas", "masyarakat", "guest"} {
		root := map[string]interface{}{}
		if role == "masyarakat" {
			treeNode(root, "users")["fixture-staff"] = map[string]interface{}{"id_user": 7}
		} else {
			level := 1
			if role == "petugas" {
				level = 2
			}
			treeNode(root, "staff")["fixture-staff"] = map[string]interface{}{"uid": "fixture-staff", "id_petugas": 3, "id_level": level, "role": role, "active": true}
		}
		paymentRTDBFixture(t, root)
		for _, tc := range []struct{ method, path string }{{"GET", "/api/admin/payments"}, {"POST", "/api/admin/payments/UNKNOWN/sync"}} {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if role != "guest" {
				r.Header.Set("Authorization", "Bearer "+token)
			}
			w := httptest.NewRecorder()
			NewHandler().ServeHTTP(w, r)
			if role == "guest" && w.Code != 401 || role == "masyarakat" && w.Code != 403 || (role == "petugas" || role == "administrator") && tc.method == "GET" && w.Code != 200 {
				t.Fatalf("%s %s: %d %s", role, tc.path, w.Code, w.Body)
			}
		}
	}
}

func TestStaffDirectoryExcludesSecretsAndLabelsArchives(t *testing.T) {
	fixtureRTDB(t, map[string]interface{}{
		"staff/fixture-staff.json": map[string]interface{}{"id_petugas": 3, "id_level": 1, "active": true, "password": "never-expose-this", "password_hash": "private-hash"},
		"legacy_staff/1.json":      map[string]interface{}{"id_petugas": 1, "id_level": 2, "active": true},
	}, "")
	w := httptest.NewRecorder()
	ListStaffRTDB(w, httptest.NewRequest(http.MethodGet, "/api/admin/staff", nil))
	var payload struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(payload.Data) != 2 || strings.Contains(w.Body.String(), "password") {
		t.Fatalf("invalid or sensitive directory response: %s", w.Body)
	}
	if payload.Data[0]["active"] != false || payload.Data[0]["requires_identity_link"] != true || payload.Data[1]["active"] != true {
		t.Fatal("archived staff must not be presented as active Firebase accounts")
	}
}

func TestDatabaseErrorsDoNotExposeProviderDetails(t *testing.T) {
	fixtureRTDB(t, nil, "/staff.json")
	w := httptest.NewRecorder()
	ListStaffRTDB(w, httptest.NewRequest(http.MethodGet, "/api/admin/staff", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "fixture") || strings.Contains(w.Body.String(), "permission denied") {
		t.Fatalf("provider details exposed: %s", w.Body)
	}
}

func TestCORSRestrictsOriginsAndPreservesServerCallbacks(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://auction.example")
	for _, tc := range []struct {
		name, origin, method string
		want                 int
	}{
		{"allowed website", "https://auction.example", "GET", 200},
		{"allowed preflight", "https://auction.example", "OPTIONS", 204},
		{"foreign website", "https://attacker.example", "POST", 403},
		{"foreign preflight", "https://attacker.example", "OPTIONS", 403},
		{"server callback without Origin", "", "POST", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(tc.method, "/api/example", nil)
			r.Header.Set("Origin", tc.origin)
			secureHeaders(CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))).ServeHTTP(w, r)
			if w.Code != tc.want || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("unexpected status or headers: %d %v", w.Code, w.Header())
			}
			if w.Header().Get("Access-Control-Allow-Origin") == "*" || (tc.want == 403 && w.Header().Get("Access-Control-Allow-Origin") != "") {
				t.Fatal("CORS must never grant the foreign origin")
			}
		})
	}
	server := NewHTTPServer(":0")
	if server.ReadHeaderTimeout <= 0 || server.ReadTimeout <= 0 || server.WriteTimeout <= 0 || server.IdleTimeout <= 0 {
		t.Fatal("HTTP requests must have finite timeouts")
	}
}
