package api

import (
	"crypto/sha512"
	"encoding/hex"
	"testing"

	"github.com/midtrans/midtrans-go"
)

func TestLoadMidtransSettingsDefaultsToSandbox(t *testing.T) {
	settings, err := loadMidtransSettings("SB-Mid-server-test", "SB-Mid-client-test", "")
	if err != nil {
		t.Fatal(err)
	}
	if settings.environment != midtrans.Sandbox || settings.production || !settings.ready {
		t.Fatalf("unexpected sandbox settings: %#v", settings)
	}

	empty, err := loadMidtransSettings("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if empty.environment != midtrans.Sandbox || empty.ready {
		t.Fatalf("empty settings must leave payments disabled in sandbox: %#v", empty)
	}
}

func TestLoadMidtransSettingsRejectsEnvironmentMismatch(t *testing.T) {
	if _, err := loadMidtransSettings("SB-Mid-server-test", "SB-Mid-client-test", "true"); err == nil {
		t.Fatal("expected sandbox keys to be rejected for production")
	}
	if _, err := loadMidtransSettings("Mid-server-test", "Mid-client-test", "maybe"); err == nil {
		t.Fatal("expected invalid production flag to be rejected")
	}
	if _, err := loadMidtransSettings("SB-Mid-server-test", "", "false"); err == nil {
		t.Fatal("expected partial Midtrans configuration to be rejected")
	}
}

func TestMidtransUnprefixedKeysStayUnchangedInSandbox(t *testing.T) {
	for _, flag := range []string{"", "false"} {
		settings, err := loadMidtransSettings("Mid-server-fixture", "Mid-client-fixture", flag)
		if err != nil {
			t.Fatal(err)
		}
		if settings.environment != midtrans.Sandbox || settings.production || !settings.ready {
			t.Fatal("unprefixed keys must remain in sandbox unless production is explicitly enabled")
		}
		if settings.serverKey != "Mid-server-fixture" || settings.clientKey != "Mid-client-fixture" {
			t.Fatal("dashboard keys must not be rewritten")
		}
	}
	settings, err := loadMidtransSettings("Mid-server-fixture", "Mid-client-fixture", "true")
	if err != nil || settings.environment != midtrans.Production || !settings.production {
		t.Fatal("explicit production flag must select production")
	}
}

func TestInitMidtransDisablesPaymentsOnInvalidConfiguration(t *testing.T) {
	previous := midtransConfig
	t.Cleanup(func() { midtransConfig = previous })
	t.Setenv("MIDTRANS_SERVER_KEY", "SB-Mid-server-test")
	t.Setenv("MIDTRANS_CLIENT_KEY", "Mid-client-test")
	t.Setenv("MIDTRANS_IS_PRODUCTION", "true")

	if err := InitMidtrans(); err == nil {
		t.Fatal("expected mismatched Midtrans credentials to be rejected")
	}
	if MidtransReady() || midtransConfig.environment != midtrans.Sandbox {
		t.Fatal("invalid configuration must disable payments and remain in sandbox")
	}
}

func TestMidtransSandboxDoesNotLogAuthorizationHeaders(t *testing.T) {
	previousConfig, previousClient := midtransConfig, SnapClient
	t.Cleanup(func() { midtransConfig, SnapClient = previousConfig, previousClient })
	t.Setenv("MIDTRANS_SERVER_KEY", "SB-Mid-server-fixture")
	t.Setenv("MIDTRANS_CLIENT_KEY", "SB-Mid-client-fixture")
	t.Setenv("MIDTRANS_IS_PRODUCTION", "false")
	if err := InitMidtrans(); err != nil {
		t.Fatal(err)
	}
	client, ok := SnapClient.HttpClient.(*midtrans.HttpClientImplementation)
	if !ok {
		t.Fatal("unexpected Midtrans HTTP client")
	}
	logger, ok := client.Logger.(*midtrans.LoggerImplementation)
	if !ok || logger.LogLevel != midtrans.NoLogging {
		t.Fatal("Sandbox could print payment credentials")
	}
}

func TestMidtransSignatureRejectsTamperedAmounts(t *testing.T) {
	previous := midtransConfig
	midtransConfig = midtransSettings{serverKey: "server-key-for-test", clientKey: "client-key", ready: true}
	t.Cleanup(func() { midtransConfig = previous })

	orderID, statusCode, grossAmount := "TEST-ORDER-1", "200", "100000.00"
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + midtransConfig.serverKey))
	signature := hex.EncodeToString(sum[:])
	if !VerifikasiSignatureMidtrans(orderID, statusCode, grossAmount, signature) {
		t.Fatal("valid Midtrans signature was rejected")
	}
	if VerifikasiSignatureMidtrans(orderID, statusCode, "100000.01", signature) {
		t.Fatal("invalid Midtrans signature was accepted")
	}
}

func TestMidtransEventClassification(t *testing.T) {
	for _, tc := range []struct {
		status, fraud string
		want          paymentEvent
		known         bool
	}{
		{"settlement", "", paymentEventPaid, true},
		{"capture", "accept", paymentEventPaid, true},
		{"capture", "deny", paymentEventFailed, true},
		{"capture", "challenge", paymentEventPending, true},
		{"capture", "", paymentEventPending, true},
		{"capture", "unrecognized", paymentEventPending, false},
		{"pending", "", paymentEventPending, true},
		{"authorize", "", paymentEventPending, true},
		{"deny", "", paymentEventFailed, true},
		{"cancel", "", paymentEventFailed, true},
		{"expire", "", paymentEventFailed, true},
		{"failure", "", paymentEventFailed, true},
		{"refund", "", paymentEventManualReview, true},
		{"partial_refund", "", paymentEventManualReview, true},
		{"chargeback", "", paymentEventManualReview, true},
		{"partial_chargeback", "", paymentEventManualReview, true},
		{"unrecognized", "", paymentEventPending, false},
	} {
		t.Run(tc.status+"/"+tc.fraud, func(t *testing.T) {
			got, known := classifyMidtransEvent(tc.status, tc.fraud)
			if got != tc.want || known != tc.known {
				t.Fatalf("classification = %v, %v; want %v, %v", got, known, tc.want, tc.known)
			}
		})
	}
}

func TestStoredSnapTokenRejectsKnownDemoValues(t *testing.T) {
	for _, token := range []string{"", "snap-token-demo-99104", "your-placeholder-token", "SB-Mid-xxxx"} {
		if storedSnapTokenUsable(token) {
			t.Fatalf("demo/placeholder token should not be reused: %q", token)
		}
	}
	if !storedSnapTokenUsable("e8c7e4b4-fb2d-4e50-a9b2-45c4e64f8412") {
		t.Fatal("opaque Snap token should be reusable")
	}
}

func TestParseRupiahAmountUsesExactDecimal(t *testing.T) {
	for input, want := range map[string]int64{
		"100000":    10000000,
		"100000.00": 10000000,
		"0.01":      1,
		"00020.50":  2050,
	} {
		got, err := parseRupiahAmount(input)
		if err != nil || got != want {
			t.Fatalf("parseRupiahAmount(%q) = %d, %v; want %d", input, got, err, want)
		}
	}
	if validPaymentAmount(9_999_999_999_999) == false || validPaymentAmount(10_000_000_000_000) {
		t.Fatal("payment amount must stay within the supported rupiah range")
	}
	if _, err := parseRupiahAmount("1.001"); err == nil {
		t.Fatal("more than two decimal places must be rejected")
	}
}
