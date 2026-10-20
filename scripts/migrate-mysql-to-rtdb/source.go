package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type tableSpec struct {
	name, path, primaryKey string
	jsonColumns            map[string]bool
}

type record struct {
	Key   string         `json:"key"`
	Value map[string]any `json:"value"`
}

var tableSpecs = []tableSpec{
	{"tb_masyarakat", "users", "id_user", nil},
	{"tb_petugas", "staff", "id_petugas", nil},
	{"tb_level", "levels", "id_level", nil},
	{"tb_barang", "items", "id_barang", jsonSet("foto_barang", "dokumen_pendukung", "spesifikasi")},
	{"tb_histori_lelang", "bids", "id_history", nil},
	{"tb_jadwal_harian", "schedules", "id_jadwal", nil},
	{"tb_kategori", "categories", "id_kategori", nil},
	{"tb_lelang", "auctions", "id_lelang", nil},
	{"tb_notifikasi", "notifications", "id_notifikasi", nil},
	{"tb_pembayaran", "invoices", "id_pembayaran", nil},
	{"tb_pengiriman", "fulfillments", "id_fulfillment", jsonSet("tracking_history")},
	{"tb_sesi_lelang", "sessions", "id_sesi", nil},
	{"tb_theme", "themes", "id_theme", jsonSet("id_lelang_list")},
	{"tb_transaksi_wallet", "walletTransactions", "id_transaksi", nil},
}

func jsonSet(fields ...string) map[string]bool {
	result := map[string]bool{}
	for _, field := range fields {
		result[field] = true
	}
	return result
}

func readTable(ctx context.Context, db *sql.DB, spec tableSpec, location *time.Location) ([]record, error) {
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+spec.name+" ORDER BY "+spec.primaryKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	types, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}
	result := []record{}
	seen := map[string]bool{}
	for rows.Next() {
		values := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for i := range values {
			destinations[i] = &values[i]
		}
		if err := rows.Scan(destinations...); err != nil {
			return nil, err
		}
		value := map[string]any{}
		for i, column := range columns {
			// The SQL dump contains old password hashes, which have no role in Firebase Auth.
			if column == "password" {
				continue
			}
			normalized, err := normalizeValue(values[i], column, types[i].DatabaseTypeName(), spec.jsonColumns, location)
			if err != nil {
				return nil, fmt.Errorf("row %d column %s: %w", len(result)+1, column, err)
			}
			if normalized != nil {
				value[column] = normalized
			}
		}
		key, err := stableKey(value[spec.primaryKey])
		if err != nil {
			return nil, fmt.Errorf("row %d: %w", len(result)+1, err)
		}
		if seen[key] {
			return nil, errors.New("duplicate primary key")
		}
		seen[key] = true
		value["_source_table"], value["_source_key"] = spec.name, key
		result = append(result, record{Key: key, Value: value})
	}
	return result, rows.Err()
}

func normalizeValue(value any, column, databaseType string, jsonColumns map[string]bool, location *time.Location) (any, error) {
	if value == nil {
		return nil, nil
	}
	if bytes, ok := value.([]byte); ok {
		value = string(bytes)
	}
	if jsonColumns[column] {
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("JSON source is not text")
		}
		var decoded any
		if err := json.Unmarshal([]byte(text), &decoded); err != nil {
			return nil, errors.New("invalid JSON source")
		}
		if column == "spesifikasi" {
			if _, ok := decoded.(map[string]any); !ok && decoded != nil {
				return nil, errors.New("spesifikasi must be an object")
			}
		} else if _, ok := decoded.([]any); !ok && decoded != nil {
			return nil, errors.New("JSON list expected")
		}
		return decoded, nil
	}
	typeName := strings.ToUpper(databaseType)
	if text, ok := value.(string); ok {
		switch typeName {
		case "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL":
			number, err := strconv.ParseFloat(text, 64)
			if err != nil {
				return nil, errors.New("invalid decimal")
			}
			value = number
		case "DATETIME", "TIMESTAMP":
			zone := location
			if typeName == "TIMESTAMP" {
				zone = time.UTC
			}
			parsed, err := time.ParseInLocation("2006-01-02 15:04:05", text, zone)
			if err != nil {
				return nil, errors.New("invalid source timestamp")
			}
			value = parsed.UTC().Format(time.RFC3339)
		}
	}
	switch column {
	case "is_auto_bid", "is_verified", "is_featured", "is_reserve_met", "is_extended", "dibaca":
		return numericID(value) != 0, nil
	}
	return value, nil
}

func stableKey(value any) (string, error) {
	key := valueString(value)
	if key == "" || strings.ContainsAny(key, ".#$[]/\x00\n\r") {
		return "", errors.New("empty or invalid RTDB primary key")
	}
	return key, nil
}

func valueString(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func numericID(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	default:
		return 0
	}
}
