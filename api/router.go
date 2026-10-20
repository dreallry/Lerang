package api

import "net/http"

func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/register", FirebaseIdentityRequired(RegisterMasyarakatRTDB))
	mux.HandleFunc("GET /api/auth/me", RtdbAuthenticated(MeRTDB))
	mux.HandleFunc("POST /api/auth/google-profile", FirebaseIdentityRequired(SyncGoogleProfileRTDB))

	mux.HandleFunc("POST /api/barang", RtdbRole(RoleMasyarakat)(SubmitBarangRTDB))
	mux.HandleFunc("GET /api/barang", ListCatalogRTDB)
	mux.HandleFunc("GET /api/barang/my", RtdbAuthenticated(GetMyItemsRTDB))
	mux.HandleFunc("GET /api/barang/{id}", GetDetailBarangRTDB)
	mux.HandleFunc("PUT /api/barang/{id}", RtdbAuthenticated(UpdateBarangInfoRTDB))
	mux.HandleFunc("DELETE /api/barang/{id}", RtdbAuthenticated(CancelSubmissionRTDB))
	mux.HandleFunc("GET /api/upload", GetUploadAvailabilityRTDB)
	mux.HandleFunc("POST /api/upload", RtdbAuthenticated(UploadFotoRTDB))
	mux.HandleFunc("GET /api/photos/{name}", ServeLotPhoto)

	mux.HandleFunc("GET /api/lelang", ListLelangRTDB)
	mux.HandleFunc("GET /api/lelang/history", ListAllHistoryRTDB)
	mux.HandleFunc("GET /api/lelang/{id}", DetailLelangRTDB)
	mux.HandleFunc("POST /api/lelang/{id}/bid", RtdbRole(RoleMasyarakat)(PlaceBidRTDB))
	mux.HandleFunc("POST /api/lelang/{id}/lock-deposit", RtdbRole(RoleMasyarakat)(LockDepositRTDB))
	mux.HandleFunc("PUT /api/lelang/{id}/auto-bid", RtdbRole(RoleMasyarakat)(SetAutoBidRTDB))
	mux.HandleFunc("DELETE /api/lelang/{id}/auto-bid", RtdbRole(RoleMasyarakat)(CancelAutoBidRTDB))

	mux.HandleFunc("GET /api/admin/pending-barang", RtdbRole(RoleAdministrator, RolePetugas)(ListPendingBarangRTDB))
	mux.HandleFunc("GET /api/admin/barang", RtdbRole(RoleAdministrator, RolePetugas)(ListAllItemsRTDB))
	mux.HandleFunc("GET /api/admin/lelang", RtdbRole(RoleAdministrator, RolePetugas)(ListAllLelangRTDB))
	mux.HandleFunc("POST /api/admin/barang/{id}/validasi", RtdbRole(RoleAdministrator, RolePetugas)(ValidateBarangRTDB))
	mux.HandleFunc("GET /api/admin/jadwal-harian", RtdbRole(RoleAdministrator, RolePetugas)(ListSchedulesRTDB))
	mux.HandleFunc("POST /api/admin/jadwal-harian", RtdbRole(RoleAdministrator, RolePetugas)(SetScheduleRTDB))
	mux.HandleFunc("GET /api/admin/kategori-durasi", RtdbRole(RoleAdministrator, RolePetugas)(ListCategoriesRTDB))
	mux.HandleFunc("POST /api/admin/kategori-durasi", RtdbRole(RoleAdministrator, RolePetugas)(SetCategoryRTDB))
	mux.HandleFunc("POST /api/admin/buka-serentak", RtdbRole(RoleAdministrator, RolePetugas)(OpenAuctionsRTDB))
	mux.HandleFunc("POST /api/admin/lelang", RtdbRole(RoleAdministrator, RolePetugas)(CreateOfficerAuctionRTDB))
	mux.HandleFunc("PATCH /api/admin/lelang/{id}/status", RtdbRole(RoleAdministrator, RolePetugas)(UpdateAuctionStatusRTDB))
	mux.HandleFunc("GET /api/admin/users", RtdbRole(RoleAdministrator)(ListUsersRTDB))
	mux.HandleFunc("GET /api/admin/staff", RtdbRole(RoleAdministrator)(ListStaffRTDB))
	mux.HandleFunc("GET /api/admin/payments", RtdbRole(RoleAdministrator, RolePetugas)(ListAdminPaymentsRTDB))
	mux.HandleFunc("POST /api/admin/payments/{orderID}/sync", RtdbRole(RoleAdministrator, RolePetugas)(SyncAdminPaymentRTDB))

	mux.HandleFunc("GET /api/pembayaran", RtdbAuthenticated(ListInvoicesRTDB))
	mux.HandleFunc("POST /api/pembayaran/snap", RtdbRole(RoleMasyarakat)(CreateSnapPaymentRTDB))
	mux.HandleFunc("POST /api/pembayaran/{orderID}/sync", RtdbRole(RoleMasyarakat)(SyncPaymentStatusRTDB))
	mux.HandleFunc("POST /api/midtrans/webhook", MidtransWebhookRTDB)
	mux.HandleFunc("GET /api/wallet", RtdbRole(RoleMasyarakat)(GetWalletRTDB))
	mux.HandleFunc("POST /api/wallet/withdraw", RtdbRole(RoleMasyarakat)(WithdrawWalletRTDB))
	mux.HandleFunc("GET /api/admin/withdrawals", RtdbRole(RoleAdministrator, RolePetugas)(ListWithdrawalsRTDB))
	mux.HandleFunc("POST /api/admin/withdrawals/{id}", RtdbRole(RoleAdministrator, RolePetugas)(ReviewWithdrawalRTDB))

	mux.HandleFunc("GET /api/fulfillment", RtdbAuthenticated(ListFulfillmentRTDB))
	mux.HandleFunc("GET /api/fulfillment/couriers", RtdbAuthenticated(ListCouriersRTDB))
	mux.HandleFunc("POST /api/fulfillment/{id}/courier", RtdbAuthenticated(UpdateFulfillmentCourierRTDB))
	mux.HandleFunc("POST /api/fulfillment/{id}/alamat", RtdbAuthenticated(UpdateFulfillmentAddressRTDB))
	mux.HandleFunc("POST /api/fulfillment/{id}/resi", RtdbRole(RoleAdministrator, RolePetugas)(UpdateFulfillmentResiRTDB))
	mux.HandleFunc("POST /api/fulfillment/{id}/shipping-payment", RtdbRole(RoleAdministrator, RolePetugas)(RecordShippingPaymentRTDB))
	mux.HandleFunc("POST /api/fulfillment/{id}/selesai", RtdbAuthenticated(FinishFulfillmentRTDB))

	mux.HandleFunc("GET /api/sesi", ListSesiRTDB)
	mux.HandleFunc("POST /api/sesi", RtdbRole(RoleAdministrator, RolePetugas)(CreateSessionRTDB))
	mux.HandleFunc("PUT /api/sesi/{id}/lots/{lelangId}", RtdbRole(RoleAdministrator, RolePetugas)(AssignSessionLotRTDB))
	mux.HandleFunc("DELETE /api/sesi/{id}/lots/{lelangId}", RtdbRole(RoleAdministrator, RolePetugas)(RemoveSessionLotRTDB))
	mux.HandleFunc("POST /api/sesi/{id}/cancel", RtdbRole(RoleAdministrator, RolePetugas)(CancelSessionRTDB))
	mux.HandleFunc("GET /api/themes", ListThemesRTDB)
	mux.HandleFunc("GET /api/notifikasi", RtdbAuthenticated(ListNotificationsRTDB))
	mux.HandleFunc("POST /api/notifikasi/{id}/read", RtdbAuthenticated(MarkNotificationReadRTDB))
	mux.HandleFunc("POST /api/notifikasi/read-all", RtdbAuthenticated(MarkNotificationReadRTDB))
	mux.HandleFunc("GET /api/health", health)
	return secureHeaders(CORS(mux))
}

func health(w http.ResponseWriter, r *http.Request) {
	ready := FirebaseDatabaseReady() && FirebaseReady() && MidtransReady()
	status := "ok"
	if !ready {
		status = "degraded"
	}
	JSON(w, http.StatusOK, map[string]interface{}{
		"status": status, "server": "Golang Native", "db": FirebaseDatabaseReady(),
		"firebase": FirebaseReady(), "firebase_storage": FirebaseStorageReady(),
		"photo_uploads":     FirebaseStorageReady() || photoRoot != nil,
		"realtime_database": FirebaseDatabaseReady(), "midtrans": MidtransReady(), "midtrans_env": MidtransEnvironment(),
		"check_scope": "configuration_only; use npm run check:firebase and npm run check:payments to verify service access",
	})
}
