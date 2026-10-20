package main

import (
	"errors"
	"strconv"
)

func remapLegacyUsers(source map[string][]record, root map[string]any, sourceHash string, allow bool) (map[string][]record, map[string]int, error) {
	mapping := map[string]int{}
	for old, value := range children(lookupPath(root, "migrationMeta/mysqlToRtdb/runs/"+sourceHash+"/user_id_mapping")) {
		if id := numericID(value); id > 0 {
			mapping[old] = id
		}
	}
	occupied := map[int]bool{}
	maximum := numericID(lookupPath(root, "_counters/users"))
	for _, collection := range []string{"users", "legacy_users"} {
		for _, value := range children(root[collection]) {
			id := numericID(children(value)["id_user"])
			if collection == "users" {
				occupied[id] = true
			}
			if id > maximum {
				maximum = id
			}
		}
	}
	for _, row := range source["tb_masyarakat"] {
		if id := numericID(row.Value["id_user"]); id > maximum {
			maximum = id
		}
	}
	for _, id := range mapping {
		if id > maximum {
			maximum = id
		}
	}
	for _, row := range source["tb_masyarakat"] {
		id := numericID(row.Value["id_user"])
		key := strconv.Itoa(id)
		if _, saved := mapping[key]; saved {
			continue
		}
		if occupied[id] {
			if !allow {
				return nil, nil, errors.New("ID pengguna SQL berbenturan dengan akun aktif; gunakan remapping yang sudah disetujui tanpa menimpa akun aktif")
			}
			maximum++
			mapping[key] = maximum
		}
	}
	result := map[string][]record{}
	for table, rows := range source {
		for _, row := range rows {
			copyRow := record{Key: row.Key, Value: map[string]any{}}
			for key, value := range row.Value {
				copyRow.Value[key] = value
			}
			for _, field := range []string{"id_user", "id_user_pembeli", "id_user_penjual"} {
				old := numericID(row.Value[field])
				if id, changed := mapping[strconv.Itoa(old)]; changed {
					copyRow.Value[field] = id
					if table == "tb_masyarakat" && field == "id_user" {
						copyRow.Key = strconv.Itoa(id)
						copyRow.Value["_legacy_id_user"] = old
					}
				}
			}
			result[table] = append(result[table], copyRow)
		}
	}
	return result, mapping, nil
}
