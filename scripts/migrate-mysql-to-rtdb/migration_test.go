package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func migrationFixture() map[string][]record {
	return map[string][]record{
		"tb_masyarakat":       {{Key: "3", Value: map[string]any{"id_user": 3, "firebase_uid": "old-project-uid", "email": "owner@example.invalid", "password": "never-copy", "saldo_wallet": 250000, "saldo_hold": 100000}}},
		"tb_petugas":          {{Key: "2", Value: map[string]any{"id_petugas": 2, "id_level": 2, "password": "never-copy"}}},
		"tb_barang":           {{Key: "7", Value: map[string]any{"id_barang": 7, "id_user": 3, "status_verifikasi": "approved", "foto_barang": []any{"https://example.invalid/item.jpg"}}}},
		"tb_lelang":           {{Key: "4", Value: map[string]any{"id_lelang": 4, "id_barang": 7, "id_sesi": 2, "id_user": 3, "tgl_mulai": "2026-08-28T02:00:00Z", "tgl_selesai": "2026-08-28T10:00:00Z", "status": "dibuka", "harga_akhir": 1200000}}},
		"tb_histori_lelang":   {{Key: "11", Value: map[string]any{"id_history": 11, "id_lelang": 4, "id_barang": 7, "id_user": 3, "penawaran_harga": 1200000}}},
		"tb_notifikasi":       {{Key: "notice-1", Value: map[string]any{"id_notifikasi": "notice-1", "id_user": 3}}},
		"tb_transaksi_wallet": {{Key: "wallet-1", Value: map[string]any{"id_transaksi": "wallet-1", "id_user": 3, "tipe": "hold", "nominal": 100000, "status": "sukses"}}},
		"tb_pembayaran":       {{Key: "1", Value: map[string]any{"id_pembayaran": 1, "id_lelang": 4, "id_user": 3, "status": "Belum Dibayar", "sisa_tagihan": 1100000}}},
		"tb_pengiriman":       {{Key: "F-1", Value: map[string]any{"id_fulfillment": "F-1", "id_pembayaran": 1, "id_lelang": 4, "id_user_pembeli": 3, "status": "dikirim"}}},
		"tb_sesi_lelang":      {{Key: "2", Value: map[string]any{"id_sesi": 2, "tgl_mulai": "2026-08-28T02:00:00Z", "status": "live"}}},
	}
}

func fixturePlan(t *testing.T, identities map[string]string) ([]entry, migrationReport) {
	t.Helper()
	now, _ := time.Parse(time.RFC3339, "2026-10-19T00:00:00Z")
	plan, report, err := buildPlan(migrationFixture(), identities, now, "source-checksum")
	if err != nil {
		t.Fatal(err)
	}
	return plan, report
}

func planRoot(plan []entry) map[string]any {
	root := map[string]any{}
	for _, row := range plan {
		setPath(root, strings.Split(row.Path, "/"), row.Value)
	}
	return root
}

func TestMigrationKeepsExpiredDataHistoricalWithoutFinancialEffects(t *testing.T) {
	plan, report := fixturePlan(t, map[string]string{})
	root := planRoot(plan)
	if report.HistoricalAuctions != 1 || report.LegacyUsers != 1 || report.LegacyStaff != 1 {
		t.Fatalf("unexpected counts: %+v", report)
	}
	auction := lookupPath(root, "auctions/4").(map[string]any)
	if auction["status"] != "ditutup" || auction["legacy_status"] != "dibuka" || auction["legacy_historical"] != true || auction["harga_akhir"] != 1200000 {
		t.Fatal("expired auction reopened, lost history, or recalculated price")
	}
	profile := lookupPath(root, "legacy_users/3").(map[string]any)
	if profile["saldo_wallet"] != 250000 || profile["saldo_hold"] != 100000 || profile["firebase_uid"] != nil || profile["password"] != nil {
		t.Fatal("legacy financial state or identity isolation changed")
	}
	if lookupPath(root, "users") != nil || lookupPath(root, "user_ids") != nil || lookupPath(root, "depositHolds") != nil {
		t.Fatal("migration fabricated an active identity or deposit ledger")
	}
	if lookupPath(root, "bids/4/11") == nil || lookupPath(root, "bidHistory") != nil {
		t.Fatal("bid history is not in the API collection")
	}
	if lookupPath(root, "invoices/1/legacy_historical") != true || lookupPath(root, "invoices/1/sisa_tagihan") != 1100000 || lookupPath(root, "fulfillments/F-1/status") != "dikirim" {
		t.Fatal("historical invoice/fulfillment was processed rather than preserved")
	}
	if !equalValue(lookupPath(root, "sessions/2/id_lelang_list"), []int{4}) || lookupPath(root, "sessions/2/status") != "closed" {
		t.Fatal("session relationships/status were not converted")
	}
	if numericID(lookupPath(root, "_counters/users")) != 3 || numericID(lookupPath(root, "_counters/staff")) != 2 || numericID(lookupPath(root, "_counters/bids")) != 11 {
		t.Fatal("counters do not reserve legacy IDs")
	}
	if lookupPath(root, "legacy_notifications/3/notice-1/id") != "notice-1" || lookupPath(root, "legacy_walletTransactions/3/wallet-1/id") != "wallet-1" {
		t.Fatal("legacy account records are not grouped by their stable owner ID")
	}
	if report.Warnings["fulfillment_with_unpaid_legacy_invoice"] != 1 || report.Warnings["legacy_hold_without_per_lot_ledger"] != 1 {
		t.Fatal("financial discrepancies were not reported")
	}
}

func TestMigrationRequiresAuthUIDAndEmailMatch(t *testing.T) {
	plan, report := fixturePlan(t, map[string]string{"old-project-uid": "different@example.invalid"})
	if report.LegacyUsers != 1 || lookupPath(planRoot(plan), "users/old-project-uid") != nil {
		t.Fatal("a UID from another identity was trusted")
	}
	plan, report = fixturePlan(t, map[string]string{"old-project-uid": "owner@example.invalid"})
	root := planRoot(plan)
	if report.LegacyUsers != 0 || lookupPath(root, "user_ids/3") != "old-project-uid" || lookupPath(root, "walletTransactions/old-project-uid/wallet-1") == nil {
		t.Fatal("verified same-project identity/owner mapping was not retained")
	}
}

func TestMigrationRerunPreservesCountersAndDetectsLiveConflicts(t *testing.T) {
	plan, _ := fixturePlan(t, map[string]string{})
	root := planRoot(plan)
	setPath(root, []string{"_counters", "users"}, 100)
	bytes, _ := json.Marshal(root)
	var roundTrip map[string]any
	_ = json.Unmarshal(bytes, &roundTrip)
	status := inspectPlan(roundTrip, plan)
	if status.Added != 0 || len(status.Conflicts) != 0 || status.Existing != len(plan) {
		t.Fatalf("identical rerun or advanced counter conflicts: %+v", status)
	}
	setPath(roundTrip, []string{"items", "7", "status_verifikasi"}, "rejected")
	status = inspectPlan(roundTrip, plan)
	if len(status.Conflicts) != 1 || status.Conflicts[0].Collection != "items" {
		t.Fatal("changed live record was not protected")
	}
	setPath(roundTrip, []string{"users", "unrelated-active-uid"}, map[string]any{"id_user": 3, "saldo_wallet": 999})
	if len(inspectPlan(roundTrip, plan).Conflicts) != 2 {
		t.Fatal("numeric legacy ID collision with a live user was not protected")
	}
}

func TestMigrationHandlesFirebaseNumericCollectionsAndEmptyFields(t *testing.T) {
	root := map[string]any{"items": []any{nil, map[string]any{"id_barang": float64(1)}}}
	setPath(root, []string{"items", "2"}, map[string]any{"id_barang": 2})
	if lookupPath(root, "items/1/id_barang") != float64(1) || lookupPath(root, "items/2/id_barang") != 2 {
		t.Fatal("numeric collection conversion overwrote an existing record")
	}
	if !equalValue(map[string]any{"list": []int{}, "optional": nil, "price": 1}, map[string]any{"price": float64(1)}) {
		t.Fatal("empty/null Firebase fields cause false conflicts")
	}
}

func TestSourceNormalizationRejectsCorruptionAndPreservesTimezone(t *testing.T) {
	location, _ := time.LoadLocation("Asia/Jakarta")
	value, err := normalizeValue([]byte("2026-08-28 09:00:00"), "tgl_mulai", "DATETIME", nil, location)
	if err != nil || value != "2026-08-28T02:00:00Z" {
		t.Fatalf("DATETIME timezone changed: %v %v", value, err)
	}
	value, err = normalizeValue([]byte("2026-08-28 09:00:00"), "created_at", "TIMESTAMP", nil, location)
	if err != nil || value != "2026-08-28T09:00:00Z" {
		t.Fatal("TIMESTAMP did not remain UTC")
	}
	for _, text := range []string{"[broken", "{}"} {
		if _, err := normalizeValue([]byte(text), "foto_barang", "LONGTEXT", jsonSet("foto_barang"), location); err == nil {
			t.Fatal("corrupt or nonlist photos were accepted")
		}
	}
	if _, err := stableKey("x/y"); err == nil {
		t.Fatal("key collision was silently normalized")
	}
}

func TestMigrationRejectsOrphanHistoryBeforeAnyWrite(t *testing.T) {
	source := migrationFixture()
	source["tb_histori_lelang"][0].Value["id_lelang"] = 999
	if _, _, err := buildPlan(source, nil, time.Now(), "source"); err == nil {
		t.Fatal("orphan history was accepted")
	}
}

func TestMigrationRemapsOnlyCollidingUsersAndEveryForeignKey(t *testing.T) {
	source := migrationFixture()
	root := map[string]any{"users": map[string]any{"live": map[string]any{"id_user": 3, "saldo_wallet": 777}}}
	if _, _, err := remapLegacyUsers(source, root, "source", false); err == nil {
		t.Fatal("collision was changed without an explicit remap policy")
	}
	changed, mapping, err := remapLegacyUsers(source, root, "source", true)
	if err != nil {
		t.Fatal(err)
	}
	if mapping["3"] != 4 || numericID(changed["tb_masyarakat"][0].Value["id_user"]) != 4 || changed["tb_masyarakat"][0].Key != "4" || numericID(source["tb_masyarakat"][0].Value["id_user"]) != 3 {
		t.Fatal("source IDs or new mapping are incorrect")
	}
	if err := validateRelations(changed); err != nil {
		t.Fatal(err)
	}
	setPath(root, []string{"migrationMeta", "mysqlToRtdb", "runs", "source", "user_id_mapping"}, map[string]any{"3": 4})
	_, again, err := remapLegacyUsers(source, root, "source", false)
	if err != nil || again["3"] != 4 {
		t.Fatal("rerun did not preserve the committed ID mapping")
	}
}
