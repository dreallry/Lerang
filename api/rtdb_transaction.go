package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	firebaseDB "firebase.google.com/go/v4/db"
)

type transactionError struct {
	status  int
	message string
}

func (e *transactionError) Error() string          { return e.message }
func domainError(status int, message string) error { return &transactionError{status, message} }

func treeMap(value interface{}) map[string]interface{} {
	result, _ := value.(map[string]interface{})
	if list, ok := value.([]interface{}); ok {
		result = map[string]interface{}{}
		for i, child := range list {
			if child != nil {
				result[strconv.Itoa(i)] = child
			}
		}
	}
	return result
}

func treeNode(root map[string]interface{}, path ...string) map[string]interface{} {
	node := root
	for _, key := range path {
		next := treeMap(node[key])
		if next == nil {
			next = map[string]interface{}{}
		}
		node[key] = next
		node = next
	}
	return node
}

func treeRecord(root map[string]interface{}, node, key string) map[string]interface{} {
	return treeMap(treeMap(root[node])[key])
}

// shortcut: a root transaction keeps the existing cross-node schema atomic; split into a ledger when database size or contention requires it.
func rtdbTransaction(ctx context.Context, fn func(map[string]interface{}) error) error {
	ref, err := rtdbRef("")
	if err != nil {
		return err
	}
	return ref.Transaction(ctx, func(node firebaseDB.TransactionNode) (interface{}, error) {
		var root map[string]interface{}
		if err := node.Unmarshal(&root); err != nil {
			return nil, err
		}
		if root == nil {
			root = map[string]interface{}{}
		}
		if err := fn(root); err != nil {
			return nil, err
		}
		return root, nil
	})
}

func nextTreeID(root map[string]interface{}, node string) int {
	field := map[string]string{"users": "id_user", "staff": "id_petugas", "items": "id_barang", "auctions": "id_lelang", "sessions": "id_sesi", "invoices": "id_pembayaran", "themes": "id_theme"}[node]
	maximum := rtdbNumericID(treeNode(root, "_counters")[node])
	nodes := []string{node}
	if node == "users" || node == "staff" {
		nodes = append(nodes, "legacy_"+node)
	}
	for _, collection := range nodes {
		for key, value := range treeMap(root[collection]) {
			id := rtdbNumericID(treeMap(value)[field])
			if id == 0 {
				id = rtdbNumericID(key)
			}
			if id > maximum {
				maximum = id
			}
		}
	}
	maximum++
	treeNode(root, "_counters")[node] = maximum
	return maximum
}

func wholeRupiah(value float64, minimum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= 9_999_999_999_999 && value == math.Trunc(value)
}

func storedRupiah(value interface{}) (float64, bool) {
	switch value.(type) {
	case float64, int, int64, string:
		amount := numberValue(value)
		if text, ok := value.(string); ok {
			var err error
			amount, err = strconv.ParseFloat(text, 64)
			if err != nil {
				return 0, false
			}
		}
		return amount, wholeRupiah(amount, 0)
	default:
		return 0, false
	}
}

func validStoredBalance(profile map[string]interface{}) bool {
	wallet, walletOK := storedRupiah(profile["saldo_wallet"])
	hold, holdOK := storedRupiah(profile["saldo_hold"])
	return walletOK && holdOK && wholeRupiah(wallet+hold, 0)
}

func transactionProfile(root map[string]interface{}, claims *RTDBClaims) (map[string]interface{}, error) {
	if claims == nil || claims.UID == "" || claims.Role != RoleMasyarakat {
		return nil, domainError(http.StatusUnauthorized, "Akun peserta diperlukan")
	}
	if !claims.EmailVerified {
		return nil, domainError(http.StatusForbidden, "Verifikasi email sebelum melakukan transaksi")
	}
	profile := treeRecord(root, "users", claims.UID)
	if profile == nil || rtdbNumericID(profile["id_user"]) != claims.ID {
		return nil, domainError(http.StatusForbidden, "Profil peserta tidak sesuai sesi")
	}
	if profile["financial_review_required"] == true {
		return nil, domainError(http.StatusConflict, "Transaksi akun sedang ditinjau. Hubungi pengelola")
	}
	if !validStoredBalance(profile) {
		return nil, domainError(http.StatusConflict, "Saldo akun perlu diperiksa pengelola")
	}
	return profile, nil
}

func userUID(root map[string]interface{}, id int) string {
	if uid, ok := treeMap(root["user_ids"])[rtdbPathID(id)].(string); ok && id > 0 && rtdbNumericID(treeRecord(root, "users", uid)["id_user"]) == id {
		return uid
	}
	for uid, value := range treeMap(root["users"]) {
		if rtdbNumericID(treeMap(value)["id_user"]) == id {
			return uid
		}
	}
	return ""
}

func recordWallet(root map[string]interface{}, uid, key, kind string, nominal float64, message, reference string, now time.Time) {
	profile := treeRecord(root, "users", uid)
	treeNode(root, "walletTransactions", uid)[key] = map[string]interface{}{
		"id": key, "id_transaksi": key, "id_user": profile["id_user"], "owner_uid": uid, "tipe": kind, "nominal": nominal,
		"keterangan": message, "referensi_id": reference, "status": "sukses", "created_at": now.UTC().Format(time.RFC3339Nano),
	}
}

func notifyUser(root map[string]interface{}, uid, key, title, message, kind, link string, now time.Time) {
	if uid == "" {
		return
	}
	treeNode(root, "notifications", uid)[key] = map[string]interface{}{"id": key, "id_user": treeRecord(root, "users", uid)["id_user"], "judul": title, "pesan": message, "tipe": kind, "link_target": link, "dibaca": false, "created_at": now.UTC().Format(time.RFC3339Nano)}
}

func releaseAuctionHold(root map[string]interface{}, auctionID, uid string, refund bool, reason string, now time.Time) error {
	hold := treeMap(treeMap(treeMap(root["holds"])[auctionID])[uid])
	if hold == nil || stringValue(hold["status"], "") != "held" {
		return nil
	}
	profile := treeRecord(root, "users", uid)
	amount := numberValue(hold["nominal"])
	if profile == nil || !validStoredBalance(profile) || !wholeRupiah(amount, 0) || numberValue(profile["saldo_hold"]) < amount {
		return domainError(http.StatusConflict, "Saldo jaminan tidak sesuai catatan. Hubungi pengelola")
	}
	profile["saldo_hold"] = numberValue(profile["saldo_hold"]) - amount
	status, kind := "forfeited", "forfeit"
	if refund {
		profile["saldo_wallet"] = numberValue(profile["saldo_wallet"]) + amount
		status, kind = "refunded", "unhold"
	}
	hold["status"], hold["updated_at"] = status, now.UTC().Format(time.RFC3339Nano)
	if !refund {
		treeNode(root, "platformLedger")["forfeit-"+auctionID+"-"+uid] = map[string]interface{}{"nominal": amount, "tipe": "forfeit", "created_at": now.UTC().Format(time.RFC3339Nano)}
	}
	key := fmt.Sprintf("%s-%s", status, auctionID)
	recordWallet(root, uid, key, kind, amount, reason, "LELANG-"+auctionID, now)
	notifyUser(root, uid, key, "Status uang jaminan", reason, "payment", "wallet", now)
	return nil
}
