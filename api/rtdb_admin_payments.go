package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
)

func ListAdminPaymentsRTDB(w http.ResponseWriter, r *http.Request) {
	status, query := r.URL.Query().Get("status"), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if len(query) > 100 {
		Error(w, 400, "Pencarian pembayaran maksimal 100 karakter")
		return
	}
	if status != "" && status != "pending" && status != "paid" && status != "failed" && status != "review_required" {
		Error(w, 400, "Filter status pembayaran tidak valid")
		return
	}
	page := 1
	if text := r.URL.Query().Get("page"); text != "" {
		var err error
		page, err = strconv.Atoi(text)
		if err != nil || page < 1 || page > 100000 {
			Error(w, 400, "Halaman atau pencarian pembayaran tidak valid")
			return
		}
	}
	orders, err := rtdbCollection(r.Context(), "paymentOrders")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	rows := make([]map[string]interface{}, 0)
	counts := map[string]int{"pending": 0, "paid": 0, "failed": 0, "review_required": 0}
	for key, order := range orders {
		if order == nil {
			continue
		}
		id := stringValue(order["order_id"], key)
		if query != "" && !strings.Contains(strings.ToLower(id), query) && !strings.Contains(strconv.Itoa(rtdbNumericID(order["id_user"])), query) {
			continue
		}
		state := stringValue(order["status"], "review_required")
		if _, known := counts[state]; !known {
			state = "review_required"
		}
		amount, amountErr := storedPaymentAmount(order["amount"])
		if amountErr != nil || order["review_required"] == true {
			state = "review_required"
		}
		counts[state]++
		if status != "" && state != status {
			continue
		}
		// Explicit fields keep Snap tokens, owner UIDs, and reservation details on the server.
		row := map[string]interface{}{"order_id": id, "amount": amount, "amount_valid": amountErr == nil, "status": state}
		for _, field := range []string{"id_user", "id_pembayaran", "kind", "created_at", "updated_at", "paid_at", "gateway_status", "last_checked_at", "last_check_error", "review_reason"} {
			row[field] = order[field]
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := stringValue(rows[i]["created_at"], ""), stringValue(rows[j]["created_at"], "")
		if a == b {
			return stringValue(rows[i]["order_id"], "") < stringValue(rows[j]["order_id"], "")
		}
		return a > b
	})
	const size = 20
	total := len(rows)
	pages := (total + size - 1) / size
	if pages < 1 {
		pages = 1
	}
	if page > pages {
		page = pages
	}
	start, end := (page-1)*size, page*size
	if end > total {
		end = total
	}
	JSON(w, 200, Response{Success: true, Data: map[string]interface{}{"rows": rows[start:end], "total": total, "page": page, "pages": pages, "counts": counts, "is_production": midtransProduction()}})
}

func SyncAdminPaymentRTDB(w http.ResponseWriter, r *http.Request) {
	syncPaymentStatus(w, r, true)
}
