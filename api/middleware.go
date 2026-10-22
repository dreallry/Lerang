package api

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey string

const FirebaseIdentityKey ctxKey = "firebase_identity"

func FirebaseIdentityFromRequest(r *http.Request) *FirebaseIdentity {
	identity, _ := r.Context().Value(FirebaseIdentityKey).(*FirebaseIdentity)
	return identity
}

func bearerToken(r *http.Request) (string, bool) {
	fields := strings.Fields(r.Header.Get("Authorization"))
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return "", false
	}
	return fields[1], true
}

func FirebaseIdentityRequired(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r)
		if !ok {
			Error(w, http.StatusUnauthorized, "Sesi masuk yang valid diperlukan")
			return
		}
		identity, err := VerifyFirebaseIDToken(r.Context(), raw)
		if err != nil {
			if !FirebaseReady() {
				Error(w, http.StatusServiceUnavailable, "Layanan autentikasi belum tersedia")
				return
			}
			Error(w, http.StatusUnauthorized, "Sesi masuk tidak valid atau kedaluwarsa")
			return
		}
		ctx := context.WithValue(r.Context(), FirebaseIdentityKey, identity)
		next(w, r.WithContext(ctx))
	}
}

func CORS(next http.Handler) http.Handler {
	return secureOrigin(next)
}
