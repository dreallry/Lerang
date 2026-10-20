package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type entry struct {
	Path    string
	Value   any
	Counter bool
}

type migrationReport struct {
	UserIDMapping      map[string]int `json:"user_id_mapping,omitempty"`
	SourceRows         int            `json:"source_rows"`
	TableCounts        map[string]int `json:"table_counts"`
	SourceSHA256       string         `json:"source_sha256"`
	DataSHA256         string         `json:"data_sha256"`
	SourceTimezone     string         `json:"source_timezone"`
	HistoricalAuctions int            `json:"historical_auctions"`
	LegacyUsers        int            `json:"legacy_users"`
	LegacyStaff        int            `json:"legacy_staff"`
	NewNodes           int            `json:"new_nodes"`
	ExistingNodes      int            `json:"existing_nodes"`
	Conflicts          []conflict     `json:"conflicts"`
	Warnings           map[string]int `json:"warnings"`
	ValidateOnly       bool           `json:"validate_only"`
	Verified           bool           `json:"verified"`
	BackupFile         string         `json:"backup_file,omitempty"`
}

type conflict struct {
	Collection string `json:"collection"`
	PathHash   string `json:"path_sha256"`
}

type planStatus struct {
	Added, Existing int
	Conflicts       []conflict
}

func buildPlan(source map[string][]record, authEmails map[string]string, now time.Time, sourceHash string) ([]entry, migrationReport, error) {
	report := migrationReport{TableCounts: map[string]int{}, Warnings: map[string]int{}, Conflicts: []conflict{}}
	if err := validateRelations(source); err != nil {
		return nil, report, err
	}
	uidByID := map[int]string{}
	for _, row := range source["tb_masyarakat"] {
		uid, email := valueString(row.Value["firebase_uid"]), strings.ToLower(valueString(row.Value["email"]))
		if uid != "" && email != "" && authEmails[uid] == email {
			uidByID[numericID(row.Value["id_user"])] = uid
		}
	}
	sessionLots := map[int][]int{}
	for _, row := range source["tb_lelang"] {
		id := numericID(row.Value["id_sesi"])
		if id > 0 {
			sessionLots[id] = append(sessionLots[id], numericID(row.Value["id_lelang"]))
		}
	}
	plan := []entry{}
	for _, spec := range tableSpecs {
		rows := source[spec.name]
		report.TableCounts[spec.name] = len(rows)
		report.SourceRows += len(rows)
		maxID := 0
		for _, row := range rows {
			value := make(map[string]any, len(row.Value)+5)
			for key, item := range row.Value {
				value[key] = item
			}
			delete(value, "password")
			value["_migration_id"] = sourceHash
			path := spec.path + "/" + row.Key
			if id := numericID(value[spec.primaryKey]); id > maxID {
				maxID = id
			}
			ownerUID := uidByID[numericID(value["id_user"])]
			if ownerUID != "" {
				value["owner_uid"] = ownerUID
			}
			switch spec.name {
			case "tb_masyarakat":
				id := numericID(value["id_user"])
				value["role"] = "masyarakat"
				if nik := valueString(value["ft_ktp"]); len(nik) == 16 && strings.Trim(nik, "0123456789") == "" {
					value["nik"] = nik
				}
				if ownerUID != "" {
					path = "users/" + ownerUID
					value["firebase_uid"] = ownerUID
					delete(value, "owner_uid")
					plan = append(plan, entry{Path: "user_ids/" + strconv.Itoa(id), Value: ownerUID})
				} else {
					path = "legacy_users/" + row.Key
					if uid := valueString(value["firebase_uid"]); uid != "" {
						value["_legacy_firebase_uid"] = uid
					}
					delete(value, "firebase_uid")
					value["_migration_review_required"] = true
					report.LegacyUsers++
				}
				if numericID(value["saldo_hold"]) > 0 {
					value["financial_review_required"] = true
					report.Warnings["legacy_hold_without_per_lot_ledger"]++
				}
			case "tb_petugas":
				uid := valueString(value["firebase_uid"])
				if uid == "" {
					uid = valueString(value["uid"])
				}
				if _, ok := authEmails[uid]; uid != "" && ok {
					path = "staff/" + uid
				} else {
					path = "legacy_staff/" + row.Key
					report.LegacyStaff++
				}
				value["role"] = "petugas"
				if numericID(value["id_level"]) == 1 {
					value["role"] = "administrator"
				}
			case "tb_histori_lelang":
				path = "bids/" + strconv.Itoa(numericID(value["id_lelang"])) + "/" + row.Key
				value["legacy_historical"] = true
			case "tb_lelang":
				end, err := time.Parse(time.RFC3339, valueString(value["tgl_selesai"]))
				if err != nil {
					return nil, report, errors.New("invalid auction end date")
				}
				if !end.After(now) {
					value["legacy_status"] = value["status"]
					value["legacy_historical"], value["status"] = true, "ditutup"
					report.HistoricalAuctions++
				}
			case "tb_notifikasi", "tb_transaksi_wallet":
				value["id"] = row.Key
				if ownerUID != "" {
					path = spec.path + "/" + ownerUID + "/" + row.Key
				} else {
					path = "legacy_" + spec.path + "/" + strconv.Itoa(numericID(value["id_user"])) + "/" + row.Key
				}
				if spec.name == "tb_transaksi_wallet" {
					value["legacy_historical"] = true
				}
			case "tb_pembayaran":
				value["legacy_historical"] = true
				if valueString(value["status"]) != "Sudah Dibayar" {
					value["_migration_review_required"] = true
					report.Warnings["unpaid_historical_invoice"]++
				}
			case "tb_pengiriman":
				value["id_fulfillment"] = row.Key
				value["legacy_historical"] = true
				if uid := uidByID[numericID(value["id_user_pembeli"])]; uid != "" {
					value["buyer_uid"] = uid
				}
				if uid := uidByID[numericID(value["id_user_penjual"])]; uid != "" {
					value["seller_uid"] = uid
				}
				for _, invoice := range source["tb_pembayaran"] {
					if numericID(invoice.Value["id_pembayaran"]) == numericID(value["id_pembayaran"]) && valueString(invoice.Value["status"]) != "Sudah Dibayar" {
						value["_migration_review_required"] = true
						report.Warnings["fulfillment_with_unpaid_legacy_invoice"]++
					}
				}
			case "tb_sesi_lelang":
				lots := sessionLots[numericID(value["id_sesi"])]
				sort.Ints(lots)
				value["id_lelang_list"] = lots
				start, err := time.Parse(time.RFC3339, valueString(value["tgl_mulai"]))
				if err != nil {
					return nil, report, errors.New("invalid session start date")
				}
				if start.Before(now) {
					value["legacy_status"] = value["status"]
					value["status"], value["legacy_historical"] = "closed", true
				}
			case "tb_jadwal_harian":
				if valueString(value["tanggal_lelang"]) < now.In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02") {
					value["legacy_status"] = value["status"]
					value["status"], value["legacy_historical"] = "selesai", true
				}
			}
			plan = append(plan, entry{Path: path, Value: firebaseValue(value)})
		}
		if maxID > 0 {
			plan = append(plan, entry{Path: "_counters/" + spec.path, Value: maxID, Counter: true})
		}
	}
	return plan, report, nil
}

func validateRelations(source map[string][]record) error {
	ids := func(table, field string) map[int]bool {
		result := map[int]bool{}
		for _, row := range source[table] {
			id := numericID(row.Value[field])
			if id > 0 {
				result[id] = true
			}
		}
		return result
	}
	users, items, auctions := ids("tb_masyarakat", "id_user"), ids("tb_barang", "id_barang"), ids("tb_lelang", "id_lelang")
	checks := []struct {
		table, field string
		target       map[int]bool
		optional     bool
	}{
		{"tb_barang", "id_user", users, true}, {"tb_lelang", "id_barang", items, false},
		{"tb_lelang", "id_user", users, true}, {"tb_histori_lelang", "id_lelang", auctions, false},
		{"tb_histori_lelang", "id_user", users, false}, {"tb_pembayaran", "id_lelang", auctions, false},
		{"tb_pembayaran", "id_user", users, false}, {"tb_notifikasi", "id_user", users, false},
		{"tb_transaksi_wallet", "id_user", users, false}, {"tb_pengiriman", "id_lelang", auctions, false},
		{"tb_pengiriman", "id_user_pembeli", users, false}, {"tb_pengiriman", "id_user_penjual", users, true},
	}
	for _, check := range checks {
		for _, row := range source[check.table] {
			id := numericID(row.Value[check.field])
			if check.optional && id == 0 {
				continue
			}
			if !check.target[id] {
				return fmt.Errorf("orphan relationship in %s.%s", check.table, check.field)
			}
		}
	}
	return nil
}

func inspectPlan(root map[string]any, plan []entry) planStatus {
	status := planStatus{Conflicts: []conflict{}}
	for _, entry := range plan {
		old := lookupPath(root, entry.Path)
		if old == nil || (entry.Counter && numericID(old) < numericID(entry.Value)) {
			status.Added++
			continue
		}
		if entry.Counter || equalValue(old, entry.Value) {
			status.Existing++
			continue
		}
		hash, _ := checksum(entry.Path)
		status.Conflicts = append(status.Conflicts, conflict{Collection: strings.Split(entry.Path, "/")[0], PathHash: hash})
	}
	// A numeric legacy ID must never be attached to a different live account.
	for _, entry := range plan {
		if !strings.HasPrefix(entry.Path, "legacy_users/") && !strings.HasPrefix(entry.Path, "legacy_staff/") {
			continue
		}
		value := entry.Value.(map[string]any)
		collection, idField := "users", "id_user"
		if strings.HasPrefix(entry.Path, "legacy_staff/") {
			collection, idField = "staff", "id_petugas"
		}
		live := children(lookupPath(root, collection))
		for _, profile := range live {
			if fields, ok := profile.(map[string]any); ok && numericID(fields[idField]) == numericID(value[idField]) {
				hash, _ := checksum(entry.Path)
				status.Conflicts = append(status.Conflicts, conflict{Collection: collection, PathHash: hash})
			}
		}
	}
	return status
}

func equalValue(first, second any) bool {
	a, _ := json.Marshal(firebaseValue(first))
	b, _ := json.Marshal(firebaseValue(second))
	return string(a) == string(b)
}

// RTDB removes null and empty containers, so compare the shape it actually persists.
func firebaseValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for key, child := range typed {
			if normalized := firebaseValue(child); normalized != nil {
				result[key] = normalized
			}
		}
		if len(result) == 0 {
			return nil
		}
		return result
	case []any:
		if len(typed) == 0 {
			return nil
		}
		return typed
	case []int:
		if len(typed) == 0 {
			return nil
		}
		return typed
	default:
		return value
	}
}

func children(value any) map[string]any {
	if values, ok := value.(map[string]any); ok {
		return values
	}
	result := map[string]any{}
	if values, ok := value.([]any); ok {
		for index, child := range values {
			if child != nil {
				result[strconv.Itoa(index)] = child
			}
		}
	}
	return result
}

func lookupPath(root map[string]any, path string) any {
	var value any = root
	for _, key := range strings.Split(path, "/") {
		value = children(value)[key]
		if value == nil {
			return nil
		}
	}
	return value
}

func setPath(root map[string]any, path []string, value any) {
	if len(path) == 1 {
		root[path[0]] = value
		return
	}
	child := children(root[path[0]])
	root[path[0]] = child
	setPath(child, path[1:], value)
}
