package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	firebaseDB "firebase.google.com/go/v4/db"
	"github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"google.golang.org/api/option"
)

func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	_ = godotenv.Load()
	dryRun := flag.Bool("dry-run", false, "validasi sumber dan periksa konflik Firebase tanpa menulis")
	validate := flag.Bool("validate", false, "validasi MySQL saja; tidak menghubungi Firebase")
	credentials := flag.String("credentials", env("FIREBASE_CREDENTIALS", ""), "path service-account Firebase JSON")
	databaseURL := flag.String("database-url", env("FIREBASE_DATABASE_URL", ""), "Firebase Realtime Database URL")
	dsn := flag.String("dsn", mysqlDSN(), "DSN sumber MySQL; default DB_* environment")
	sourceFile := flag.String("source-file", "", "dump SQL asal untuk checksum manifest")
	timezone := flag.String("source-timezone", "Asia/Jakarta", "zona waktu kolom DATETIME sumber; TIMESTAMP dibaca UTC")
	backupDirectory := flag.String("backup-dir", "secrets/migration-backups", "folder privat untuk backup dan manifest")
	legacyIdentities := flag.Bool("legacy-identities", false, "isolasi seluruh akun sumber sebagai legacy; penautan hanya melalui verifikasi email di project baru")
	remapUsers := flag.Bool("remap-user-collisions", false, "pertahankan akun aktif dan remap ID pengguna SQL yang bentrok beserta seluruh relasinya")
	flag.Parse()
	location, err := time.LoadLocation(*timezone)
	if err != nil {
		return fmt.Errorf("zona waktu sumber tidak valid: %w", err)
	}
	config, err := mysql.ParseDSN(*dsn)
	if err != nil {
		return errors.New("DSN MySQL tidak valid")
	}
	config.ParseTime = false
	config.Timeout = 10 * time.Second
	config.ReadTimeout = 30 * time.Second
	database, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		return err
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := database.PingContext(ctx); err != nil {
		return fmt.Errorf("MySQL tidak merespons: %w", err)
	}
	if _, err := database.ExecContext(ctx, "SET SESSION time_zone = '+00:00'"); err != nil {
		return fmt.Errorf("atur sesi MySQL UTC: %w", err)
	}
	source := make(map[string][]record, len(tableSpecs))
	for _, spec := range tableSpecs {
		rows, err := readTable(ctx, database, spec, location)
		if err != nil {
			return fmt.Errorf("%s: %w", spec.name, err)
		}
		source[spec.name] = rows
		log.Printf("%-22s %d row(s)", spec.name, len(rows))
	}
	dataHash, err := checksum(source)
	if err != nil {
		return err
	}
	sourceHash := dataHash
	if *sourceFile != "" {
		bytes, err := os.ReadFile(*sourceFile)
		if err != nil {
			return fmt.Errorf("baca dump asal: %w", err)
		}
		digest := sha256.Sum256(bytes)
		sourceHash = hex.EncodeToString(digest[:])
	}
	var client *firebaseDB.Client
	identities := map[string]string{}
	var root map[string]any
	if !*validate {
		identitySource := source
		if *legacyIdentities {
			identitySource = map[string][]record{}
			log.Print("Identitas sumber diisolasi sebagai legacy; tidak ada akun lama dianggap aktif tanpa penautan terverifikasi.")
		}
		client, identities, err = firebaseClients(ctx, *credentials, *databaseURL, identitySource)
		if err != nil {
			return err
		}
		if err := client.NewRef("").Get(ctx, &root); err != nil {
			return fmt.Errorf("baca tujuan sebelum migrasi: %w", err)
		}
	}
	remapped, mapping, err := remapLegacyUsers(source, root, sourceHash, *remapUsers)
	if err != nil {
		return err
	}
	plan, report, err := buildPlan(remapped, identities, time.Now(), sourceHash)
	if err != nil {
		return err
	}
	report.SourceSHA256 = sourceHash
	report.UserIDMapping = mapping
	report.DataSHA256 = dataHash
	report.SourceTimezone = *timezone
	report.ValidateOnly = *validate
	if *validate {
		log.Printf("Validasi selesai: %d baris, %d akun disimpan sebagai legacy sampai identitas diverifikasi. Tidak ada perubahan Firebase.", report.SourceRows, report.LegacyUsers)
		return nil
	}
	status := inspectPlan(root, plan)
	report.NewNodes, report.ExistingNodes, report.Conflicts = status.Added, status.Existing, status.Conflicts
	log.Printf("Rencana: %d node baru, %d sudah sama, %d konflik; %d lelang historis, %d akun legacy.", status.Added, status.Existing, len(status.Conflicts), report.HistoricalAuctions, report.LegacyUsers)
	if *dryRun {
		if len(status.Conflicts) > 0 {
			return errors.New("dry-run menemukan konflik; tidak ada data ditulis")
		}
		log.Print("Dry-run selesai. Tidak ada perubahan Firebase.")
		return nil
	}
	if err := os.MkdirAll(*backupDirectory, 0700); err != nil {
		return err
	}
	stamp := time.Now().UTC().Format("20060102T150405.000000000Z")
	base := filepath.Join(*backupDirectory, "mysql-to-rtdb-"+stamp)
	if err := writePrivateJSON(base+"-before.json", root); err != nil {
		return fmt.Errorf("backup sebelum migrasi: %w", err)
	}
	report.BackupFile = filepath.Base(base + "-before.json")
	if len(status.Conflicts) > 0 {
		_ = writePrivateJSON(base+"-manifest.json", report)
		return fmt.Errorf("migrasi dibatalkan: %d konflik; data aktif tidak ditimpa. Periksa manifest privat", len(status.Conflicts))
	}
	var committedStatus planStatus
	err = client.NewRef("").Transaction(ctx, func(node firebaseDB.TransactionNode) (interface{}, error) {
		var current map[string]any
		if err := node.Unmarshal(&current); err != nil {
			return nil, err
		}
		if current == nil {
			current = map[string]any{}
		}
		committedStatus = inspectPlan(current, plan)
		if len(committedStatus.Conflicts) > 0 {
			return nil, errors.New("tujuan berubah dan berkonflik; seluruh transaksi migrasi dibatalkan")
		}
		for _, entry := range plan {
			old := lookupPath(current, entry.Path)
			if entry.Counter {
				if numericID(old) >= numericID(entry.Value) {
					continue
				}
			} else if old != nil {
				continue
			}
			setPath(current, strings.Split(entry.Path, "/"), entry.Value)
		}
		metaPath := "migrationMeta/mysqlToRtdb/runs/" + sourceHash
		if lookupPath(current, metaPath) == nil {
			setPath(current, strings.Split(metaPath, "/"), map[string]any{
				"version": 3, "completed_at": time.Now().UTC().Format(time.RFC3339),
				"rows": report.SourceRows, "source_sha256": sourceHash, "data_sha256": dataHash,
				"historical_auctions": report.HistoricalAuctions, "legacy_users": report.LegacyUsers,
				"source_timezone": *timezone,
				"user_id_mapping": mapping,
			})
		}
		return current, nil
	})
	if err != nil {
		report.Conflicts = committedStatus.Conflicts
		_ = writePrivateJSON(base+"-manifest.json", report)
		return fmt.Errorf("transaksi migrasi gagal; tidak ada penimpaan data aktif: %w", err)
	}
	var actual map[string]any
	if err := client.NewRef("").Get(ctx, &actual); err != nil {
		return fmt.Errorf("migrasi tersimpan tetapi verifikasi baca ulang gagal: %w", err)
	}
	verified := inspectPlan(actual, plan)
	report.Verified = verified.Added == 0 && len(verified.Conflicts) == 0
	report.NewNodes, report.ExistingNodes = committedStatus.Added, committedStatus.Existing
	if err := writePrivateJSON(base+"-manifest.json", report); err != nil {
		return fmt.Errorf("simpan manifest: %w", err)
	}
	if !report.Verified {
		return errors.New("verifikasi baca ulang menemukan data tidak sesuai; periksa manifest dan backup privat")
	}
	log.Printf("Migrasi terverifikasi: %d baris sumber; %d node ditambahkan, %d tetap sama. Tidak ada saldo dihitung ulang atau transaksi historis diproses. Manifest: %s", report.SourceRows, report.NewNodes, report.ExistingNodes, base+"-manifest.json")
	return nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func mysqlDSN() string {
	cfg := mysql.NewConfig()
	cfg.User, cfg.Passwd = env("DB_USER", "root"), os.Getenv("DB_PASS")
	cfg.Net, cfg.Addr = "tcp", env("DB_HOST", "127.0.0.1")+":"+env("DB_PORT", "3306")
	cfg.DBName = env("DB_NAME", "db_lelang")
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	return cfg.FormatDSN()
}

func firebaseClients(ctx context.Context, credentials, databaseURL string, source map[string][]record) (*firebaseDB.Client, map[string]string, error) {
	if strings.TrimSpace(credentials) == "" || strings.TrimSpace(databaseURL) == "" {
		return nil, nil, errors.New("FIREBASE_CREDENTIALS dan FIREBASE_DATABASE_URL wajib diisi")
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{DatabaseURL: databaseURL}, option.WithCredentialsFile(credentials))
	if err != nil {
		return nil, nil, err
	}
	dbClient, err := app.DatabaseWithURL(ctx, databaseURL)
	if err != nil {
		return nil, nil, err
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, nil, err
	}
	identifiers := []auth.UserIdentifier{}
	seen := map[string]bool{}
	for _, table := range []string{"tb_masyarakat", "tb_petugas"} {
		for _, row := range source[table] {
			uid := valueString(row.Value["firebase_uid"])
			if uid == "" {
				uid = valueString(row.Value["uid"])
			}
			if uid != "" && !seen[uid] {
				identifiers = append(identifiers, auth.UIDIdentifier{UID: uid})
				seen[uid] = true
			}
		}
	}
	identities := map[string]string{}
	for start := 0; start < len(identifiers); start += 100 {
		end := start + 100
		if end > len(identifiers) {
			end = len(identifiers)
		}
		lookupCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		users, err := authClient.GetUsers(lookupCtx, identifiers[start:end])
		cancel()
		if err != nil {
			return nil, nil, fmt.Errorf("verifikasi UID di Firebase Auth gagal; tidak menganggap akun lama sebagai aktif: %w", err)
		}
		for _, user := range users.Users {
			identities[user.UID] = strings.ToLower(user.Email)
		}
	}
	return dbClient, identities, nil
}

func checksum(value any) (string, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:]), nil
}

func writePrivateJSON(path string, value any) error {
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes, '\n'), 0600)
}
