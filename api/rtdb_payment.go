package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/coreapi"
	"github.com/midtrans/midtrans-go/snap"
)

var paymentOrderIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func storedPaymentAmount(value interface{}) (int64, error) {
	amount := numberValue(value)
	if math.IsNaN(amount) || math.IsInf(amount, 0) || math.Trunc(amount) != amount || amount <= 0 || amount > float64(maxDatabaseRupiah) {
		return 0, domainError(http.StatusConflict, "Nominal pembayaran tersimpan tidak valid")
	}
	return int64(amount), nil
}

func paymentIsHistorical(root, invoice map[string]interface{}) bool {
	auction := treeRecord(root, "auctions", rtdbPathID(rtdbNumericID(invoice["id_lelang"])))
	return invoice["legacy_historical"] == true || (auction != nil && auction["legacy_historical"] == true)
}

func reserveRTDBPayment(root map[string]interface{}, claims *RTDBClaims, req PaymentSnapRequest, now time.Time, reservation string) (map[string]interface{}, error) {
	if _, err := transactionProfile(root, claims); err != nil {
		return nil, err
	}
	var invoice map[string]interface{}
	invoiceKey, orderID := "", ""
	amount := req.JumlahTagihan
	if req.IDPembayaran > 0 || req.IDLelang > 0 {
		for key, value := range treeMap(root["invoices"]) {
			candidate := treeMap(value)
			if candidate == nil || (req.IDPembayaran > 0 && rtdbNumericID(candidate["id_pembayaran"]) != req.IDPembayaran) || (req.IDLelang > 0 && rtdbNumericID(candidate["id_lelang"]) != req.IDLelang) {
				continue
			}
			if req.IDPembayaran == 0 && rtdbNumericID(candidate["id_user"]) != claims.ID {
				continue
			}
			if invoice == nil || rtdbNumericID(candidate["id_pembayaran"]) > rtdbNumericID(invoice["id_pembayaran"]) {
				invoiceKey, invoice = key, candidate
			}
		}
		if invoice == nil {
			return nil, domainError(http.StatusNotFound, "Tagihan pembayaran tidak ditemukan")
		}
		if rtdbNumericID(invoice["id_user"]) != claims.ID {
			return nil, domainError(http.StatusForbidden, "Tagihan bukan milik akun ini")
		}
		if paymentIsHistorical(root, invoice) || invoice["payment_review_required"] == true || stringValue(invoice["status"], "") != "Belum Dibayar" {
			return nil, domainError(http.StatusConflict, "Tagihan tidak tersedia untuk pembayaran")
		}
		deadline, err := time.Parse(time.RFC3339, stringValue(invoice["batas_pembayaran"], ""))
		if err != nil || !now.Before(deadline) {
			return nil, domainError(http.StatusConflict, "Batas pembayaran sudah berakhir atau belum ditetapkan")
		}
		amount, err = storedPaymentAmount(invoice["sisa_tagihan"])
		if err != nil {
			return nil, err
		}
		orderID = stringValue(invoice["order_id"], "")
		if orderID == "" {
			orderID = fmt.Sprintf("INV-%d", rtdbNumericID(invoice["id_pembayaran"]))
			invoice["order_id"] = orderID
		}
		if previous := treeRecord(root, "paymentOrders", orderID); previous != nil && previous["status"] == "failed" && previous["owner_uid"] == claims.UID && previous["kind"] == "invoice" {
			attempt := rtdbNumericID(invoice["payment_attempt"]) + 1
			orderID = fmt.Sprintf("INV-%d-%d", rtdbNumericID(invoice["id_pembayaran"]), attempt)
			invoice["order_id"], invoice["payment_attempt"] = orderID, attempt
			invoice["snap_token"], invoice["snap_redirect_url"] = nil, nil
		}
	} else {
		if req.TipePembayaran != "topup" || amount < 100000 || !validPaymentAmount(amount) || !validTopUpRequestID(req.RequestID) {
			return nil, domainError(http.StatusBadRequest, "Top up minimal Rp 100.000 dan memerlukan request ID yang valid")
		}
		hash := sha256.Sum256([]byte(claims.UID + ":" + strings.ToLower(req.RequestID)))
		orderID = "TOPUP-" + hex.EncodeToString(hash[:20])
	}
	if !paymentOrderIDPattern.MatchString(orderID) {
		return nil, domainError(http.StatusConflict, "ID pesanan pembayaran tidak valid")
	}
	orders := treeNode(root, "paymentOrders")
	order := treeMap(orders[orderID])
	if order != nil {
		storedAmount, err := storedPaymentAmount(order["amount"])
		if err != nil || storedAmount != amount || stringValue(order["owner_uid"], "") != claims.UID || stringValue(order["invoice_key"], "") != invoiceKey {
			return nil, domainError(http.StatusConflict, "Request ID sudah digunakan untuk pembayaran lain")
		}
		if stringValue(order["status"], "") != "pending" {
			return nil, domainError(http.StatusConflict, "Pembayaran sudah diproses atau memerlukan pemeriksaan petugas")
		}
		if storedSnapTokenUsable(stringValue(order["snap_token"], "")) {
			return order, nil
		}
		if lease, err := time.Parse(time.RFC3339, stringValue(order["creating_until"], "")); err == nil && now.Before(lease) {
			return nil, domainError(http.StatusConflict, "Transaksi sedang dibuat. Tunggu sebentar sebelum mencoba kembali")
		}
	} else {
		kind := "topup"
		if invoice != nil {
			kind = "invoice"
		}
		order = map[string]interface{}{"order_id": orderID, "owner_uid": claims.UID, "id_user": claims.ID, "amount": amount, "kind": kind, "invoice_key": invoiceKey, "status": "pending", "created_at": now.UTC().Format(time.RFC3339)}
		orders[orderID] = order
		if invoice == nil {
			treeNode(root, "walletTransactions", claims.UID)[orderID] = map[string]interface{}{"id": orderID, "id_transaksi": orderID, "id_user": claims.ID, "owner_uid": claims.UID, "tipe": "topup", "nominal": amount, "status": "pending", "order_id": orderID, "referensi_id": orderID, "created_at": now.UTC().Format(time.RFC3339), "keterangan": "Top up saldo melalui Midtrans"}
			treeNode(root, "walletTransactions", claims.UID, orderID)["request_id"] = req.RequestID
		}
	}
	order["creation_id"] = reservation
	order["creating_until"] = now.Add(2 * time.Minute).UTC().Format(time.RFC3339)
	order["updated_at"] = now.UTC().Format(time.RFC3339)
	if invoice != nil {
		order["id_pembayaran"], order["id_lelang"] = invoice["id_pembayaran"], invoice["id_lelang"]
		order["batas_pembayaran"] = invoice["batas_pembayaran"]
	}
	return order, nil
}

func CreateSnapPaymentRTDB(w http.ResponseWriter, r *http.Request) {
	if !MidtransReady() {
		Error(w, http.StatusServiceUnavailable, "Pembayaran Midtrans belum dikonfigurasi")
		return
	}
	var req PaymentSnapRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format pembayaran tidak valid")
		return
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyiapkan pembayaran")
		return
	}
	reservation := hex.EncodeToString(nonce)
	claims := rtdbClaimsFromRequest(r)
	var order map[string]interface{}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		var err error
		order, err = reserveRTDBPayment(root, claims, req, time.Now(), reservation)
		return err
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	orderID := stringValue(order["order_id"], "")
	if !storedSnapTokenUsable(stringValue(order["snap_token"], "")) {
		amount, _ := storedPaymentAmount(order["amount"])
		snapReq := &snap.Request{TransactionDetails: midtrans.TransactionDetails{OrderID: orderID, GrossAmt: amount}, CustomerDetail: &midtrans.CustomerDetails{FName: claims.Nama, Email: claims.Email}, Items: &[]midtrans.ItemDetails{{ID: orderID, Price: amount, Qty: 1, Name: "Pembayaran Lelang Lerang"}}}
		if deadline, err := time.Parse(time.RFC3339, stringValue(order["batas_pembayaran"], "")); err == nil {
			minutes := int64(time.Until(deadline) / time.Minute)
			if minutes < 1 {
				Error(w, http.StatusConflict, "Batas pembayaran kurang dari satu menit. Hubungi petugas")
				return
			}
			snapReq.Expiry = &snap.ExpiryDetails{StartTime: time.Now().UTC().Format("2006-01-02 15:04:05 -0700"), Unit: "minute", Duration: minutes}
		}
		response, gatewayErr := SnapClient.CreateTransaction(snapReq)
		if gatewayErr != nil || response == nil || response.Token == "" {
			if gatewayErr != nil && (gatewayErr.StatusCode == 401 || gatewayErr.StatusCode == 403) {
				Error(w, 503, "Konfigurasi Midtrans Sandbox ditolak penyedia pembayaran. Hubungi pengelola untuk memperbarui Access Keys.")
				return
			}
			// A timed-out request may already exist at the gateway; retain its order ID for reconciliation.
			Error(w, http.StatusBadGateway, "Midtrans belum dapat menyiapkan pembayaran. Periksa status sebelum mengulang")
			return
		}
		// Complete the durable reservation even if the caller disconnects or changes role.
		persistCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := rtdbTransaction(persistCtx, func(root map[string]interface{}) error {
			current := treeRecord(root, "paymentOrders", orderID)
			if current == nil || stringValue(current["creation_id"], "") != reservation || stringValue(current["owner_uid"], "") != claims.UID {
				return domainError(http.StatusConflict, "Sesi pembuatan pembayaran berubah. Periksa status pembayaran")
			}
			current["snap_token"], current["snap_redirect_url"], current["creating_until"] = response.Token, response.RedirectURL, nil
			current["updated_at"] = rtdbNow()
			if invoiceKey := stringValue(current["invoice_key"], ""); invoiceKey != "" {
				invoice := treeRecord(root, "invoices", invoiceKey)
				if invoice == nil {
					return domainError(http.StatusConflict, "Tagihan pembayaran berubah")
				}
				invoice["snap_token"], invoice["snap_redirect_url"] = response.Token, response.RedirectURL
			} else if transaction := treeRecord(treeNode(root, "walletTransactions"), claims.UID, orderID); transaction != nil {
				transaction["snap_token"], transaction["snap_redirect_url"] = response.Token, response.RedirectURL
			}
			order = current
			return nil
		}); err != nil {
			rtdbJSONError(w, err)
			return
		}
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Transaksi Midtrans siap dilanjutkan", Data: map[string]interface{}{"order_id": orderID, "id_pembayaran": order["id_pembayaran"], "id_lelang": order["id_lelang"], "id_transaksi": orderID, "total_tagihan": order["amount"], "nominal": order["amount"], "snap_token": order["snap_token"], "snap_redirect_url": order["snap_redirect_url"], "client_key": midtransClientKey(), "is_production": midtransProduction()}})
}

func validateRTDBPaymentNotification(notification midtransNotification) (int64, paymentEvent, error) {
	if !paymentOrderIDPattern.MatchString(notification.OrderID) || !strings.EqualFold(notification.Currency, "IDR") {
		return 0, 0, domainError(http.StatusBadRequest, "ID pesanan atau mata uang pembayaran tidak valid")
	}
	minor, err := parseRupiahAmount(notification.GrossAmount)
	if err != nil || minor <= 0 || minor%100 != 0 || !validPaymentAmount(minor/100) {
		return 0, 0, domainError(http.StatusBadRequest, "Nominal notifikasi Midtrans tidak valid")
	}
	event, ok := classifyMidtransEvent(notification.TransactionStatus, notification.FraudStatus)
	if !ok || (event == paymentEventPaid && (notification.StatusCode != "200" || (notification.FraudStatus != "" && notification.FraudStatus != "accept"))) {
		return 0, 0, domainError(http.StatusBadRequest, "Status notifikasi Midtrans tidak valid")
	}
	return minor / 100, event, nil
}

func applyRTDBPaymentNotification(root map[string]interface{}, notification midtransNotification, now time.Time) error {
	amount, event, err := validateRTDBPaymentNotification(notification)
	if err != nil {
		return err
	}
	order := treeRecord(root, "paymentOrders", notification.OrderID)
	if order == nil {
		return domainError(http.StatusNotFound, "Transaksi Midtrans tidak dikenal")
	}
	expected, err := storedPaymentAmount(order["amount"])
	if err != nil || expected != amount {
		return domainError(http.StatusBadRequest, "Nominal notifikasi tidak cocok dengan pembayaran")
	}
	status := stringValue(order["status"], "")
	if status == "paid" && event != paymentEventManualReview {
		return nil
	}
	stamp := now.UTC().Format(time.RFC3339)
	order["gateway_status"], order["updated_at"] = notification.TransactionStatus, stamp
	if event == paymentEventPending {
		return nil
	}
	if event == paymentEventManualReview {
		order["status"], order["review_required"] = "review_required", true
		if key := stringValue(order["invoice_key"], ""); key != "" {
			if invoice := treeRecord(root, "invoices", key); invoice != nil {
				invoice["payment_review_required"] = true
			}
		}
		if uid := stringValue(order["owner_uid"], ""); uid != "" {
			if profile := treeRecord(root, "users", uid); profile != nil {
				profile["financial_review_required"] = true
			}
			if transaction := treeRecord(treeNode(root, "walletTransactions"), uid, notification.OrderID); transaction != nil {
				transaction["payment_review_required"] = true
			}
		}
		return nil
	}
	if status == "review_required" {
		return nil
	}
	if event == paymentEventFailed {
		order["status"] = "failed"
		if stringValue(order["kind"], "") == "topup" {
			uid := stringValue(order["owner_uid"], "")
			if transaction := treeRecord(treeNode(root, "walletTransactions"), uid, notification.OrderID); transaction != nil && transaction["status"] != "sukses" {
				transaction["status"], transaction["updated_at"] = "gagal", stamp
			}
		}
		return nil
	}
	if stringValue(order["kind"], "") == "topup" {
		uid := stringValue(order["owner_uid"], "")
		profile := treeRecord(root, "users", uid)
		transaction := treeRecord(treeNode(root, "walletTransactions"), uid, notification.OrderID)
		if profile == nil || transaction == nil || transaction["tipe"] != "topup" || transaction["owner_uid"] != uid || rtdbNumericID(profile["id_user"]) != rtdbNumericID(order["id_user"]) {
			return domainError(http.StatusConflict, "Pemilik saldo pembayaran tidak ditemukan")
		}
		transactionAmount, amountErr := storedPaymentAmount(transaction["nominal"])
		if amountErr != nil || transactionAmount != amount {
			return domainError(http.StatusConflict, "Nominal top up tersimpan tidak cocok")
		}
		if transaction["status"] != "sukses" {
			balance := numberValue(profile["saldo_wallet"])
			if !validStoredBalance(profile) || balance+numberValue(profile["saldo_hold"])+float64(amount) > float64(maxDatabaseRupiah) {
				return domainError(http.StatusConflict, "Saldo tersimpan tidak valid")
			}
			profile["saldo_wallet"] = balance + float64(amount)
			transaction["status"], transaction["updated_at"] = "sukses", stamp
		}
	} else if stringValue(order["kind"], "") == "invoice" {
		key := stringValue(order["invoice_key"], "")
		invoice := treeRecord(root, "invoices", key)
		if invoice == nil || rtdbNumericID(invoice["id_user"]) != rtdbNumericID(order["id_user"]) {
			return domainError(http.StatusConflict, "Tagihan pembayaran berubah")
		}
		invoiceAmount, amountErr := storedPaymentAmount(invoice["sisa_tagihan"])
		if amountErr != nil || invoiceAmount != amount {
			return domainError(http.StatusBadRequest, "Nominal tagihan pembayaran berubah")
		}
		if invoice["order_id"] != notification.OrderID || (invoice["status"] != "Sudah Dibayar" && (invoice["status"] != "Belum Dibayar" || paymentIsHistorical(root, invoice))) {
			order["status"], order["review_required"], invoice["payment_review_required"] = "review_required", true, true
			if profile := treeRecord(root, "users", stringValue(order["owner_uid"], "")); profile != nil {
				profile["financial_review_required"] = true
			}
			return nil
		}
		if err := applyInvoicePayment(root, key, notification.OrderID, now); err != nil {
			var actionError *transactionError
			if !errors.As(err, &actionError) {
				return err
			}
			order["status"], order["review_required"], invoice["payment_review_required"] = "review_required", true, true
			order["review_reason"] = actionError.message
			if profile := treeRecord(root, "users", stringValue(order["owner_uid"], "")); profile != nil {
				profile["financial_review_required"] = true
			}
			return nil
		}
		invoice["metode_pembayaran"] = "Midtrans - " + strings.ToUpper(notification.PaymentType)
	} else {
		return domainError(http.StatusConflict, "Jenis pembayaran tidak dikenali")
	}
	order["status"], order["paid_at"] = "paid", stamp
	return nil
}

func authoritativeMidtransNotification(orderID string) (midtransNotification, error) {
	if !paymentOrderIDPattern.MatchString(orderID) {
		return midtransNotification{}, domainError(http.StatusBadRequest, "ID pembayaran tidak valid")
	}
	client := coreapi.Client{ServerKey: midtransConfig.serverKey, Env: midtransConfig.environment, HttpClient: SnapClient.HttpClient}
	response, err := client.CheckTransaction(orderID)
	if err != nil || response == nil {
		if err != nil && (err.StatusCode == 401 || err.StatusCode == 403) {
			return midtransNotification{}, domainError(503, "Konfigurasi Midtrans belum diterima penyedia pembayaran. Hubungi pengelola")
		}
		if err != nil && err.StatusCode == http.StatusNotFound {
			return midtransNotification{}, domainError(http.StatusConflict, "Metode pembayaran belum dipilih atau transaksi belum tercatat di Midtrans")
		}
		return midtransNotification{}, domainError(http.StatusBadGateway, "Status pembayaran belum dapat diperiksa ke Midtrans")
	}
	if response.OrderID != orderID {
		return midtransNotification{}, domainError(http.StatusBadGateway, "ID pembayaran dari Midtrans tidak cocok")
	}
	return midtransNotification{OrderID: response.OrderID, StatusCode: response.StatusCode, GrossAmount: response.GrossAmount, Currency: response.Currency, TransactionStatus: response.TransactionStatus, FraudStatus: response.FraudStatus, PaymentType: response.PaymentType}, nil
}

func MidtransWebhookRTDB(w http.ResponseWriter, r *http.Request) {
	if !MidtransReady() {
		Error(w, http.StatusServiceUnavailable, "Webhook Midtrans belum dikonfigurasi")
		return
	}
	defer r.Body.Close()
	var notification midtransNotification
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&notification); err != nil {
		Error(w, http.StatusBadRequest, "Payload webhook tidak valid")
		return
	}
	if err := decoder.Decode(new(interface{})); !errors.Is(err, io.EOF) {
		Error(w, http.StatusBadRequest, "Payload webhook tidak valid")
		return
	}
	if !VerifikasiSignatureMidtrans(notification.OrderID, notification.StatusCode, notification.GrossAmount, notification.SignatureKey) {
		Error(w, http.StatusUnauthorized, "Signature webhook tidak valid")
		return
	}
	if _, _, err := validateRTDBPaymentNotification(notification); err != nil {
		rtdbJSONError(w, err)
		return
	}
	verified, err := authoritativeMidtransNotification(notification.OrderID)
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	if err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return applyRTDBPaymentNotification(root, verified, time.Now())
	}); err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Status pembayaran tersimpan"})
}

func SyncPaymentStatusRTDB(w http.ResponseWriter, r *http.Request) {
	syncPaymentStatus(w, r, false)
}

func syncPaymentStatus(w http.ResponseWriter, r *http.Request, staff bool) {
	if !MidtransReady() {
		Error(w, http.StatusServiceUnavailable, "Pembayaran Midtrans belum dikonfigurasi")
		return
	}
	claims := rtdbClaimsFromRequest(r)
	orderID := r.PathValue("orderID")
	if !paymentOrderIDPattern.MatchString(orderID) {
		Error(w, http.StatusBadRequest, "ID pembayaran tidak valid")
		return
	}
	var order map[string]interface{}
	if err := rtdbGet(r.Context(), "paymentOrders/"+orderID, &order); err != nil {
		rtdbJSONError(w, err)
		return
	}
	if claims == nil || (staff && claims.Role != RoleAdministrator && claims.Role != RolePetugas) || len(order) == 0 || (!staff && order["owner_uid"] != claims.UID) {
		Error(w, http.StatusNotFound, "Pembayaran tidak ditemukan untuk akun ini")
		return
	}
	result, err := reconcileRTDBPayment(r.Context(), orderID, claims.UID)
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, http.StatusOK, Response{Success: true, Message: "Status diperiksa langsung ke Midtrans", Data: result})
}
