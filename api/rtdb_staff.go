package api

import (
	"net/http"
	"sort"
)

func ListStaffRTDB(w http.ResponseWriter, r *http.Request) {
	list := []map[string]interface{}{}
	for _, node := range []string{"staff", "legacy_staff"} {
		var records map[string]map[string]interface{}
		if err := rtdbGet(r.Context(), node, &records); err != nil {
			rtdbJSONError(w, err)
			return
		}
		for uid, profile := range records {
			if profile == nil {
				continue
			}
			row := map[string]interface{}{}
			for _, field := range []string{"id_petugas", "id_level", "nama_petugas", "nama_lengkap", "username", "email", "active", "nip"} {
				if value, exists := profile[field]; exists {
					row[field] = value
				}
			}
			if node == "staff" {
				row["uid"] = uid
			} else {
				row["active"] = false
				row["legacy_historical"] = true
				row["requires_identity_link"] = true
			}
			list = append(list, row)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return rtdbNumericID(list[i]["id_petugas"]) < rtdbNumericID(list[j]["id_petugas"])
	})
	JSON(w, http.StatusOK, Response{Success: true, Data: list})
}
