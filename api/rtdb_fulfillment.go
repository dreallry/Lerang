package api

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

const pickupCourier = "Ambil di balai lelang"
const pickupService = "Pengambilan oleh pemenang atau penerima yang disetujui"

func ListFulfillmentRTDB(w http.ResponseWriter, r *http.Request) {
	claims := rtdbClaimsFromRequest(r)
	values, err := rtdbCollection(r.Context(), "fulfillments")
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	list := make([]map[string]interface{}, 0)
	for _, value := range values {
		if value == nil {
			continue
		}
		delete(value, "shipping_paid_by")
		if claims.Role != RoleMasyarakat || rtdbNumericID(value["id_user_pembeli"]) == claims.ID || rtdbNumericID(value["id_user_penjual"]) == claims.ID {
			if value["tracking_history"] == nil {
				value["tracking_history"] = []interface{}{}
			}
			list = append(list, value)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return stringValue(list[i]["tgl_update"], "") > stringValue(list[j]["tgl_update"], "")
	})
	JSON(w, 200, Response{Success: true, Data: list})
}

func fulfillmentInvoice(root map[string]interface{}, id string) (map[string]interface{}, map[string]interface{}, error) {
	order := treeRecord(root, "fulfillments", id)
	if order == nil {
		return nil, nil, domainError(404, "Pesanan tidak ditemukan")
	}
	if order["legacy_historical"] == true {
		return nil, nil, domainError(409, "Pengiriman historis perlu ditinjau pengelola sebelum diubah")
	}
	var invoice map[string]interface{}
	for _, value := range treeMap(root["invoices"]) {
		row := treeMap(value)
		if rtdbNumericID(row["id_pembayaran"]) == rtdbNumericID(order["id_pembayaran"]) {
			invoice = row
			break
		}
	}
	if invoice == nil || invoice["legacy_historical"] == true || invoice["payment_review_required"] == true || stringValue(invoice["status"], "") != "Sudah Dibayar" {
		return nil, nil, domainError(409, "Tagihan belum lunas atau memerlukan pemeriksaan pembayaran")
	}
	if rtdbNumericID(invoice["id_user"]) != rtdbNumericID(order["id_user_pembeli"]) || rtdbNumericID(invoice["id_barang"]) != rtdbNumericID(order["id_barang"]) || rtdbNumericID(invoice["id_lelang"]) != rtdbNumericID(order["id_lelang"]) {
		return nil, nil, domainError(409, "Relasi pengiriman dan tagihan perlu diperiksa")
	}
	item := treeRecord(root, "items", rtdbPathID(rtdbNumericID(order["id_barang"])))
	if item == nil || rtdbNumericID(order["id_user_penjual"]) != rtdbNumericID(invoice["id_user_penjual"]) || rtdbNumericID(order["id_user_penjual"]) != rtdbNumericID(item["id_user"]) {
		return nil, nil, domainError(409, "Identitas penjual pada barang dan tagihan perlu diperiksa")
	}
	if escrow := stringValue(invoice["escrow_status"], ""); escrow != "held" && escrow != "released" {
		return nil, nil, domainError(409, "Pencatatan dana pembayaran perlu diperiksa pengelola")
	}
	return order, invoice, nil
}

func completeShippingRecipient(order map[string]interface{}) bool {
	for _, field := range []string{"nama_penerima", "telp_penerima", "alamat_lengkap", "kota"} {
		if strings.TrimSpace(stringValue(order[field], "")) == "" {
			return false
		}
	}
	code := stringValue(order["kode_pos"], "")
	return len(code) == 5 && strings.Trim(code, "0123456789") == ""
}

func checkFulfillmentRevision(order map[string]interface{}, expected *string) error {
	if expected == nil {
		return domainError(400, "Versi pengiriman wajib disertakan. Muat ulang data sebelum menyimpan")
	}
	if *expected != stringValue(order["tgl_update"], "") {
		return domainError(409, "Data pengiriman sudah berubah. Muat ulang dan periksa penerima, tujuan, serta ongkir sebelum menyimpan kembali")
	}
	return nil
}

func appendTracking(order map[string]interface{}, status, description string, now time.Time) {
	history, _ := order["tracking_history"].([]interface{})
	if history == nil {
		history = []interface{}{}
	}
	revision := nextRevision(stringValue(order["tgl_update"], ""), now)
	order["status"], order["tgl_update"] = status, revision
	order["tracking_history"] = append([]interface{}{map[string]interface{}{"status": status, "deskripsi": description, "waktu": revision}}, history...)
}

func UpdateFulfillmentAddressRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Nama              string  `json:"nama_penerima"`
		Telp              string  `json:"telp_penerima"`
		Alamat            string  `json:"alamat_lengkap"`
		Kota              string  `json:"kota"`
		Kode              string  `json:"kode_pos"`
		ExpectedUpdatedAt *string `json:"expected_updated_at"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	req.Nama, req.Telp, req.Alamat, req.Kota, req.Kode = strings.TrimSpace(req.Nama), strings.TrimSpace(req.Telp), strings.TrimSpace(req.Alamat), strings.TrimSpace(req.Kota), strings.TrimSpace(req.Kode)
	if req.Nama == "" || req.Telp == "" || len(req.Nama) > 100 || len(req.Alamat) > 1000 || len(req.Kota) > 100 || len(req.Telp) > 25 {
		Error(w, 400, "Nama, telepon, alamat, kota, dan kode pos 5 digit wajib diisi dengan benar")
		return
	}
	claims, id := rtdbClaimsFromRequest(r), r.PathValue("id")
	var updatedAt string
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		order, _, err := fulfillmentInvoice(root, id)
		if err != nil {
			return err
		}
		if claims.Role == RoleMasyarakat && rtdbNumericID(order["id_user_pembeli"]) != claims.ID {
			return domainError(403, "Hanya pembeli yang dapat mengisi alamat")
		}
		if err := checkFulfillmentRevision(order, req.ExpectedUpdatedAt); err != nil {
			return err
		}
		defer func() { updatedAt = stringValue(order["tgl_update"], "") }()
		state := stringValue(order["status"], "")
		if state != "menunggu_alamat" && state != "dikemas" {
			return domainError(409, "Alamat tidak dapat diubah setelah barang dikirim")
		}
		if order["kurir"] != pickupCourier && (req.Alamat == "" || req.Kota == "" || len(req.Kode) != 5 || strings.Trim(req.Kode, "0123456789") != "") {
			return domainError(400, "Ekspedisi memerlukan alamat, kota, dan kode pos 5 digit")
		}
		changed := order["nama_penerima"] != req.Nama || order["telp_penerima"] != req.Telp || order["alamat_lengkap"] != req.Alamat || order["kota"] != req.Kota || order["kode_pos"] != req.Kode
		if !changed {
			return nil
		}
		if order["shipping_payment_status"] == "paid_manual" {
			return domainError(409, "Ongkir sudah dicatat dibayar. Hubungi petugas sebelum mengubah alamat")
		}
		if order["kurir"] != pickupCourier {
			order["kurir"], order["layanan_kurir"], order["ongkir"], order["shipping_payment_status"] = nil, nil, nil, nil
		}
		order["nama_penerima"], order["telp_penerima"], order["alamat_lengkap"], order["kota"], order["kode_pos"] = req.Nama, req.Telp, req.Alamat, req.Kota, req.Kode
		appendTracking(order, "dikemas", "Alamat penerima tersimpan. Menunggu penyiapan barang oleh petugas.", now)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Alamat pengiriman tersimpan", Data: map[string]interface{}{"updated_at": updatedAt}})
}

func ListCouriersRTDB(w http.ResponseWriter, r *http.Request) {
	JSON(w, 200, Response{Success: true, Data: []map[string]interface{}{{"id": "self_pickup", "name": pickupCourier, "service": pickupService, "price": 0, "eta": "Sesuai kesepakatan dengan petugas", "desc": "Tidak ada biaya pengiriman. Untuk ekspedisi, petugas menyiapkan penawaran biaya dan instruksi pembayaran secara terpisah."}}})
}

func UpdateFulfillmentCourierRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kurir             string  `json:"kurir"`
		Layanan           string  `json:"layanan_kurir"`
		Ongkir            float64 `json:"ongkir"`
		ExpectedUpdatedAt *string `json:"expected_updated_at"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	claims, id := rtdbClaimsFromRequest(r), r.PathValue("id")
	req.Kurir, req.Layanan = strings.TrimSpace(req.Kurir), strings.TrimSpace(req.Layanan)
	if !wholeRupiah(req.Ongkir, 0) || strings.TrimSpace(req.Kurir) == "" || strings.TrimSpace(req.Layanan) == "" || len(req.Kurir) > 100 || len(req.Layanan) > 200 {
		Error(w, 400, "Layanan atau biaya pengiriman belum valid")
		return
	}
	var updatedAt string
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		order, _, err := fulfillmentInvoice(root, id)
		if err != nil {
			return err
		}
		status := stringValue(order["status"], "")
		if status != "menunggu_alamat" && status != "dikemas" {
			return domainError(409, "Layanan tidak dapat diganti setelah pengiriman")
		}
		if claims.Role == RoleMasyarakat {
			if rtdbNumericID(order["id_user_pembeli"]) != claims.ID {
				return domainError(403, "Pesanan bukan milik pembeli ini")
			}
			if req.Kurir != pickupCourier || req.Ongkir != 0 || req.Layanan != pickupService {
				return domainError(403, "Pembeli hanya dapat memilih layanan pengambilan yang disediakan server")
			}
		} else if err := sessionStaff(claims); err != nil {
			return err
		}
		if err := checkFulfillmentRevision(order, req.ExpectedUpdatedAt); err != nil {
			return err
		}
		defer func() { updatedAt = stringValue(order["tgl_update"], "") }()
		if req.Kurir == pickupCourier && (req.Ongkir != 0 || req.Layanan != pickupService) {
			return domainError(400, "Pengambilan mandiri tidak memiliki ongkir")
		}
		if req.Kurir != pickupCourier && !completeShippingRecipient(order) {
			return domainError(409, "Lengkapi penerima, telepon, alamat, kota, dan kode pos sebelum memberi penawaran ekspedisi")
		}
		if order["kurir"] == req.Kurir && order["layanan_kurir"] == req.Layanan && numberValue(order["ongkir"]) == req.Ongkir {
			return nil
		}
		if order["shipping_payment_status"] == "paid_manual" {
			return domainError(409, "Penawaran ongkir yang sudah dibayar tidak dapat ditimpa")
		}
		order["kurir"], order["layanan_kurir"], order["ongkir"], order["shipping_payment_status"] = strings.TrimSpace(req.Kurir), strings.TrimSpace(req.Layanan), req.Ongkir, "not_required"
		if req.Ongkir > 0 {
			order["shipping_payment_status"] = "arrange_with_staff"
		}
		appendTracking(order, status, "Layanan pengambilan atau penawaran ekspedisi tersimpan. Biaya ekspedisi belum dianggap lunas otomatis.", now)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Layanan pengiriman tersimpan", Data: map[string]interface{}{"updated_at": updatedAt}})
}

func RecordShippingPaymentRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reference         string  `json:"reference"`
		Amount            float64 `json:"amount"`
		Courier           string  `json:"courier"`
		Service           string  `json:"service"`
		ExpectedUpdatedAt *string `json:"expected_updated_at"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format bukti ongkir tidak valid")
		return
	}
	req.Reference = strings.TrimSpace(req.Reference)
	if len(req.Reference) < 4 || len(req.Reference) > 200 || !wholeRupiah(req.Amount, 1) {
		Error(w, 400, "Isi referensi bukti dan nominal ongkir yang sesuai")
		return
	}
	claims := rtdbClaimsFromRequest(r)
	var updatedAt string
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		if err := sessionStaff(claims); err != nil {
			return err
		}
		order, _, err := fulfillmentInvoice(root, r.PathValue("id"))
		if err != nil {
			return err
		}
		if err := checkFulfillmentRevision(order, req.ExpectedUpdatedAt); err != nil {
			return err
		}
		defer func() { updatedAt = stringValue(order["tgl_update"], "") }()
		if order["shipping_payment_status"] == "paid_manual" {
			if order["shipping_payment_reference"] == req.Reference && numberValue(order["ongkir"]) == req.Amount && order["kurir"] == req.Courier && order["layanan_kurir"] == req.Service {
				return nil
			}
			return domainError(409, "Pembayaran ongkir sudah dicatat; bukti tidak dapat ditimpa")
		}
		if order["status"] != "dikemas" || order["shipping_payment_status"] != "arrange_with_staff" || numberValue(order["ongkir"]) != req.Amount || order["kurir"] != req.Courier || order["layanan_kurir"] != req.Service {
			return domainError(409, "Penawaran berubah atau pesanan belum siap. Muat ulang sebelum mencatat bukti")
		}
		order["shipping_payment_status"], order["shipping_payment_reference"], order["shipping_paid_at"], order["shipping_paid_by"] = "paid_manual", req.Reference, now.UTC().Format(time.RFC3339Nano), claims.UID
		appendTracking(order, "dikemas", "Petugas mencatat bukti ongkir diterima: "+req.Reference, now)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Bukti ongkir tercatat. Saldo dan tagihan lelang tidak diubah", Data: map[string]interface{}{"updated_at": updatedAt}})
}

func UpdateFulfillmentResiRTDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Resi              string  `json:"nomor_resi"`
		Status            string  `json:"status"`
		Description       string  `json:"deskripsi"`
		ExpectedUpdatedAt *string `json:"expected_updated_at"`
	}
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	if req.Status == "" {
		req.Status = "dikirim"
	}
	req.Resi, req.Description = strings.TrimSpace(req.Resi), strings.TrimSpace(req.Description)
	if len(req.Resi) > 100 || len(req.Description) > 1000 {
		Error(w, 400, "Catatan pengiriman terlalu panjang")
		return
	}
	claims, id := rtdbClaimsFromRequest(r), r.PathValue("id")
	var updatedAt string
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		now := time.Now()
		if err := sessionStaff(claims); err != nil {
			return err
		}
		order, _, err := fulfillmentInvoice(root, id)
		if err != nil {
			return err
		}
		if err := checkFulfillmentRevision(order, req.ExpectedUpdatedAt); err != nil {
			return err
		}
		defer func() { updatedAt = stringValue(order["tgl_update"], "") }()
		current := stringValue(order["status"], "")
		resi := req.Resi
		if resi == "" {
			resi = stringValue(order["nomor_resi"], "")
		}
		if current == req.Status && stringValue(order["nomor_resi"], "") == resi {
			history, _ := order["tracking_history"].([]interface{})
			if req.Description == "" || len(history) > 0 && treeMap(history[0])["deskripsi"] == req.Description {
				return nil
			}
		}
		pickup := order["kurir"] == pickupCourier
		valid := current == "dikemas" && req.Status == "dikirim" && !pickup || current == "dikirim" && req.Status == "diterima" || current == "dikemas" && req.Status == "diterima" && pickup && numberValue(order["ongkir"]) == 0 || current == req.Status && (current == "dikemas" || current == "dikirim") && req.Description != ""
		if !valid {
			return domainError(409, "Urutan status pengiriman tidak valid")
		}
		if pickup && req.Status == "diterima" && (req.Description == "" || stringValue(order["nama_penerima"], "") == "" || stringValue(order["telp_penerima"], "") == "") {
			return domainError(400, "Isi penerima, kontak, dan catatan serah terima untuk pengambilan mandiri")
		}
		if req.Status == "dikirim" && numberValue(order["ongkir"]) > 0 && order["shipping_payment_status"] != "paid_manual" {
			return domainError(409, "Catat bukti ongkir diterima sebelum menyerahkan barang ke ekspedisi")
		}
		if req.Status == "dikirim" && (resi == "" || !completeShippingRecipient(order) || stringValue(order["kurir"], "") == "" || stringValue(order["layanan_kurir"], "") == "") {
			return domainError(400, "Data penerima lengkap, layanan kurir, dan nomor resi asli wajib tersedia sebelum barang dikirim")
		}
		if resi != "" {
			order["nomor_resi"] = resi
		}
		if req.Description == "" {
			req.Description = "Status pengiriman diperbarui petugas: " + req.Status
		}
		appendTracking(order, req.Status, req.Description, now)
		notifyUser(root, stringValue(order["buyer_uid"], userUID(root, rtdbNumericID(order["id_user_pembeli"]))), "ship-"+id+"-"+req.Status, "Status pengiriman", req.Description, "info", "fulfillment", now)
		return nil
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Status pengiriman tersimpan", Data: map[string]interface{}{"updated_at": updatedAt}})
}

func completeFulfillment(root map[string]interface{}, claims *RTDBClaims, id string, rating int, review string, now time.Time) error {
	order, invoice, err := fulfillmentInvoice(root, id)
	if err != nil {
		return err
	}
	if claims == nil || claims.Role != RoleMasyarakat || rtdbNumericID(order["id_user_pembeli"]) != claims.ID {
		return domainError(403, "Hanya pembeli yang dapat mengonfirmasi penerimaan")
	}
	if stringValue(order["status"], "") == "selesai" {
		return nil
	}
	state := stringValue(order["status"], "")
	if state != "dikirim" && state != "diterima" {
		return domainError(409, "Pesanan belum dikirim atau diserahkan")
	}
	if rating < 1 || rating > 5 || len(review) > 2000 {
		return domainError(400, "Rating harus 1 sampai 5 dan ulasan maksimal 2000 karakter")
	}
	sellerID := rtdbNumericID(order["id_user_penjual"])
	sellerUID := userUID(root, sellerID)
	if sellerID > 0 && sellerUID == "" {
		return domainError(409, "Identitas penjual belum tertaut; pengelola perlu meninjau pencairan")
	}
	if stringValue(invoice["escrow_status"], "") != "released" {
		net, netOK := storedRupiah(invoice["dana_penjual_diterima"])
		total, totalOK := storedRupiah(invoice["total_keseluruhan"])
		hammer, hammerOK := storedRupiah(invoice["jumlah_pembayaran"])
		premium, premiumOK := storedRupiah(invoice["premi_pembeli"])
		commission, commissionOK := storedRupiah(invoice["biaya_komisi_platform"])
		if !netOK || !totalOK || !hammerOK || !premiumOK || !commissionOK || hammer <= 0 || commission > hammer || net != hammer-commission || total != hammer+premium {
			return domainError(409, "Nominal pencairan penjual belum valid")
		}
		if sellerUID != "" {
			profile := treeRecord(root, "users", sellerUID)
			if profile["financial_review_required"] == true || !validStoredBalance(profile) || !wholeRupiah(numberValue(profile["saldo_wallet"])+numberValue(profile["saldo_hold"])+net, 0) {
				return domainError(409, "Saldo penjual perlu ditinjau sebelum hasil penjualan dicairkan")
			}
			profile["saldo_wallet"] = numberValue(profile["saldo_wallet"]) + net
			recordWallet(root, sellerUID, "payout-"+id, "payout_c2c", net, "Hasil titip jual setelah konfirmasi penerimaan", id, now)
		}
		platform := treeNode(root, "platformLedger")
		fee := total - net
		if sellerUID == "" {
			fee = total
		}
		platform["invoice-"+rtdbPathID(rtdbNumericID(invoice["id_pembayaran"]))] = map[string]interface{}{"nominal": math.Max(0, fee), "created_at": now.UTC().Format(time.RFC3339Nano), "tipe": "auction_revenue"}
		invoice["escrow_status"], invoice["released_at"] = "released", now.UTC().Format(time.RFC3339Nano)
	}
	order["rating"], order["ulasan"] = rating, strings.TrimSpace(review)
	appendTracking(order, "selesai", "Pembeli mengonfirmasi barang diterima. Hasil penjual dicatat sesuai tagihan.", now)
	return nil
}

func FinishFulfillmentRTDB(w http.ResponseWriter, r *http.Request) {
	var req SelesaikanOrderRequest
	if err := DecodeJSON(r, &req); err != nil {
		Error(w, 400, "Format JSON tidak valid")
		return
	}
	err := rtdbTransaction(r.Context(), func(root map[string]interface{}) error {
		return completeFulfillment(root, rtdbClaimsFromRequest(r), r.PathValue("id"), req.Rating, req.Ulasan, time.Now())
	})
	if err != nil {
		rtdbJSONError(w, err)
		return
	}
	JSON(w, 200, Response{Success: true, Message: "Penerimaan dan hasil penjual tersimpan"})
}
