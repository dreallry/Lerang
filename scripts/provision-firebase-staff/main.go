// Command provision-firebase-staff creates or updates a Firebase Auth staff
// account and its role profile in Realtime Database.
//
// Examples:
//
//	go run ./scripts/provision-firebase-staff --email admin@example.com --role administrator
//	go run ./scripts/provision-firebase-staff --email petugas@example.com --role petugas --display-name "Petugas 1" --password-stdin
//
// The command is idempotent by email. Existing users are updated in place and
// receive fresh custom claims. Passwords are read from stdin when requested so
// they do not end up in shell history.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	firebaseDB "firebase.google.com/go/v4/db"
	"github.com/joho/godotenv"
	"google.golang.org/api/option"
)

func main() {
	log.SetFlags(0)
	_ = godotenv.Load()

	email := flag.String("email", "", "alamat email staf (wajib)")
	role := flag.String("role", "petugas", "role: petugas atau administrator")
	displayName := flag.String("display-name", "", "nama tampilan staf")
	idPetugas := flag.Int("id-petugas", 0, "ID numerik lama; jika kosong, gunakan ID berikutnya")
	idLevel := flag.Int("id-level", 0, "ID level lama; default administrator=1, petugas=2")
	password := flag.String("password", "", "password awal; hindari opsi ini agar tidak masuk shell history")
	passwordStdin := flag.Bool("password-stdin", false, "baca password awal dari satu baris stdin")
	credentials := flag.String("credentials", env("FIREBASE_CREDENTIALS", ""), "path service-account Firebase JSON")
	databaseURL := flag.String("database-url", env("FIREBASE_DATABASE_URL", ""), "Firebase Realtime Database URL")
	flag.Parse()

	if err := validateEmail(*email); err != nil {
		log.Fatal(err)
	}
	if *role != "petugas" && *role != "administrator" {
		log.Fatal("--role harus petugas atau administrator")
	}
	if *passwordStdin {
		if *password != "" {
			log.Fatal("gunakan salah satu --password atau --password-stdin")
		}
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && len(line) == 0 {
			log.Fatalf("baca password dari stdin: %v", err)
		}
		*password = strings.TrimSpace(line)
	}
	if *password != "" && len(*password) < 6 {
		log.Fatal("password Firebase minimal 6 karakter")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	authClient, dbClient, err := initFirebaseClients(ctx, *credentials, *databaseURL)
	if err != nil {
		log.Fatal(err)
	}

	user, created, err := findOrCreateUser(ctx, authClient, *email, *displayName, *password)
	if err != nil {
		log.Fatal(err)
	}
	claims := map[string]any{
		"role":  *role,
		"admin": *role == "administrator",
	}
	if err := authClient.SetCustomUserClaims(ctx, user.UID, claims); err != nil {
		log.Fatalf("set custom claims untuk %s: %v", user.UID, err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	staffRef := dbClient.NewRef("staff").Child(user.UID)
	var existing map[string]any
	_ = staffRef.Get(ctx, &existing)
	if *idPetugas <= 0 {
		*idPetugas = numericID(existing["id_petugas"])
	}
	if *idPetugas <= 0 {
		*idPetugas, err = nextStaffID(ctx, dbClient)
		if err != nil {
			log.Fatalf("tentukan id petugas: %v", err)
		}
	}
	if *idLevel <= 0 {
		if *role == "administrator" {
			*idLevel = 1
		} else {
			*idLevel = 2
		}
	}
	name := firstNonEmpty(*displayName, user.DisplayName, strings.Split(user.Email, "@")[0])
	if err := staffRef.Update(ctx, map[string]any{
		"uid":          user.UID,
		"id_petugas":   *idPetugas,
		"id_level":     *idLevel,
		"email":        strings.ToLower(user.Email),
		"display_name": name,
		"nama_petugas": name,
		"nama_lengkap": name,
		"username":     strings.Split(user.Email, "@")[0],
		"role":         *role,
		"active":       true,
		"updated_at":   now,
	}); err != nil {
		log.Fatalf("simpan profil /staff/%s: %v", user.UID, err)
	}

	action := "diperbarui"
	if created {
		action = "dibuat"
	}
	log.Printf("Akun Firebase %s %s; role %s aktif di /staff/%s.", user.Email, action, *role, user.UID)
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func validateEmail(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("--email wajib diisi")
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value {
		return fmt.Errorf("alamat email tidak valid: %q", value)
	}
	return nil
}

func initFirebaseClients(ctx context.Context, credentialsPath, databaseURL string) (*auth.Client, *firebaseDB.Client, error) {
	credentialsPath = strings.TrimSpace(credentialsPath)
	if credentialsPath == "" {
		return nil, nil, errors.New("FIREBASE_CREDENTIALS wajib diisi")
	}
	if !filepath.IsAbs(credentialsPath) {
		absolute, err := filepath.Abs(credentialsPath)
		if err != nil {
			return nil, nil, fmt.Errorf("resolve FIREBASE_CREDENTIALS: %w", err)
		}
		credentialsPath = absolute
	}
	if _, err := os.Stat(credentialsPath); err != nil {
		return nil, nil, fmt.Errorf("service-account Firebase tidak dapat diakses: %w", err)
	}
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, nil, errors.New("FIREBASE_DATABASE_URL wajib diisi")
	}

	app, err := firebase.NewApp(ctx, &firebase.Config{DatabaseURL: databaseURL}, option.WithCredentialsFile(credentialsPath))
	if err != nil {
		return nil, nil, fmt.Errorf("inisialisasi Firebase: %w", err)
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("inisialisasi Firebase Auth: %w", err)
	}
	dbClient, err := app.DatabaseWithURL(ctx, databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("inisialisasi Realtime Database: %w", err)
	}
	return authClient, dbClient, nil
}

func findOrCreateUser(ctx context.Context, client *auth.Client, email, displayName, password string) (*auth.UserRecord, bool, error) {
	user, err := client.GetUserByEmail(ctx, email)
	created := false
	if err != nil {
		if !auth.IsUserNotFound(err) {
			return nil, false, fmt.Errorf("cari user Firebase: %w", err)
		}
		params := (&auth.UserToCreate{}).Email(email).EmailVerified(false)
		if displayName != "" {
			params = params.DisplayName(displayName)
		}
		if password != "" {
			params = params.Password(password)
		}
		user, err = client.CreateUser(ctx, params)
		if err != nil {
			return nil, false, fmt.Errorf("buat user Firebase: %w", err)
		}
		created = true
	} else if password != "" || displayName != "" {
		params := (&auth.UserToUpdate{})
		if password != "" {
			params = params.Password(password)
		}
		if displayName != "" {
			params = params.DisplayName(displayName)
		}
		user, err = client.UpdateUser(ctx, user.UID, params)
		if err != nil {
			return nil, false, fmt.Errorf("perbarui user Firebase: %w", err)
		}
	}
	return user, created, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func numericID(value any) int {
	switch value := value.(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case string:
		id, _ := strconv.Atoi(value)
		return id
	default:
		return 0
	}
}

func nextStaffID(ctx context.Context, db *firebaseDB.Client) (int, error) {
	var staff map[string]map[string]any
	if err := db.NewRef("staff").Get(ctx, &staff); err != nil {
		return 0, err
	}
	maxID := 0
	for key, profile := range staff {
		id := numericID(profile["id_petugas"])
		if id == 0 {
			id = numericID(key)
		}
		if id > maxID {
			maxID = id
		}
	}
	return maxID + 1, nil
}
