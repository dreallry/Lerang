package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const UserKey ctxKey = "user"
const FirebaseIdentityKey ctxKey = "firebase_identity"

type Claims struct {
	ID          int    `json:"id"`
	HashID      string `json:"hash_id"`
	Role        string `json:"role"`
	Nama        string `json:"nama"`
	FirebaseUID string `json:"-"`
	jwt.RegisteredClaims
}

func secret() ([]byte, error) {
	s := os.Getenv("JWT_SECRET")
	if len(s) < 32 {
		return nil, errors.New("JWT_SECRET harus dikonfigurasi dengan minimal 32 byte")
	}
	return []byte(s), nil
}

func ValidateJWTSecret() error {
	_, err := secret()
	return err
}

func BuatToken(id int, hashID, role, nama string) (string, error) {
	claims := Claims{
		ID:     id,
		HashID: hashID,
		Role:   role,
		Nama:   nama,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	key, err := secret()
	if err != nil {
		return "", err
	}
	return t.SignedString(key)
}

func ParseToken(tokenStr string) (*Claims, error) {
	key, err := secret()
	if err != nil {
		return nil, err
	}
	t, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return key, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	return c, nil
}

func FromRequest(r *http.Request) *Claims {
	c, _ := r.Context().Value(UserKey).(*Claims)
	return c
}

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

func FirebaseJWT(next http.HandlerFunc) http.HandlerFunc {
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
		claims, err := communityClaims(r.Context(), identity.UID)
		if err == sql.ErrNoRows {
			Error(w, http.StatusForbidden, "Akun belum memiliki profil masyarakat; selesaikan registrasi terlebih dahulu")
			return
		}
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memuat profil masyarakat")
			return
		}
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func communityClaims(ctx context.Context, uid string) (*Claims, error) {
	var claims Claims
	claims.FirebaseUID = uid
	claims.Role = string(RoleMasyarakat)
	err := DB.QueryRowContext(ctx, `
		SELECT id_user, IFNULL(hash_id,''), nama_lengkap
		FROM tb_masyarakat WHERE firebase_uid = ?`, uid,
	).Scan(&claims.ID, &claims.HashID, &claims.Nama)
	if err != nil {
		return nil, err
	}
	return &claims, nil
}

func StaffJWT(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r)
		if !ok {
			Error(w, http.StatusUnauthorized, "token tidak ada")
			return
		}
		claims, err := ParseToken(raw)
		if err != nil {
			Error(w, http.StatusUnauthorized, "token petugas tidak valid atau kedaluwarsa")
			return
		}
		claims, err = currentStaffClaims(r.Context(), claims)
		if err == sql.ErrNoRows {
			Error(w, http.StatusUnauthorized, "akun petugas tidak ditemukan")
			return
		}
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memverifikasi peran petugas")
			return
		}
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func currentStaffClaims(ctx context.Context, claims *Claims) (*Claims, error) {
	if claims == nil || claims.ID <= 0 {
		return nil, sql.ErrNoRows
	}
	err := DB.QueryRowContext(ctx, `
		SELECT p.id_petugas, l.level, p.nama_petugas
		FROM tb_petugas p
		JOIN tb_level l ON l.id_level = p.id_level
		WHERE p.id_petugas = ?`, claims.ID,
	).Scan(&claims.ID, &claims.Role, &claims.Nama)
	if err != nil {
		return nil, err
	}
	claims.FirebaseUID = ""
	return claims, nil
}

func Authenticated(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r)
		if !ok {
			Error(w, http.StatusUnauthorized, "token tidak ada")
			return
		}

		identity, firebaseErr := VerifyFirebaseIDToken(r.Context(), raw)
		if firebaseErr == nil {
			claims, err := communityClaims(r.Context(), identity.UID)
			if err == sql.ErrNoRows {
				Error(w, http.StatusForbidden, "Akun belum memiliki profil masyarakat")
				return
			}
			if err != nil {
				Error(w, http.StatusInternalServerError, "Gagal memuat profil masyarakat")
				return
			}
			ctx := context.WithValue(r.Context(), UserKey, claims)
			next(w, r.WithContext(ctx))
			return
		}

		claims, err := ParseToken(raw)
		if err != nil {
			if !FirebaseReady() {
				Error(w, http.StatusServiceUnavailable, "Layanan autentikasi belum tersedia")
				return
			}
			Error(w, http.StatusUnauthorized, "token tidak valid atau kedaluwarsa")
			return
		}
		claims, err = currentStaffClaims(r.Context(), claims)
		if err == sql.ErrNoRows {
			Error(w, http.StatusUnauthorized, "token tidak valid atau akun petugas tidak ditemukan")
			return
		}
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memverifikasi akun")
			return
		}
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func Role(roles ...string) func(http.HandlerFunc) http.HandlerFunc {
	allowed := map[string]struct{}{}
	for _, r := range roles {
		allowed[r] = struct{}{}
	}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return StaffJWT(func(w http.ResponseWriter, r *http.Request) {
			c := FromRequest(r)
			if _, ok := allowed[c.Role]; !ok {
				Error(w, http.StatusForbidden, "akses ditolak")
				return
			}
			next(w, r)
		})
	}
}

func CORS(next http.Handler) http.Handler {
	return secureOrigin(next)
}
