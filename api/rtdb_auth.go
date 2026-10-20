package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

type RTDBClaims struct {
	ID            int
	UID           string
	Role          UserRole
	Nama          string
	Email         string
	EmailVerified bool
	AuthTime      int64
}

type rtdbClaimsKey string

const rtdbClaimsContextKey rtdbClaimsKey = "rtdb_claims"

func rtdbClaimsFromRequest(r *http.Request) *RTDBClaims {
	claims, _ := r.Context().Value(rtdbClaimsContextKey).(*RTDBClaims)
	return claims
}

func withRTDBClaims(r *http.Request, claims *RTDBClaims) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), rtdbClaimsContextKey, claims))
}

func requireRTDBIdentity(next http.HandlerFunc) http.HandlerFunc {
	return FirebaseIdentityRequired(next)
}

func rtdbLoadClaims(ctx context.Context, identity *FirebaseIdentity) (*RTDBClaims, error) {
	if identity == nil || identity.UID == "" {
		return nil, errors.New("identitas Firebase tidak valid")
	}

	var staff map[string]interface{}
	if err := rtdbGet(ctx, "staff/"+identity.UID, &staff); err != nil {
		return nil, err
	}
	if len(staff) > 0 {
		if staff["active"] != true {
			return nil, domainError(http.StatusForbidden, "Akun petugas dinonaktifkan. Hubungi administrator")
		}
		if stringValue(staff["uid"], "") != identity.UID {
			return nil, domainError(http.StatusForbidden, "Identitas profil petugas belum valid")
		}
		role := UserRole(stringValue(staff["role"], ""))
		level := rtdbNumericID(staff["id_level"])
		if rtdbNumericID(staff["id_petugas"]) <= 0 || (role != RoleAdministrator && role != RolePetugas) || (role == RoleAdministrator && level != 1) || (role == RolePetugas && level != 2) {
			return nil, domainError(http.StatusForbidden, "Hak akses petugas belum valid. Hubungi administrator")
		}
		return &RTDBClaims{
			ID:            rtdbNumericID(staff["id_petugas"]),
			UID:           identity.UID,
			Role:          role,
			Nama:          stringValue(staff["nama_petugas"], stringValue(staff["nama_lengkap"], "Petugas")),
			Email:         identity.Email,
			EmailVerified: identity.EmailVerified,
			AuthTime:      identity.AuthTime,
		}, nil
	}

	var user map[string]interface{}
	if err := rtdbGet(ctx, "users/"+identity.UID, &user); err != nil {
		return nil, err
	}
	if len(user) == 0 || rtdbNumericID(user["id_user"]) <= 0 {
		return nil, sql.ErrNoRows
	}
	return &RTDBClaims{
		ID:            rtdbNumericID(user["id_user"]),
		UID:           identity.UID,
		Role:          RoleMasyarakat,
		Nama:          stringValue(user["nama_lengkap"], stringValue(user["nama"], "Masyarakat")),
		Email:         stringValue(user["email"], identity.Email),
		EmailVerified: identity.EmailVerified,
		AuthTime:      identity.AuthTime,
	}, nil
}

func rtdbAuthenticated(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r)
		if !ok {
			Error(w, http.StatusUnauthorized, "Sesi masuk yang valid diperlukan")
			return
		}
		identity, err := VerifyFirebaseIDToken(r.Context(), raw)
		if err != nil {
			Error(w, http.StatusUnauthorized, "Sesi Firebase tidak valid atau kedaluwarsa")
			return
		}
		claims, err := rtdbLoadClaims(r.Context(), identity)
		if errors.Is(err, sql.ErrNoRows) {
			Error(w, http.StatusForbidden, "Akun belum memiliki profil di Realtime Database")
			return
		}
		if err != nil {
			rtdbJSONError(w, err)
			return
		}
		next(w, withRTDBClaims(r, claims))
	}
}

func RtdbAuthenticated(next http.HandlerFunc) http.HandlerFunc { return rtdbAuthenticated(next) }

func RtdbRole(roles ...UserRole) func(http.HandlerFunc) http.HandlerFunc { return rtdbRole(roles...) }

func rtdbRole(roles ...UserRole) func(http.HandlerFunc) http.HandlerFunc {
	allowed := make(map[UserRole]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return rtdbAuthenticated(func(w http.ResponseWriter, r *http.Request) {
			claims := rtdbClaimsFromRequest(r)
			if claims == nil || !allowed[claims.Role] {
				Error(w, http.StatusForbidden, "akses ditolak")
				return
			}
			next(w, r)
		})
	}
}

func stringValue(value interface{}, fallback string) string {
	if value == nil {
		return fallback
	}
	if text, ok := value.(string); ok && text != "" {
		return text
	}
	return fallback
}

func rtdbUserByID(ctx context.Context, id int) (map[string]interface{}, string, error) {
	var uid string
	if err := rtdbGet(ctx, "user_ids/"+rtdbPathID(id), &uid); err == nil && uid != "" {
		var profile map[string]interface{}
		if err := rtdbGet(ctx, "users/"+uid, &profile); err == nil && len(profile) > 0 && rtdbNumericID(profile["id_user"]) == id {
			return profile, uid, nil
		}
	}
	var users map[string]map[string]interface{}
	if err := rtdbGet(ctx, "users", &users); err != nil {
		return nil, "", err
	}
	for uid, profile := range users {
		if rtdbNumericID(profile["id_user"]) == id {
			return profile, uid, nil
		}
	}
	return nil, "", sql.ErrNoRows
}
