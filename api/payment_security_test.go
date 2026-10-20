package api

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
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

func TestMidtransSignatureAndStatus(t *testing.T) {
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
	if StatusLunasMidtrans("capture", "") || StatusLunasMidtrans("capture", "challenge") {
		t.Fatal("capture must not be treated as paid unless fraud status is accept")
	}
	if !StatusLunasMidtrans("capture", "accept") || !StatusLunasMidtrans("settlement", "") {
		t.Fatal("valid paid Midtrans statuses were rejected")
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
	if _, err := rupiahAmountToMidtrans("100.01"); err == nil {
		t.Fatal("fractional rupiah must not be sent to Midtrans")
	}
	if validPaymentAmount(9_999_999_999_999) == false || validPaymentAmount(10_000_000_000_000) {
		t.Fatal("payment amount must fit MySQL DECIMAL(15,2)")
	}
	if _, err := parseRupiahAmount("1.001"); err == nil {
		t.Fatal("more than two decimal places must be rejected")
	}
}

func TestJWTSecretValidationAndInvalidToken(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	if ValidateJWTSecret() == nil {
		t.Fatal("empty JWT_SECRET should be rejected")
	}
	t.Setenv("JWT_SECRET", "short-test-key")
	if ValidateJWTSecret() == nil {
		t.Fatal("weak JWT_SECRET should be rejected")
	}
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	if err := ValidateJWTSecret(); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseToken("not-a-jwt"); err == nil {
		t.Fatal("invalid internal JWT should be rejected")
	}

	expiredToken := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		},
	})
	tokenString, err := expiredToken.SignedString([]byte(strings.Repeat("x", 32)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseToken(tokenString); err == nil {
		t.Fatal("expired internal JWT should be rejected")
	}
}

func TestMidtransWebhookRejectsUnknownOrderAndAmountMismatch(t *testing.T) {
	previousConfig, previousDB := midtransConfig, DB
	midtransConfig = midtransSettings{serverKey: "webhook-test-key", clientKey: "client-key", ready: true}
	t.Cleanup(func() {
		midtransConfig = previousConfig
		DB = previousDB
	})

	t.Run("unknown order", func(t *testing.T) {
		mockDB, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer mockDB.Close()
		DB = mockDB
		mock.ExpectBegin()
		expectWebhookInvoiceQuery(mock, "UNKNOWN-1").
			WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status"}))
		expectWebhookWalletQuery(mock, "UNKNOWN-1").
			WillReturnRows(sqlmock.NewRows([]string{"id_transaksi", "id_user", "nominal", "status"}))
		mock.ExpectRollback()

		response := callWebhook(t, "UNKNOWN-1", "500.00", "pending", "")
		if response.Code != http.StatusNotFound {
			t.Fatalf("status = %d; want 404", response.Code)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("invalid signature", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPost, "/api/midtrans/webhook", strings.NewReader(`{
			"order_id":"INV-BAD-SIGNATURE","status_code":"200","gross_amount":"500.00",
			"currency":"IDR","signature_key":"invalid","transaction_status":"settlement"
		}`))
		response := httptest.NewRecorder()
		MidtransWebhook(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d; want 401", response.Code)
		}
	})

	t.Run("currency mismatch", func(t *testing.T) {
		orderID, grossAmount := "INV-EUR", "500.00"
		sum := sha512.Sum512([]byte(orderID + "200" + grossAmount + midtransConfig.serverKey))
		payload, err := json.Marshal(midtransNotification{
			OrderID:           orderID,
			StatusCode:        "200",
			GrossAmount:       grossAmount,
			Currency:          "USD",
			SignatureKey:      hex.EncodeToString(sum[:]),
			TransactionStatus: "settlement",
		})
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		MidtransWebhook(response, httptest.NewRequest(http.MethodPost, "/api/midtrans/webhook", bytes.NewReader(payload)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d; want 400", response.Code)
		}
	})

	t.Run("amount mismatch", func(t *testing.T) {
		mockDB, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer mockDB.Close()
		DB = mockDB
		mock.ExpectBegin()
		expectWebhookInvoiceQuery(mock, "INV-1").
			WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status"}).
				AddRow(1, 2, 3, 4, "500.00", "Belum Dibayar"))
		mock.ExpectRollback()

		response := callWebhook(t, "INV-1", "500.01", "settlement", "")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d; want 400", response.Code)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestPendingWebhookDoesNotCreditTopUp(t *testing.T) {
	previousConfig, previousDB := midtransConfig, DB
	midtransConfig = midtransSettings{serverKey: "webhook-test-key", clientKey: "client-key", ready: true}
	mockDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	DB = mockDB
	t.Cleanup(func() {
		midtransConfig = previousConfig
		DB = previousDB
		_ = mockDB.Close()
	})

	mock.ExpectBegin()
	expectWebhookInvoiceQuery(mock, "TOPUP-T1-abc").
		WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status"}))
	expectWebhookWalletQuery(mock, "TOPUP-T1-abc").
		WillReturnRows(sqlmock.NewRows([]string{"id_transaksi", "id_user", "nominal", "status"}).
			AddRow("T1-abc", 7, "100000.00", "pending"))
	mock.ExpectCommit()

	response := callWebhook(t, "TOPUP-T1-abc", "100000.00", "pending", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", response.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInvoiceSettlementIsAtomicAndIdempotent(t *testing.T) {
	previousConfig, previousDB := midtransConfig, DB
	midtransConfig = midtransSettings{serverKey: "webhook-test-key", clientKey: "client-key", ready: true}
	t.Cleanup(func() {
		midtransConfig = previousConfig
		DB = previousDB
	})

	for _, paymentStatus := range []string{"Belum Dibayar", "Sudah Dibayar"} {
		t.Run(paymentStatus, func(t *testing.T) {
			mockDB, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer mockDB.Close()
			DB = mockDB
			mock.ExpectBegin()
			expectWebhookInvoiceQuery(mock, "INV-SETTLE").
				WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status"}).
					AddRow(31, 12, 19, 7, "250000.00", paymentStatus))

			if paymentStatus == "Belum Dibayar" {
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE tb_pembayaran SET status = 'Sudah Dibayar', metode_pembayaran = ?, tgl_pembayaran = NOW()
		WHERE id_pembayaran = ? AND status IN ('Belum Dibayar', 'Kadaluarsa')`)).
					WithArgs("Midtrans - BANK_TRANSFER", 31).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery(regexp.QuoteMeta("SELECT uang_jaminan FROM tb_lelang WHERE id_lelang = ?")).
					WithArgs(12).WillReturnRows(sqlmock.NewRows([]string{"uang_jaminan"}).AddRow("50000.00"))
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE tb_masyarakat SET saldo_hold = GREATEST(0, saldo_hold - ?) WHERE id_user = ?`)).
					WithArgs("50000.00", 7).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM tb_pengiriman WHERE id_pembayaran = ?")).
					WithArgs(31).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
				mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO tb_pengiriman (
			id_fulfillment, id_pembayaran, id_lelang, id_barang, id_user_pembeli,
			status, tracking_history, tgl_update
		) VALUES (?, ?, ?, ?, ?, 'menunggu_alamat', ?, NOW())`)).
					WithArgs(sqlmock.AnyArg(), 31, 12, 19, 7, sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
		VALUES (?, ?, 'Pembayaran Berhasil', 'Pelunasan lelang Anda berhasil diverifikasi. Silakan lengkapi alamat pengiriman.', 'info', 0, 'fulfillment')`)).
					WithArgs(sqlmock.AnyArg(), 7).WillReturnResult(sqlmock.NewResult(1, 1))
			}
			mock.ExpectCommit()

			response := callWebhook(t, "INV-SETTLE", "250000.00", "settlement", "")
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d; want 200; body: %s", response.Code, response.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTopUpWebhookCreditsOnlyOnce(t *testing.T) {
	previousConfig, previousDB := midtransConfig, DB
	midtransConfig = midtransSettings{serverKey: "webhook-test-key", clientKey: "client-key", ready: true}
	t.Cleanup(func() {
		midtransConfig = previousConfig
		DB = previousDB
	})

	for _, status := range []string{"pending", "sukses"} {
		t.Run(status, func(t *testing.T) {
			mockDB, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer mockDB.Close()
			DB = mockDB
			mock.ExpectBegin()
			expectWebhookInvoiceQuery(mock, "TOPUP-T2-abc").
				WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status"}))
			expectWebhookWalletQuery(mock, "TOPUP-T2-abc").
				WillReturnRows(sqlmock.NewRows([]string{"id_transaksi", "id_user", "nominal", "status"}).
					AddRow("T2-abc", 7, "100000.00", status))
			if status == "pending" {
				mock.ExpectQuery(regexp.QuoteMeta("SELECT nominal FROM tb_transaksi_wallet WHERE id_transaksi = ?")).
					WithArgs("T2-abc").WillReturnRows(sqlmock.NewRows([]string{"nominal"}).AddRow("100000.00"))
				mock.ExpectExec(regexp.QuoteMeta("UPDATE tb_masyarakat SET saldo_wallet = saldo_wallet + ? WHERE id_user = ?")).
					WithArgs("100000.00", 7).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec(regexp.QuoteMeta("UPDATE tb_transaksi_wallet SET status = 'sukses' WHERE id_transaksi = ? AND status IN ('pending', 'gagal')")).
					WithArgs("T2-abc").WillReturnResult(sqlmock.NewResult(0, 1))
			}
			mock.ExpectCommit()

			response := callWebhook(t, "TOPUP-T2-abc", "100000.00", "settlement", "")
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d; want 200", response.Code)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCreateSnapPaymentRejectsInvoiceOwnedByAnotherUser(t *testing.T) {
	previousDB, previousConfig := DB, midtransConfig
	defer func() {
		DB = previousDB
		midtransConfig = previousConfig
	}()
	midtransConfig = midtransSettings{serverKey: "SB-Mid-server-test", clientKey: "SB-Mid-client-test", ready: true}
	mockDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer mockDB.Close()
	DB = mockDB

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT p\.id_pembayaran, p\.order_id.*FROM tb_pembayaran p`).
		WithArgs(9).
		WillReturnRows(sqlmock.NewRows([]string{"id_pembayaran", "order_id", "id_lelang", "id_barang", "id_user", "sisa_tagihan", "status", "nama_barang", "snap_token", "snap_redirect_url"}).
			AddRow(1, "INV-1", 2, 3, 10, "500.00", "Belum Dibayar", "Item", "", ""))
	mock.ExpectRollback()

	request := httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap", strings.NewReader(`{"id_pembayaran":9}`))
	request = request.WithContext(context.WithValue(request.Context(), UserKey, &Claims{ID: 9}))
	response := httptest.NewRecorder()
	CreateSnapPayment(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d; want 403", response.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateSnapPaymentReusesPendingTopUp(t *testing.T) {
	previousDB, previousConfig := DB, midtransConfig
	defer func() {
		DB = previousDB
		midtransConfig = previousConfig
	}()
	midtransConfig = midtransSettings{serverKey: "SB-Mid-server-test", clientKey: "SB-Mid-client-test", ready: true}
	mockDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer mockDB.Close()
	DB = mockDB

	requestID := "123e4567-e89b-42d3-a456-426614174000"
	transactionID := "T7-" + requestID
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id_user, nominal, status, IFNULL(snap_token,'')
			FROM tb_transaksi_wallet WHERE id_transaksi = ? FOR UPDATE`)).
		WithArgs(transactionID).
		WillReturnRows(sqlmock.NewRows([]string{"id_user", "nominal", "status", "snap_token"}).
			AddRow(7, "100000.00", "pending", "existing-snap-token"))
	mock.ExpectCommit()

	request := httptest.NewRequest(http.MethodPost, "/api/pembayaran/snap",
		strings.NewReader(`{"tipe_pembayaran":"topup","jumlah_tagihan":100000,"request_id":"`+requestID+`"}`))
	request = request.WithContext(context.WithValue(request.Context(), UserKey, &Claims{ID: 7, Nama: "Test User"}))
	response := httptest.NewRecorder()
	CreateSnapPayment(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200; body: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	var body struct {
		Data struct {
			OrderID   string `json:"order_id"`
			SnapToken string `json:"snap_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.OrderID != "TOPUP-"+transactionID || body.Data.SnapToken != "existing-snap-token" {
		t.Fatalf("retry did not reuse the existing pending transaction: %#v", body.Data)
	}
}

func expectWebhookInvoiceQuery(mock sqlmock.Sqlmock, orderID string) *sqlmock.ExpectedQuery {
	return mock.ExpectQuery(regexp.QuoteMeta(`SELECT id_pembayaran, id_lelang, id_barang, id_user, sisa_tagihan, status
		FROM tb_pembayaran WHERE order_id = ? FOR UPDATE`)).WithArgs(orderID)
}

func expectWebhookWalletQuery(mock sqlmock.Sqlmock, orderID string) *sqlmock.ExpectedQuery {
	return mock.ExpectQuery(regexp.QuoteMeta(`SELECT id_transaksi, id_user, nominal, status
			FROM tb_transaksi_wallet WHERE referensi_id = ? AND tipe = 'topup' FOR UPDATE`)).WithArgs(orderID)
}

func callWebhook(t *testing.T, orderID, grossAmount, transactionStatus, fraudStatus string) *httptest.ResponseRecorder {
	t.Helper()
	sum := sha512.Sum512([]byte(orderID + "200" + grossAmount + midtransConfig.serverKey))
	payload, err := json.Marshal(midtransNotification{
		OrderID:           orderID,
		StatusCode:        "200",
		GrossAmount:       grossAmount,
		Currency:          "IDR",
		SignatureKey:      hex.EncodeToString(sum[:]),
		TransactionStatus: transactionStatus,
		FraudStatus:       fraudStatus,
		PaymentType:       "bank_transfer",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/midtrans/webhook", bytes.NewReader(payload))
	response := httptest.NewRecorder()
	MidtransWebhook(response, request)
	return response
}
