package api

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

func treeList(values map[string]interface{}) []map[string]interface{} {
	list := make([]map[string]interface{}, 0, len(values))
	for key, value := range values {
		row := treeMap(value)
		if row == nil {
			continue
		}
		if row["id"] == nil {
			row["id"] = key
		}
		list = append(list, row)
	}
	return list
}

func GetWalletRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	var root map[string]interface{}
	if err := rtdbGet(r.Context(), "", &root); err != nil {
		rtdbJSONError(w, err)
		return
	}
	profile := treeRecord(root, "users", claims.UID)
	if profile == nil {
		Error(w, 404, "Profil peserta tidak tersedia")
		return
	}
	held, auto := map[string]bool{}, map[string]float64{}
	for id, value := range treeMap(root["holds"]) {
		hold := treeMap(treeMap(value)[claims.UID])
		if stringValue(hold["status"], "") == "held" {
			held[id+"_"+rtdbPathID(claims.ID)] = true
		}
	}
	for id, value := range treeMap(root["autoBids"]) {
		config := treeMap(treeMap(value)[claims.UID])
		if config != nil {
			auto[id+"_"+rtdbPathID(claims.ID)] = numberValue(config["max_amount"])
		}
	}
	transactions := treeList(treeMap(treeMap(root["walletTransactions"])[claims.UID]))
	sort.SliceStable(transactions, func(i, j int) bool {
		return stringValue(transactions[i]["created_at"], "") > stringValue(transactions[j]["created_at"], "")
	})
	JSON(w, 200, Response{Success: true, Data: map[string]interface{}{"saldo_wallet": numberValue(profile["saldo_wallet"]), "saldo_hold": numberValue(profile["saldo_hold"]), "held_deposits": held, "auto_bids": auto, "transactions": transactions, "financial_review_required": profile["financial_review_required"] == true}})
}

type withdrawRequest struct {
	Amount    float64 `json:"amount"`
	Bank      string  `json:"bank_name"`
	Account   string  `json:"account_number"`
	Holder    string  `json:"account_holder"`
	RequestID string  `json:"request_id"`
}

func requestWithdrawal(root map[string]interface{}, claims *RTDBClaims, req withdrawRequest, now time.Time) (string, error) {
	profile, err := transactionProfile(root, claims)
	if err != nil {
		return "", err
	}
	if claims.AuthTime <= 0 || now.Unix()-claims.AuthTime > 300 || claims.AuthTime > now.Unix()+30 {
		return "", domainError(403, "Konfirmasi kembali identitas akun sebelum mengajukan penarikan")
	}
	req.Bank, req.Account, req.Holder = strings.TrimSpace(req.Bank), strings.TrimSpace(req.Account), strings.TrimSpace(req.Holder)
	if !wholeRupiah(req.Amount, 50000) || !validTopUpRequestID(req.RequestID) || req.Bank == "" || len(req.Bank) > 80 || req.Holder == "" || len(req.Holder) > 100 || len(req.Account) < 8 || len(req.Account) > 18 || strings.Trim(req.Account, "0123456789") != "" {
		return "", domainError(400, "Nominal, rekening, atau ID permintaan penarikan belum valid")
	}
	digest := sha256.Sum256([]byte(claims.UID + "|" + req.RequestID))
	id := "WITHDRAW-" + hex.EncodeToString(digest[:16])
	if existing := treeRecord(root, "withdrawals", id); existing != nil {
		if numberValue(existing["amount"]) != req.Amount || stringValue(existing["bank_name"], "") != req.Bank || stringValue(existing["account_number"], "") != req.Account || stringValue(existing["account_holder"], "") != req.Holder {
			return "", domainError(409, "ID permintaan sudah dipakai untuk detail penarikan lain")
		}
		return id, nil
	}
	if req.Amount > numberValue(profile["saldo_wallet"]) {
		return "", domainError(409, "Saldo tersedia tidak mencukupi")
	}
	profile["saldo_wallet"] = numberValue(profile["saldo_wallet"]) - req.Amount
	treeNode(root, "withdrawals")[id] = map[string]interface{}{"id": id, "owner_uid": claims.UID, "id_user": claims.ID, "nama_lengkap": profile["nama_lengkap"], "amount": req.Amount, "bank_name": req.Bank, "account_number": req.Account, "account_holder": req.Holder, "status": "pending", "created_at": now.UTC().Format(time.RFC3339Nano)}
	recordWallet(root, claims.UID, id, "withdraw", req.Amount, fmt.Sprintf("Permintaan penarikan ke %s (%s)", req.Bank, req.Account), id, now)
	treeNode(root, "walletTransactions", claims.UID, id)["status"] = "pending"
	return id, nil
}

func WithdrawWalletRTDB(w http.ResponseWriter, r *http.Request) {
	var req withdrawRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	var id string
	now := time.Now()
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		var err error
		id, err = requestWithdrawal(root, rtdbClaimsFromRequest(r), req, now)
		return err
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Permintaan penarikan tersimpan. Transfer bank menunggu pemrosesan petugas.", Data: map[string]interface{}{"id_transaksi": id, "nominal": req.Amount}})
}

func ListWithdrawalsRTDB(w http.ResponseWriter, r *http.Request) {
	values, err := rtdbCollection(r.Context(), "withdrawals")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := collectionList(values)
	sort.SliceStable(list, func(i, j int) bool {
		return stringValue(list[i]["created_at"], "") > stringValue(list[j]["created_at"], "")
	})
	JSON(w, 200, Response{Success: true, Data: list})
}

func ReviewWithdrawalRTDB(w http.ResponseWriter, r *http.Request) {
	if err := sessionStaff(rtdbClaimsFromRequest(r)); err != nil {
		rtdbJSONError(w, err)
		return
	}
	var req struct {
		Status    string `json:"status"`
		Reference string `json:"reference"`
		Reason    string `json:"reason"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	if req.Status != "paid" && req.Status != "rejected" {
		Error(w, 400, "Status penarikan belum valid")
		return
	}
	if len(req.Reference) > 200 || len(req.Reason) > 1000 || req.Status == "paid" && strings.TrimSpace(req.Reference) == "" || req.Status == "rejected" && strings.TrimSpace(req.Reason) == "" {
		Error(w, 400, "Isi referensi transfer atau alasan penolakan")
		return
	}
	id, claims, now := r.PathValue("id"), rtdbClaimsFromRequest(r), time.Now()
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		request := treeRecord(root, "withdrawals", id)
		if request == nil {
			return domainError(404, "Permintaan penarikan tidak ditemukan")
		}
		if stringValue(request["status"], "") == req.Status {
			return nil
		}
		if stringValue(request["status"], "") != "pending" {
			return domainError(409, "Penarikan sudah diproses")
		}
		uid := stringValue(request["owner_uid"], "")
		profile := treeRecord(root, "users", uid)
		if profile == nil {
			return domainError(409, "Profil penarikan tidak ditemukan")
		}
		if req.Status == "rejected" {
			amount := numberValue(request["amount"])
			if !validStoredBalance(profile) || !wholeRupiah(amount, 1) || !wholeRupiah(numberValue(profile["saldo_wallet"])+numberValue(profile["saldo_hold"])+amount, 0) {
				return domainError(409, "Saldo pengembalian perlu direkonsiliasi pengelola")
			}
			profile["saldo_wallet"] = numberValue(profile["saldo_wallet"]) + amount
			recordWallet(root, uid, "refund-"+id, "unhold", amount, "Pengembalian permintaan penarikan: "+strings.TrimSpace(req.Reason), id, now)
		}
		status := "sukses"
		if req.Status == "rejected" {
			status = "gagal"
		}
		treeNode(root, "walletTransactions", uid, id)["status"] = status
		request["status"], request["transfer_reference"], request["reason"], request["reviewed_by"], request["updated_at"] = req.Status, strings.TrimSpace(req.Reference), strings.TrimSpace(req.Reason), claims.UID, now.UTC().Format(time.RFC3339Nano)
		notifyUser(root, uid, "review-"+id, "Status penarikan diperbarui", "Permintaan penarikan berstatus "+req.Status, "payment", "wallet", now)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Keputusan penarikan tersimpan"})
}

func ListInvoicesRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	values, err := rtdbCollection(r.Context(), "invoices")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0)
	for _, value := range values {
		if claims.Role != RoleMasyarakat || rtdbNumericID(value["id_user"]) == claims.ID {
			list = append(list, value)
		}
	}
	JSON(w, 200, Response{Success: true, Data: list})
}
