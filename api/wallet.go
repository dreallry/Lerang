package api

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"
)

// GetWalletInfo mengembalikan saldo wallet, saldo hold, dan riwayat mutasi
func GetWalletInfo(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	var saldoWallet, saldoHold float64
	err := DB.QueryRow(`
		SELECT saldo_wallet, saldo_hold FROM tb_masyarakat WHERE id_user = ?`, claims.ID,
	).Scan(&saldoWallet, &saldoHold)
	if err == sql.ErrNoRows {
		Error(w, http.StatusNotFound, "User tidak ditemukan")
		return
	}
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal query saldo: "+err.Error())
		return
	}

	// Ambil mutasi transaksi wallet
	rows, errTrx := DB.Query(`
		SELECT id_transaksi, tipe, nominal, keterangan, status, IFNULL(referensi_id,''), created_at
		FROM tb_transaksi_wallet
		WHERE id_user = ?
		ORDER BY created_at DESC`, claims.ID)
	transactions := make([]map[string]any, 0)
	if errTrx != nil {
		Error(w, http.StatusInternalServerError, "Gagal memuat riwayat wallet")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var idTrx, tipe, ket, status, ref, createdAt string
		var nominal float64
		if errS := rows.Scan(&idTrx, &tipe, &nominal, &ket, &status, &ref, &createdAt); errS != nil {
			Error(w, http.StatusInternalServerError, "Gagal membaca riwayat wallet")
			return
		}
		transactions = append(transactions, map[string]any{
			"id":           idTrx,
			"tipe":         tipe,
			"nominal":      nominal,
			"keterangan":   ket,
			"status":       status,
			"referensi_id": ref,
			"created_at":   createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal membaca riwayat wallet")
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]any{
			"saldo_wallet": saldoWallet,
			"saldo_hold":   saldoHold,
			"transactions": transactions,
		},
	})
}

// WithdrawWalletHandler memproses permintaan penarikan saldo wallet ke rekening bank
func WithdrawWalletHandler(w http.ResponseWriter, r *http.Request) {
	claims := FromRequest(r)
	if claims == nil {
		Error(w, http.StatusUnauthorized, "Silakan login")
		return
	}

	var req struct {
		Amount        float64 `json:"amount"`
		BankName      string  `json:"bank_name"`
		AccountNumber string  `json:"account_number"`
		AccountHolder string  `json:"account_holder"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, http.StatusBadRequest, "Format JSON tidak valid")
		return
	}

	if req.Amount < 50000 {
		Error(w, http.StatusBadRequest, "Penarikan saldo minimal Rp 50.000")
		return
	}

	var saldoWallet float64
	err := DB.QueryRow(`SELECT saldo_wallet FROM tb_masyarakat WHERE id_user = ?`, claims.ID).Scan(&saldoWallet)
	if err != nil || saldoWallet < req.Amount {
		Error(w, http.StatusBadRequest, "Saldo wallet tidak mencukupi untuk penarikan")
		return
	}

	tx, err := DB.BeginTx(r.Context(), nil)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal memulai penarikan: "+err.Error())
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `
		UPDATE tb_masyarakat SET saldo_wallet = saldo_wallet - ?
		WHERE id_user = ? AND saldo_wallet >= ?`, req.Amount, claims.ID, req.Amount)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mengunci saldo penarikan: "+err.Error())
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal memeriksa saldo penarikan: "+err.Error())
		return
	}
	if affected != 1 {
		Error(w, http.StatusBadRequest, "Saldo wallet tidak mencukupi untuk penarikan")
		return
	}

	// Catat riwayat
	trxID := fmt.Sprintf("WD-%d", time.Now().UnixNano()%10000000)
	_, err = tx.ExecContext(r.Context(), `
		INSERT INTO tb_transaksi_wallet (id_transaksi, id_user, tipe, nominal, keterangan, status, referensi_id)
		VALUES (?, ?, 'withdraw', ?, ?, 'pending', ?)`,
		trxID, claims.ID, req.Amount,
		"Penarikan Saldo ke "+req.BankName+" ("+req.AccountNumber+" a/n "+req.AccountHolder+")",
		trxID,
	)
	if err != nil {
		Error(w, http.StatusInternalServerError, "Gagal mencatat permintaan penarikan: "+err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		Error(w, http.StatusInternalServerError, "Gagal menyimpan penarikan: "+err.Error())
		return
	}

	JSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Permintaan penarikan dicatat dan menunggu proses manual.",
		Data: map[string]any{
			"id_transaksi": trxID,
			"nominal":      req.Amount,
		},
	})
}
