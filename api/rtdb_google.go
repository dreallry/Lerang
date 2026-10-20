package api

import (
	"net/http"
	"net/url"
	"strings"
)

func applyGoogleProfile(profile map[string]interface{}, identity *FirebaseIdentity) {
	if identity == nil || identity.Provider != "google.com" || !identity.EmailVerified {
		return
	}
	if name := strings.TrimSpace(identity.DisplayName); name != "" && len(name) <= 200 {
		profile["display_name"] = name
	}
	photo, err := url.Parse(identity.PhotoURL)
	if err == nil && photo.Scheme == "https" && photo.User == nil && photo.Port() == "" && strings.HasSuffix(strings.ToLower(photo.Hostname()), ".googleusercontent.com") {
		profile["avatar_url"] = photo.String()
	}
	profile["email_verified"] = true
}

func SyncGoogleProfileRTDB(w http.ResponseWriter, r *http.Request) {
	identity := FirebaseIdentityFromRequest(r)
	if identity == nil || identity.Provider != "google.com" || !identity.EmailVerified {
		Error(w, http.StatusForbidden, "Gunakan sesi Google dengan email terverifikasi")
		return
	}
	profileRequired := false
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		profileRequired = false
		profile := treeRecord(root, "staff", identity.UID)
		if profile != nil {
			if profile["active"] != true || profile["uid"] != identity.UID {
				return domainError(http.StatusForbidden, "Akun petugas belum aktif")
			}
		} else {
			profile = treeRecord(root, "users", identity.UID)
		}
		if profile == nil {
			profileRequired = true
			return nil
		}
		applyGoogleProfile(profile, identity)
		profile["updated_at"] = rtdbNow()
		return nil
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Data: map[string]interface{}{"profile_required": profileRequired}})
}
