package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/midtrans/midtrans-go"
	"github.com/midtrans/midtrans-go/snap"
)

var paymentRequestIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func validTopUpRequestID(requestID string) bool {
	return paymentRequestIDPattern.MatchString(requestID)
}

// CreateSnapPayment - Membuat transaksi pembayaran Midtrans Snap dan menghasilkan data QRIS serta Virtual Account
func CreateSnapPayment(w http.ResponseWriter, r *http.Request) {
	if !MidtransReady() {
		Error(w, http.StatusServiceUnavailable, "Pembayaran Midtrans belum dikonfigurasi")
		return
	}
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	var req PaymentSnapRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid: "+err.Error())
		return
	}

	// Legacy SQL handler retained for compatibility; production routes use the RTDB handler.
	if req.IDPembayaran > 0 || req.IDLelang > 0 {
		tx, err := DB.BeginTx(r.Context(), nil)
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memulai pembayaran")
			return
		}
		defer tx.Rollback()

		var idPembayaran, idLelang, idBarang, idUser int
		var orderID, namaBarang, statusBayar, sisaTagihan, snapToken, redirectURL string
		if req.IDPembayaran > 0 {
			err = tx.QueryRowContext(r.Context(), `
				SELECT p.id_pembayaran, p.order_id, p.id_lelang, p.id_barang, p.id_user,
				       p.sisa_tagihan, p.status, b.nama_barang, IFNULL(p.snap_token,''), IFNULL(p.snap_redirect_url,'')
				FROM tb_pembayaran p
				JOIN tb_barang b ON b.id_barang = p.id_barang
				WHERE p.id_pembayaran = ? FOR UPDATE`, req.IDPembayaran,
			).Scan(&idPembayaran, &orderID, &idLelang, &idBarang, &idUser, &sisaTagihan,
				&statusBayar, &namaBarang, &snapToken, &redirectURL)
		} else {
			err = tx.QueryRowContext(r.Context(), `
				SELECT p.id_pembayaran, p.order_id, p.id_lelang, p.id_barang, p.id_user,
				       p.sisa_tagihan, p.status, b.nama_barang, IFNULL(p.snap_token,''), IFNULL(p.snap_redirect_url,'')
				FROM tb_pembayaran p
				JOIN tb_barang b ON b.id_barang = p.id_barang
				WHERE p.id_lelang = ? AND p.id_user = ?
				ORDER BY p.id_pembayaran DESC LIMIT 1 FOR UPDATE`, req.IDLelang, claims.ID,
			).Scan(&idPembayaran, &orderID, &idLelang, &idBarang, &idUser, &sisaTagihan,
				&statusBayar, &namaBarang, &snapToken, &redirectURL)
		}
		if err == sql.ErrNoRows {
			Error(w, http.StatusNotFound, "Data tagihan pembayaran lelang tidak ditemukan")
			return
		}
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal query tagihan: "+err.Error())
			return
		}

		if idUser != claims.ID {
			Error(w, http.StatusForbidden, "Tagihan bukan milik pengguna yang sedang login")
			return
		}
		if statusBayar == "Sudah Dibayar" {
			Error(w, http.StatusConflict, "Tagihan ini sudah dibayar")
			return
		}
		if statusBayar != "Belum Dibayar" {
			Error(w, http.StatusConflict, "Tagihan tidak tersedia untuk pembayaran")
			return
		}
		if !storedSnapTokenUsable(snapToken) {
			snapToken, redirectURL = "", ""
		}

		amount, err := rupiahAmountToMidtrans(sisaTagihan)
		if err != nil || !validPaymentAmount(amount) {
			Error(w, http.StatusInternalServerError, "Nominal tagihan tersimpan tidak valid")
			return
		}
		if snapToken == "" {
			snapReq := &snap.Request{
				TransactionDetails: midtrans.TransactionDetails{
					OrderID:  orderID,
					GrossAmt: amount,
				},
				CustomerDetail: &midtrans.CustomerDetails{
					FName: claims.Nama,
				},
				Items: &[]midtrans.ItemDetails{
					{
						ID:    fmt.Sprintf("LELANG-%d", idLelang),
						Price: amount,
						Qty:   1,
						Name:  fmt.Sprintf("Pelunasan Lot %s", namaBarang),
					},
				},
			}
			snapResp, errSnap := SnapClient.CreateTransaction(snapReq)
			if errSnap != nil || snapResp == nil || snapResp.Token == "" {
				Error(w, http.StatusBadGateway, "Midtrans gagal membuat transaksi pembayaran")
				return
			}
			snapToken, redirectURL = snapResp.Token, snapResp.RedirectURL
			if _, err := tx.ExecContext(r.Context(), `
				UPDATE tb_pembayaran SET snap_token = ?, snap_redirect_url = ?
				WHERE id_pembayaran = ? AND status = 'Belum Dibayar'`,
				snapToken, redirectURL, idPembayaran,
			); err != nil {
				Error(w, http.StatusInternalServerError, "Gagal menyimpan transaksi pembayaran")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			Error(w, http.StatusInternalServerError, "Gagal menyimpan transaksi pembayaran")
			return
		}

		JSON(w, http.StatusOK, Response{
			Success: true,
			Message: "Transaksi Midtrans Snap siap dilanjutkan",
			Data: map[string]any{
				"order_id":          orderID,
				"id_pembayaran":     idPembayaran,
				"id_lelang":         idLelang,
				"nama_barang":       namaBarang,
				"total_tagihan":     amount,
				"snap_token":        snapToken,
				"snap_redirect_url": redirectURL,
				"client_key":        midtransClientKey(),
				"is_production":     midtransProduction(),
			},
		})
		return
	}

	// Top-up: nominal dipilih pengguna, tetapi order dibuat idempotent dan divalidasi.
	if req.TipePembayaran == "topup" || req.JumlahTagihan > 0 {
		if req.JumlahTagihan < 100000 || !validPaymentAmount(req.JumlahTagihan) {
			Error(w, http.StatusBadRequest, "Nominal top up harus minimal Rp 100.000 dan berada dalam batas yang didukung")
			return
		}
		if !validTopUpRequestID(req.RequestID) {
			Error(w, http.StatusBadRequest, "Request ID top up tidak valid")
			return
		}

		trxID := fmt.Sprintf("T%d-%s", claims.ID, req.RequestID)
		topupOrderID := "TOPUP-" + trxID
		tx, err := DB.BeginTx(r.Context(), nil)
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memulai transaksi top up")
			return
		}
		defer tx.Rollback()

		var ownerID int
		var nominalText string
		var trxStatus, snapToken string
		err = tx.QueryRowContext(r.Context(), `
			SELECT id_user, nominal, status, IFNULL(snap_token,'')
			FROM tb_transaksi_wallet WHERE id_transaksi = ? FOR UPDATE`, trxID,
		).Scan(&ownerID, &nominalText, &trxStatus, &snapToken)
		if err == nil {
			nominal, amountErr := rupiahAmountToMidtrans(nominalText)
			if amountErr != nil || ownerID != claims.ID || nominal != req.JumlahTagihan {
				Error(w, http.StatusConflict, "Request ID sudah digunakan untuk transaksi lain")
				return
			}
			if trxStatus != "pending" {
				Error(w, http.StatusConflict, "Transaksi top up sudah diproses atau tidak dapat dilanjutkan")
				return
			}
			if !storedSnapTokenUsable(snapToken) {
				snapToken = ""
			}
		} else if err != sql.ErrNoRows {
			Error(w, http.StatusInternalServerError, "Gagal membaca transaksi top up")
			return
		}
		if snapToken == "" {
			snapReq := &snap.Request{
				TransactionDetails: midtrans.TransactionDetails{
					OrderID:  topupOrderID,
					GrossAmt: req.JumlahTagihan,
				},
				CustomerDetail: &midtrans.CustomerDetails{FName: claims.Nama},
				Items: &[]midtrans.ItemDetails{{
					ID:    "WALLET-TOPUP",
					Price: req.JumlahTagihan,
					Qty:   1,
					Name:  "Top Up Deposit Saldo Lelang",
				}},
			}
			snapResp, midtransErr := SnapClient.CreateTransaction(snapReq)
			if midtransErr != nil || snapResp == nil || snapResp.Token == "" {
				Error(w, http.StatusBadGateway, "Midtrans gagal membuat transaksi top up")
				return
			}
			snapToken = snapResp.Token
			if ownerID == 0 {
				_, err = tx.ExecContext(r.Context(), `
					INSERT INTO tb_transaksi_wallet
						(id_transaksi, id_user, tipe, nominal, keterangan, status, referensi_id, snap_token)
					VALUES (?, ?, 'topup', ?, 'Top Up Deposit Saldo Lelang', 'pending', ?, ?)`,
					trxID, claims.ID, req.JumlahTagihan, topupOrderID, snapToken,
				)
				if err != nil {
					Error(w, http.StatusConflict, "Transaksi top up dengan request ID tersebut sudah ada")
					return
				}
			} else {
				if _, err := tx.ExecContext(r.Context(), `
					UPDATE tb_transaksi_wallet SET snap_token = ?
					WHERE id_transaksi = ? AND status = 'pending'`,
					snapToken, trxID,
				); err != nil {
					Error(w, http.StatusInternalServerError, "Gagal memperbarui transaksi top up")
					return
				}
			}
		}
		if err := tx.Commit(); err != nil {
			Error(w, http.StatusInternalServerError, "Gagal menyimpan transaksi top up")
			return
		}

		JSON(w, http.StatusOK, Response{
			Success: true,
			Message: "Transaksi top up Midtrans siap dilanjutkan",
			Data: map[string]any{
				"order_id":      topupOrderID,
				"id_transaksi":  trxID,
				"tipe":          "topup",
				"nominal":       req.JumlahTagihan,
				"snap_token":    snapToken,
				"client_key":    midtransClientKey(),
				"is_production": midtransProduction(),
			},
		})
		return
	}

	Error(w, http.StatusBadRequest, "ID Pembayaran atau nominal top up harus ditentukan")
}

type midtransNotification struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	Currency          string `json:"currency"`
	SignatureKey      string `json:"signature_key"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	PaymentType       string `json:"payment_type"`
}

type paymentEvent int

const (
	paymentEventPending paymentEvent = iota
	paymentEventPaid
	paymentEventFailed
	paymentEventManualReview
)

func classifyMidtransEvent(transactionStatus, fraudStatus string) (paymentEvent, bool) {
	switch transactionStatus {
	case "settlement":
		return paymentEventPaid, true
	case "capture":
		switch fraudStatus {
		case "accept":
			return paymentEventPaid, true
		case "deny":
			return paymentEventFailed, true
		case "challenge", "":
			return paymentEventPending, true
		default:
			return paymentEventPending, false
		}
	case "pending", "authorize":
		return paymentEventPending, true
	case "deny", "cancel", "expire", "failure":
		return paymentEventFailed, true
	case "refund", "partial_refund", "chargeback", "partial_chargeback":
		return paymentEventManualReview, true
	default:
		return paymentEventPending, false
	}
}

func MidtransWebhook(w http.ResponseWriter, r *http.Request) {
	if !MidtransReady() {
		Error(w, http.StatusServiceUnavailable, "Webhook Midtrans belum dikonfigurasi")
		return
	}
	var notification midtransNotification
	if err := DecodeJSON(r, &notification); err != nil {
		Error(w, http.StatusBadRequest, "Payload notifikasi Midtrans tidak valid")
		return
	}
	if !VerifikasiSignatureMidtrans(
		notification.OrderID,
		notification.StatusCode,
		notification.GrossAmount,
		notification.SignatureKey,
	) {
		Error(w, http.StatusUnauthorized, "Signature notifikasi Midtrans tidak valid")
		return
	}
	if !strings.EqualFold(notification.Currency, "IDR") {
		Error(w, http.StatusBadRequest, "Mata uang notifikasi tidak sesuai")
		return
	}
	paidMinor, err := parseRupiahAmount(notification.GrossAmount)
	if err != nil || paidMinor <= 0 {
		Error(w, http.StatusBadRequest, "Nominal notifikasi Midtrans tidak valid")
		return
	}
	event, ok := classifyMidtransEvent(notification.TransactionStatus, notification.FraudStatus)
	if !ok {
		Error(w, http.StatusBadRequest, "Status notifikasi Midtrans tidak didukung")
		return
	}

	tx, err := DB.BeginTx(r.Context(), nil)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal memulai pemrosesan notifikasi")
		return
	}
	defer tx.Rollback()

	var paymentID, auctionID, itemID, userID int
	var expectedAmount, paymentStatus string
	err = tx.QueryRowContext(r.Context(), `
		SELECT id_pembayaran, id_lelang, id_barang, id_user, sisa_tagihan, status
		FROM tb_pembayaran WHERE order_id = ? FOR UPDATE`, notification.OrderID,
	).Scan(&paymentID, &auctionID, &itemID, &userID, &expectedAmount, &paymentStatus)
	if err == nil {
		expectedMinor, amountErr := parseRupiahAmount(expectedAmount)
		if amountErr != nil || expectedMinor != paidMinor {
			Error(w, http.StatusBadRequest, "Nominal notifikasi tidak cocok dengan tagihan")
			return
		}
		if err := applyInvoiceNotification(r, tx, notification, event, paymentID, auctionID, itemID, userID, paymentStatus); err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memproses status pembayaran")
			return
		}
	} else if err == sql.ErrNoRows {
		var transactionID, transactionStatus, walletAmount string
		err = tx.QueryRowContext(r.Context(), `
			SELECT id_transaksi, id_user, nominal, status
			FROM tb_transaksi_wallet WHERE referensi_id = ? AND tipe = 'topup' FOR UPDATE`,
			notification.OrderID,
		).Scan(&transactionID, &userID, &walletAmount, &transactionStatus)
		if err == sql.ErrNoRows {
			Error(w, http.StatusNotFound, "Transaksi Midtrans tidak dikenal")
			return
		}
		if err != nil {
			Error(w, http.StatusInternalServerError, "Gagal mencari transaksi top up")
			return
		}
		expectedMinor, amountErr := parseRupiahAmount(walletAmount)
		if amountErr != nil || expectedMinor != paidMinor {
			Error(w, http.StatusBadRequest, "Nominal notifikasi tidak cocok dengan transaksi top up")
			return
		}
		if err := applyTopUpNotification(r, tx, notification.OrderID, event, transactionID, userID, transactionStatus); err != nil {
			Error(w, http.StatusInternalServerError, "Gagal memproses status top up")
			return
		}
	} else {
		Error(w, http.StatusInternalServerError, "Gagal mencari transaksi Midtrans")
		return
	}

	if err := tx.Commit(); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyimpan notifikasi Midtrans")
		return
	}
	JSON(w, http.StatusOK, map[string]string{
		"status":  "received",
		"message": "Notifikasi Midtrans diterima",
	})
}

func applyInvoiceNotification(
	r *http.Request,
	tx *sql.Tx,
	notification midtransNotification,
	event paymentEvent,
	paymentID, auctionID, itemID, userID int,
	currentStatus string,
) error {
	if event == paymentEventManualReview {
		log.Printf("Midtrans order %s membutuhkan rekonsiliasi manual: %s", notification.OrderID, notification.TransactionStatus)
		return nil
	}
	if event == paymentEventPending {
		return nil
	}
	if event == paymentEventFailed {
		if currentStatus == "Belum Dibayar" {
			_, err := tx.ExecContext(r.Context(), `
				UPDATE tb_pembayaran SET status = 'Kadaluarsa'
				WHERE id_pembayaran = ? AND status = 'Belum Dibayar'`, paymentID)
			return err
		}
		return nil
	}
	if currentStatus == "Sudah Dibayar" {
		return nil
	}
	if currentStatus != "Belum Dibayar" && currentStatus != "Kadaluarsa" {
		return fmt.Errorf("invoice status cannot transition to paid")
	}

	result, err := tx.ExecContext(r.Context(), `
		UPDATE tb_pembayaran SET status = 'Sudah Dibayar', metode_pembayaran = ?, tgl_pembayaran = NOW()
		WHERE id_pembayaran = ? AND status IN ('Belum Dibayar', 'Kadaluarsa')`,
		fmt.Sprintf("Midtrans - %s", strings.ToUpper(notification.PaymentType)), paymentID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("invoice status changed while processing")
	}
	var uangJaminan string
	if err := tx.QueryRowContext(r.Context(), `SELECT uang_jaminan FROM tb_lelang WHERE id_lelang = ?`, auctionID).Scan(&uangJaminan); err != nil {
		return err
	}
	if _, err := tx.ExecContext(r.Context(), `
		UPDATE tb_masyarakat SET saldo_hold = GREATEST(0, saldo_hold - ?) WHERE id_user = ?`,
		uangJaminan, userID,
	); err != nil {
		return err
	}
	var fulfillmentCount int
	if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM tb_pengiriman WHERE id_pembayaran = ?`, paymentID).Scan(&fulfillmentCount); err != nil {
		return err
	}
	if fulfillmentCount == 0 {
		history, err := json.Marshal([]map[string]any{{
			"status":    "menunggu_alamat",
			"deskripsi": "Pelunasan lelang terverifikasi via Midtrans. Menunggu pengisian alamat pengiriman.",
			"waktu":     time.Now().Format("2006-01-02 15:04:05"),
		}})
		if err != nil {
			return err
		}
		fulfillID := fmt.Sprintf("FULFILL-%d", time.Now().UnixNano())
		if _, err := tx.ExecContext(r.Context(), `
			INSERT INTO tb_pengiriman (
				id_fulfillment, id_pembayaran, id_lelang, id_barang, id_user_pembeli,
				status, tracking_history, tgl_update
			) VALUES (?, ?, ?, ?, ?, 'menunggu_alamat', ?, NOW())`,
			fulfillID, paymentID, auctionID, itemID, userID, string(history),
		); err != nil {
			return err
		}
	}
	notifID := fmt.Sprintf("NOTIF-%d", time.Now().UnixNano())
	_, err = tx.ExecContext(r.Context(), `
		INSERT INTO tb_notifikasi (id, id_user, judul, pesan, tipe, dibaca, link_target)
		VALUES (?, ?, 'Pembayaran Berhasil', 'Pelunasan lelang Anda berhasil diverifikasi. Silakan lengkapi alamat pengiriman.', 'info', 0, 'fulfillment')`,
		notifID, userID,
	)
	return err
}

func applyTopUpNotification(
	r *http.Request,
	tx *sql.Tx,
	orderID string,
	event paymentEvent,
	transactionID string,
	userID int,
	currentStatus string,
) error {
	if event == paymentEventManualReview {
		log.Printf("Midtrans order %s membutuhkan rekonsiliasi manual", orderID)
		return nil
	}
	if event == paymentEventPending || currentStatus == "sukses" {
		return nil
	}
	if event == paymentEventFailed {
		if currentStatus == "pending" {
			_, err := tx.ExecContext(r.Context(), `
				UPDATE tb_transaksi_wallet SET status = 'gagal'
				WHERE id_transaksi = ? AND status = 'pending'`, transactionID)
			return err
		}
		return nil
	}
	if currentStatus != "pending" && currentStatus != "gagal" {
		return fmt.Errorf("top-up status cannot transition to paid")
	}

	var amount string
	if err := tx.QueryRowContext(r.Context(), `
		SELECT nominal FROM tb_transaksi_wallet WHERE id_transaksi = ?`, transactionID).Scan(&amount); err != nil {
		return err
	}
	result, err := tx.ExecContext(r.Context(), `
		UPDATE tb_masyarakat SET saldo_wallet = saldo_wallet + ? WHERE id_user = ?`, amount, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("wallet owner no longer exists")
	}
	result, err = tx.ExecContext(r.Context(), `
		UPDATE tb_transaksi_wallet SET status = 'sukses'
		WHERE id_transaksi = ? AND status IN ('pending', 'gagal')`, transactionID)
	if err != nil {
		return err
	}
	affected, err = result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("top-up status changed while processing")
	}
	return nil
}

// GetInvoices mengembalikan daftar tagihan lelang untuk user login
func GetInvoices(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	rows, err := DB.Query(`
		SELECT p.id_pembayaran, p.order_id, p.id_lelang, p.id_barang, p.id_user,
		       p.tgl_pembayaran, p.jumlah_pembayaran, p.premi_persen, p.premi_pembeli,
		       p.total_keseluruhan, p.uang_jaminan_dipotong, p.sisa_tagihan,
		       IFNULL(p.metode_pembayaran,''), IFNULL(p.nomor_va,''), IFNULL(p.snap_token,''),
		       IFNULL(p.qris_url,''), p.status, p.batas_pembayaran,
		       b.nama_barang, b.kategori, b.foto_barang
		FROM tb_pembayaran p
		JOIN tb_barang b ON b.id_barang = p.id_barang
		WHERE p.id_user = ?
		ORDER BY p.id_pembayaran DESC`, claims.ID)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query tagihan: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]any, 0)
	for rows.Next() {
		var idPay, idLelang, idBarang, idUser, premiPersen int
		var orderID, tglBayar, metode, va, snapToken, qrisURL, status, batasBayar, namaBarang, kategori, fotoStr string
		var jmlBayar, premiPembeli, total, jaminanPotong, sisa float64

		if err := rows.Scan(
			&idPay, &orderID, &idLelang, &idBarang, &idUser,
			&tglBayar, &jmlBayar, &premiPersen, &premiPembeli,
			&total, &jaminanPotong, &sisa,
			&metode, &va, &snapToken,
			&qrisURL, &status, &batasBayar,
			&namaBarang, &kategori, &fotoStr,
		); err != nil {
			continue
		}

		var fotoArr []string
		_ = json.Unmarshal([]byte(fotoStr), &fotoArr)

		list = append(list, map[string]any{
			"id_pembayaran":         idPay,
			"order_id":              orderID,
			"id_lelang":             idLelang,
			"id_barang":             idBarang,
			"id_user":               idUser,
			"tgl_pembayaran":        tglBayar,
			"jumlah_pembayaran":     jmlBayar,
			"premi_persen":          premiPersen,
			"premi_pembeli":         premiPembeli,
			"total_keseluruhan":     total,
			"uang_jaminan_dipotong": jaminanPotong,
			"sisa_tagihan":          sisa,
			"metode_pembayaran":     metode,
			"nomor_va":              va,
			"snap_token":            snapToken,
			"qris_url":              qrisURL,
			"status":                status,
			"batas_pembayaran":      batasBayar,
			"nama_barang":           namaBarang,
			"kategori":              kategori,
			"foto_barang":           fotoArr,
		})
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}
