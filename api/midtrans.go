package api

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"strings"

	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/snap"
)

var (
	SnapClient     snap.Client
	midtransConfig midtransSettings
)

type midtransSettings struct {
	serverKey   string
	clientKey   string
	environment midtrans.EnvironmentType
	production  bool
	ready       bool
}

func loadMidtransSettings(serverKey, clientKey, productionValue string) (midtransSettings, error) {
	settings := midtransSettings{
		serverKey:   strings.TrimSpace(serverKey),
		clientKey:   strings.TrimSpace(clientKey),
		environment: midtrans.Sandbox,
		production:  false,
	}

	if strings.TrimSpace(productionValue) != "" {
		switch strings.ToLower(strings.TrimSpace(productionValue)) {
		case "true":
			settings.production = true
			settings.environment = midtrans.Production
		case "false":
			settings.production = false
			settings.environment = midtrans.Sandbox
		default:
			return midtransSettings{}, errors.New("MIDTRANS_IS_PRODUCTION harus bernilai true atau false")
		}
	}

	if settings.serverKey == "" && settings.clientKey == "" {
		return settings, nil
	}
	if settings.serverKey == "" || settings.clientKey == "" {
		return midtransSettings{}, errors.New("MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY harus dikonfigurasi bersama")
	}
	if strings.Contains(strings.ToLower(settings.serverKey), "xxxx") ||
		strings.Contains(strings.ToLower(settings.clientKey), "xxxx") {
		return settings, nil
	}

	// Valid Sandbox keys can also start with Mid-server-; only the explicit flag selects production.
	if settings.production {
		if strings.HasPrefix(settings.serverKey, "SB-") || strings.HasPrefix(settings.clientKey, "SB-") {
			return midtransSettings{}, errors.New("kunci sandbox tidak boleh digunakan pada mode produksi")
		}
	}

	settings.ready = true
	return settings, nil
}

func InitMidtrans() error {
	settings, err := loadMidtransSettings(
		os.Getenv("MIDTRANS_SERVER_KEY"),
		os.Getenv("MIDTRANS_CLIENT_KEY"),
		os.Getenv("MIDTRANS_IS_PRODUCTION"),
	)
	if err != nil {
		midtransConfig = midtransSettings{environment: midtrans.Sandbox}
		SnapClient.New("", midtrans.Sandbox)
		return err
	}

	midtransConfig = settings
	SnapClient.New(settings.serverKey, settings.environment)
	// The SDK enables debug logging in Sandbox, including the Basic Authorization header.
	client := midtrans.GetHttpClient(settings.environment)
	client.Logger = &midtrans.LoggerImplementation{LogLevel: midtrans.NoLogging}
	SnapClient.HttpClient = client
	if !MidtransReady() {
		log.Println("Midtrans belum dikonfigurasi lengkap; endpoint pembayaran dinonaktifkan")
		return nil
	}

	environmentName := "sandbox"
	if settings.production {
		environmentName = "production"
	}
	log.Printf("Midtrans dikonfigurasi; environment: %s. Validitas kunci diperiksa saat menghubungi gateway", environmentName)
	return nil
}

func MidtransReady() bool {
	return midtransConfig.ready
}

func storedSnapTokenUsable(token string) bool {
	normalized := strings.ToLower(strings.TrimSpace(token))
	return normalized != "" &&
		!strings.Contains(normalized, "demo") &&
		!strings.Contains(normalized, "placeholder") &&
		!strings.Contains(normalized, "xxxx")
}

func VerifikasiSignatureMidtrans(orderID, statusCode, grossAmount, signature string) bool {
	if !MidtransReady() || orderID == "" || statusCode == "" || grossAmount == "" {
		return false
	}
	provided, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + midtransConfig.serverKey))
	return hmac.Equal(sum[:], provided)
}

func midtransClientKey() string {
	return midtransConfig.clientKey
}

func midtransProduction() bool {
	return midtransConfig.production
}

func MidtransEnvironment() string {
	if midtransConfig.production {
		return "production"
	}
	return "sandbox"
}
