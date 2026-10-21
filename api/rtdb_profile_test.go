package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"
)

// All requests terminate at this local fixture; these tests never use project credentials.
func fixtureRTDB(t *testing.T, records map[string]interface{}, failRead string) *map[string]interface{} {
	t.Helper()
	var written map[string]interface{}
	root := map[string]interface{}{}
	for path, value := range records {
		parts := strings.Split(strings.Trim(strings.TrimSuffix(path, ".json"), "/"), "/")
		if len(parts) > 0 {
			treeNode(root, parts[:len(parts)-1]...)[parts[len(parts)-1]] = value
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", `"fixture-version"`)
		if r.Method == http.MethodGet {
			if r.URL.Path == failRead {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"fixture permission denied"}`))
				return
			}
			var value interface{} = root
			for _, part := range strings.Split(strings.Trim(strings.TrimSuffix(r.URL.Path, ".json"), "/"), "/") {
				if part != "" {
					value = treeMap(value)[part]
				}
			}
			_ = json.NewEncoder(w).Encode(value)
			return
		}
		if r.Method != http.MethodPatch && r.Method != http.MethodPut {
			t.Errorf("unexpected Firebase write method: %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&written); err != nil {
			t.Error(err)
		}
		if r.Method == http.MethodPut {
			root = written
		}
		_ = json.NewEncoder(w).Encode(written)
	}))
	t.Cleanup(server.Close)
	t.Setenv("FIREBASE_DATABASE_EMULATOR_HOST", strings.Replace(server.URL, "http://127.0.0.1", "localhost", 1)+"?ns=fixture-project")
	app, err := firebase.NewApp(context.Background(), &firebase.Config{ProjectID: "fixture-project", DatabaseURL: "https://fixture-project.firebaseio.com"}, option.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatal(err)
	}
	client, err := app.Database(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	previous := firebaseDatabaseClient
	firebaseDatabaseClient = client
	t.Cleanup(func() { firebaseDatabaseClient = previous })
	return &written
}

func registrationRequest(verified bool) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{"nik":"1234567890123456","nama_lengkap":"Fixture peserta","username":"fixture","telp":"081234567890"}`))
	return r.WithContext(context.WithValue(r.Context(), FirebaseIdentityKey, &FirebaseIdentity{UID: "new-uid", Email: "fixture@example.invalid", EmailVerified: verified}))
}

func TestLegacyProfileRequiresVerifiedEmailAndPreservesBalances(t *testing.T) {
	for _, verified := range []bool{false, true} {
		t.Run(map[bool]string{false: "unverified", true: "verified"}[verified], func(t *testing.T) {
			profile := map[string]interface{}{"id_user": 7, "email": "fixture@example.invalid", "saldo_wallet": 450000, "saldo_hold": 150000}
			written := fixtureRTDB(t, map[string]interface{}{"/legacy_users.json": map[string]interface{}{"7": profile}}, "")
			w := httptest.NewRecorder()
			RegisterMasyarakatRTDB(w, registrationRequest(verified))
			if !verified {
				if w.Code != http.StatusForbidden || *written != nil {
					t.Fatalf("unverified identity must not claim the profile: %d %v", w.Code, *written)
				}
				return
			}
			if w.Code != http.StatusOK {
				t.Fatalf("registration failed: %d %s", w.Code, w.Body)
			}
			saved := treeRecord(*written, "users", "new-uid")
			if saved["id_user"] != float64(7) || saved["saldo_wallet"] != float64(450000) || saved["saldo_hold"] != float64(150000) || treeMap((*written)["user_ids"])["7"] != "new-uid" {
				t.Fatalf("legacy balances or ID changed: %v", *written)
			}
			if treeRecord(*written, "legacy_users", "7") != nil {
				t.Fatal("old UID must be detached in the same update")
			}
		})
	}
}

func TestProfileReadFailureIsNotReportedAsMissingAccount(t *testing.T) {
	for _, role := range []UserRole{RoleMasyarakat, RolePetugas} {
		t.Run(string(role), func(t *testing.T) {
			node := "users"
			if role == RolePetugas {
				node = "staff"
			}
			fixtureRTDB(t, nil, "/"+node+"/fixture-uid.json")
			w := httptest.NewRecorder()
			MeRTDB(w, withRTDBClaims(httptest.NewRequest(http.MethodGet, "/api/auth/me", nil), &RTDBClaims{UID: "fixture-uid", Role: role}))
			if w.Code != 500 || strings.Contains(w.Body.String(), "belum terdaftar") {
				t.Fatalf("transient database error was reported as missing account: %d %s", w.Code, w.Body)
			}
		})
	}
}

func TestRegistrationDoesNotReplaceProfilesAfterReadFailure(t *testing.T) {
	written := fixtureRTDB(t, nil, "/users/new-uid.json")
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, registrationRequest(true))
	if w.Code != http.StatusInternalServerError || *written != nil {
		t.Fatalf("failed read must not create a new profile: %d %v", w.Code, *written)
	}
}

func TestRegistrationRetryReturnsExistingProfileWithoutWriting(t *testing.T) {
	written := fixtureRTDB(t, map[string]interface{}{"/users/new-uid.json": map[string]interface{}{"id_user": 7, "saldo_wallet": 450000}}, "")
	w := httptest.NewRecorder()
	RegisterMasyarakatRTDB(w, registrationRequest(true))
	if w.Code != http.StatusOK || *written != nil {
		t.Fatalf("retry must not overwrite saved data: %d %v", w.Code, *written)
	}
}

func TestItemUpdateResubmissionAndOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, status string
		owner, actor int
		role         UserRole
		want         int
	}{
		{"rejected owner resubmits", "rejected", 7, 7, RoleMasyarakat, 200},
		{"other participant cannot edit", "rejected", 7, 8, RoleMasyarakat, 403},
		{"owner cannot edit published lot", "approved", 7, 7, RoleMasyarakat, 403},
		{"staff can edit a participant item", "approved", 7, 8, RolePetugas, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			records := map[string]interface{}{"/items/4.json": map[string]interface{}{"id_barang": 4, "id_user": tc.owner, "status_verifikasi": tc.status, "nama_barang": "Fixture", "kategori": "Koleksi & Seni", "harga_awal": 100000}}
			if tc.role == RoleMasyarakat {
				records["/users/fixture-uid.json"] = map[string]interface{}{"id_user": tc.actor}
			} else {
				records["/staff/fixture-uid.json"] = map[string]interface{}{"uid": "fixture-uid", "id_petugas": tc.actor, "id_level": 2, "role": string(tc.role), "active": true}
			}
			written := fixtureRTDB(t, records, "")
			r := httptest.NewRequest(http.MethodPut, "/api/barang/4", strings.NewReader(`{"nama_barang":"Revisi fixture","harga_awal":150000,"id_user":999,"status_verifikasi":"approved","expected_updated_at":""}`))
			r.SetPathValue("id", "4")
			r = withRTDBClaims(r, &RTDBClaims{ID: tc.actor, UID: "fixture-uid", Role: tc.role})
			w := httptest.NewRecorder()
			UpdateBarangInfoRTDB(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d: %s", w.Code, tc.want, w.Body)
			}
			if tc.want != 200 {
				if *written != nil {
					t.Fatal("forbidden edit was written")
				}
				return
			}
			if rtdbNumericID(treeRecord(*written, "items", "4")["id_user"]) != tc.owner {
				t.Fatal("client changed item ownership")
			}
			if tc.status == "rejected" && treeRecord(*written, "items", "4")["status_verifikasi"] != "pending" {
				t.Fatal("resubmitted item must re-enter curation")
			}
		})
	}
}

func TestPublicItemDetailDoesNotExposeUnpublishedDocuments(t *testing.T) {
	for _, status := range []string{"pending", "rejected"} {
		t.Run(status, func(t *testing.T) {
			fixtureRTDB(t, map[string]interface{}{"/items/4.json": map[string]interface{}{"id_barang": 4, "status_verifikasi": status, "dokumen_pendukung": []string{"fixture-private-document"}}}, "")
			r := httptest.NewRequest(http.MethodGet, "/api/barang/4", nil)
			r.SetPathValue("id", "4")
			w := httptest.NewRecorder()
			GetDetailBarangRTDB(w, r)
			if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "fixture-private-document") {
				t.Fatalf("unpublished documents were exposed: %d %s", w.Code, w.Body)
			}
		})
	}
}

func TestInvoiceListRespectsParticipantAndStaffRoles(t *testing.T) {
	for _, tc := range []struct {
		role  UserRole
		count int
	}{{RoleMasyarakat, 1}, {RolePetugas, 2}, {RoleAdministrator, 2}} {
		t.Run(string(tc.role), func(t *testing.T) {
			fixtureRTDB(t, map[string]interface{}{"/invoices.json": map[string]interface{}{"first": map[string]interface{}{"id_user": 7}, "second": map[string]interface{}{"id_user": 8}}}, "")
			r := withRTDBClaims(httptest.NewRequest(http.MethodGet, "/api/pembayaran", nil), &RTDBClaims{ID: 7, Role: tc.role})
			w := httptest.NewRecorder()
			ListInvoicesRTDB(w, r)
			var response struct {
				Data []map[string]interface{} `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || len(response.Data) != tc.count {
				t.Fatalf("role %s received %d invoices, want %d", tc.role, len(response.Data), tc.count)
			}
		})
	}
}
