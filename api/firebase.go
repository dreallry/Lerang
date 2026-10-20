package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	firebaseDB "firebase.google.com/go/v4/db"
	firebaseStorageSDK "firebase.google.com/go/v4/storage"
	"google.golang.org/api/option"
)

type FirebaseIdentity struct {
	UID           string
	Email         string
	EmailVerified bool
	AuthTime      int64
	DisplayName   string
	PhotoURL      string
	Provider      string
}

var (
	firebaseInitOnce       sync.Once
	firebaseInitErr        error
	firebaseApp            *firebase.App
	firebaseAuth           *auth.Client
	firebaseStorage        *firebaseStorageSDK.Client
	firebaseDatabaseClient *firebaseDB.Client
	firebaseBucket         string
	firebaseDatabaseURL    string
)

func InitFirebase() error {
	firebaseInitOnce.Do(func() {
		firebaseInitErr = initFirebase()
	})
	return firebaseInitErr
}

func initFirebase() error {
	credentialsPath := strings.TrimSpace(os.Getenv("FIREBASE_CREDENTIALS"))
	if credentialsPath == "" {
		return errors.New("FIREBASE_CREDENTIALS belum dikonfigurasi")
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		return fmt.Errorf("file kredensial Firebase tidak dapat diakses: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("FIREBASE_CREDENTIALS harus menunjuk ke file")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	firebaseBucket = strings.TrimSpace(os.Getenv("FIREBASE_STORAGE_BUCKET"))
	firebaseDatabaseURL = strings.TrimSpace(os.Getenv("FIREBASE_DATABASE_URL"))
	config := &firebase.Config{}
	if firebaseDatabaseURL != "" {
		config.DatabaseURL = firebaseDatabaseURL
	}
	if firebaseBucket != "" {
		config.StorageBucket = firebaseBucket
	}

	app, err := firebase.NewApp(ctx, config, option.WithCredentialsFile(credentialsPath))
	if err != nil {
		return fmt.Errorf("inisialisasi Firebase Admin SDK gagal: %w", err)
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		return fmt.Errorf("inisialisasi Firebase Authentication gagal: %w", err)
	}

	firebaseApp = app
	firebaseAuth = authClient

	if firebaseDatabaseURL != "" {
		dbClient, err := app.DatabaseWithURL(ctx, firebaseDatabaseURL)
		if err != nil {
			log.Printf("Peringatan: inisialisasi Realtime Database client gagal: %v", err)
		} else {
			firebaseDatabaseClient = dbClient
			log.Println("Firebase Realtime Database client siap:", firebaseDatabaseURL)
		}
	} else {
		log.Println("Peringatan: Firebase Realtime Database belum dikonfigurasi; buat database lalu isi FIREBASE_DATABASE_URL")
	}

	if firebaseBucket == "" {
		log.Println("Firebase Authentication siap; Firebase Storage belum aktif karena FIREBASE_STORAGE_BUCKET belum diatur")
		return nil
	}

	storageClient, err := app.Storage(ctx)
	if err != nil {
		log.Printf("Firebase Storage belum tersedia: %v", err)
		return nil
	}
	bucket, err := storageClient.Bucket(firebaseBucket)
	if err == nil {
		checkCtx, checkCancel := context.WithTimeout(ctx, 8*time.Second)
		_, err = bucket.Attrs(checkCtx)
		checkCancel()
	}
	if err != nil {
		log.Println("Firebase Storage belum dapat diakses; unggah file memakai folder server jika PHOTO_UPLOAD_DIR dikonfigurasi.")
		return nil
	}
	firebaseStorage = storageClient
	log.Println("Firebase Storage siap; akses bucket telah diperiksa")
	return nil
}

func FirebaseReady() bool {
	return firebaseAuth != nil
}

func FirebaseStorageReady() bool {
	return firebaseStorage != nil && firebaseBucket != ""
}

func FirebaseDatabaseReady() bool {
	return firebaseDatabaseClient != nil && firebaseDatabaseURL != ""
}

func FirebaseDatabaseURL() string {
	return firebaseDatabaseURL
}

func FirebaseDatabase() *firebaseDB.Client {
	return firebaseDatabaseClient
}

// SyncLelangToRealtimeDB menyinkronkan data lelang terkini ke Firebase Realtime Database
func SyncLelangToRealtimeDB(ctx context.Context) error {
	if firebaseDatabaseClient == nil || DB == nil {
		return nil
	}
	ref := firebaseDatabaseClient.NewRef("lelang")
	rows, err := DB.QueryContext(ctx, `
		SELECT l.id_lelang, l.id_barang, b.nama_barang, b.kategori,
		       l.harga_awal, l.harga_akhir, l.status, l.tgl_mulai, l.tgl_selesai
		FROM tb_lelang l
		JOIN tb_barang b ON b.id_barang = l.id_barang
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	data := make(map[string]any)
	for rows.Next() {
		var idLelang, idBarang int
		var namaBarang, kategori, status, tglMulai, tglSelesai string
		var hargaAwal, hargaAkhir float64
		if err := rows.Scan(&idLelang, &idBarang, &namaBarang, &kategori,
			&hargaAwal, &hargaAkhir, &status, &tglMulai, &tglSelesai); err != nil {
			continue
		}
		data[fmt.Sprintf("lot_%d", idLelang)] = map[string]any{
			"id_lelang":   idLelang,
			"id_barang":   idBarang,
			"nama_barang": namaBarang,
			"kategori":    kategori,
			"harga_awal":  hargaAwal,
			"harga_akhir": hargaAkhir,
			"status":      status,
			"tgl_mulai":   tglMulai,
			"tgl_selesai": tglSelesai,
			"updated_at":  time.Now().Format(time.RFC3339),
		}
	}
	if err := ref.Set(ctx, data); err != nil {
		log.Printf("Peringatan: Gagal sync ke Realtime Database: %v", err)
		return err
	}
	sysRef := firebaseDatabaseClient.NewRef("system")
	_ = sysRef.Set(ctx, map[string]any{
		"balai":     "Lerang Official Auction House",
		"status":    "online",
		"last_sync": time.Now().Format(time.RFC3339),
		"server":    "Golang Native",
	})
	log.Println("Sinkronisasi data lelang ke Firebase Realtime Database berhasil!")
	return nil
}

func VerifyFirebaseIDToken(ctx context.Context, idToken string) (*FirebaseIdentity, error) {
	if firebaseAuth == nil {
		return nil, errors.New("Firebase Authentication belum diinisialisasi")
	}
	verified, err := firebaseAuth.VerifyIDTokenAndCheckRevoked(ctx, idToken)
	if err != nil {
		return nil, fmt.Errorf("verifikasi Firebase ID token gagal: %w", err)
	}
	email, _ := verified.Claims["email"].(string)
	emailVerified, _ := verified.Claims["email_verified"].(bool)
	displayName, _ := verified.Claims["name"].(string)
	photoURL, _ := verified.Claims["picture"].(string)
	return &FirebaseIdentity{
		UID:           verified.UID,
		Email:         email,
		EmailVerified: emailVerified,
		AuthTime:      verified.AuthTime,
		DisplayName:   displayName,
		PhotoURL:      photoURL,
		Provider:      verified.Firebase.SignInProvider,
	}, nil
}

func GetFirebaseUser(ctx context.Context, uid string) (*auth.UserRecord, error) {
	if firebaseAuth == nil {
		return nil, errors.New("Firebase Authentication belum diinisialisasi")
	}
	user, err := firebaseAuth.GetUser(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("gagal mengambil pengguna Firebase: %w", err)
	}
	return user, nil
}

func UploadFileToFirebase(ctx context.Context, data io.Reader, filename string) (string, bool, error) {
	fileBytes, contentType, extension, err := readPhoto(data, filename)
	if err != nil {
		return "", false, err
	}

	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", false, fmt.Errorf("gagal membuat nama file foto: %w", err)
	}
	safeName := fmt.Sprintf("barang_%d_%s%s", time.Now().Unix(), hex.EncodeToString(random), extension)

	if !FirebaseStorageReady() {
		return "", false, errors.New("Firebase Storage belum siap; unggahan belum disimpan")
	}

	downloadToken := make([]byte, 32)
	if _, err := rand.Read(downloadToken); err != nil {
		return "", false, fmt.Errorf("gagal membuat token unduhan foto: %w", err)
	}
	bucket, err := firebaseStorage.Bucket(firebaseBucket)
	if err != nil {
		return "", false, fmt.Errorf("gagal membuka Firebase Storage bucket: %w", err)
	}
	objectName := "barang/" + safeName
	object := bucket.Object(objectName)
	writer := object.NewWriter(ctx)
	writer.ContentType = contentType
	writer.Metadata = map[string]string{
		"firebaseStorageDownloadTokens": hex.EncodeToString(downloadToken),
	}
	if _, err := io.Copy(writer, bytes.NewReader(fileBytes)); err != nil {
		_ = writer.Close()
		return "", false, fmt.Errorf("gagal mengunggah foto ke Firebase Storage: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", false, fmt.Errorf("gagal menyelesaikan unggahan Firebase Storage: %w", err)
	}

	downloadURL := fmt.Sprintf(
		"https://firebasestorage.googleapis.com/v0/b/%s/o/%s?alt=media&token=%s",
		firebaseBucket, url.PathEscape(objectName), hex.EncodeToString(downloadToken),
	)
	return downloadURL, true, nil
}

func imageExtension(contentType string) (string, error) {
	switch strings.ToLower(strings.Split(contentType, ";")[0]) {
	case "image/jpeg":
		return ".jpg", nil
	case "image/png":
		return ".png", nil
	case "image/webp":
		return ".webp", nil
	case "image/gif":
		return ".gif", nil
	default:
		return "", fmt.Errorf("format foto tidak didukung: %s", contentType)
	}
}
