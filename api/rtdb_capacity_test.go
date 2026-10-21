package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"
)

// Delayed ETag snapshots reproduce overlapping REST transactions without production data.
func capacityFixture(t *testing.T, firstRead ...func()) (*atomic.Int32, *atomic.Int32) {
	t.Helper()
	var mu sync.Mutex
	root := map[string]interface{}{"count": 0, "items": map[string]interface{}{"1": map[string]interface{}{"nama_barang": "fixture"}}, "users": map[string]interface{}{"reader": map[string]interface{}{"id_user": 1}}}
	version := 1
	var reads, writes atomic.Int32
	secondRead := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		etag := fmt.Sprintf(`"v%d"`, version)
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			n := reads.Add(1)
			var value interface{} = root
			for _, part := range strings.Split(strings.Trim(strings.TrimSuffix(r.URL.Path, ".json"), "/"), "/") {
				if part != "" {
					value = treeMap(value)[part]
				}
			}
			data, _ := json.Marshal(value)
			mu.Unlock()
			if n == 2 {
				close(secondRead)
			}
			if n == 1 {
				if len(firstRead) > 0 {
					firstRead[0]()
				}
				select {
				case <-secondRead:
				case <-time.After(20 * time.Millisecond):
				}
			}
			w.Write(data)
			return
		}
		defer mu.Unlock()
		writes.Add(1)
		if r.Header.Get("If-Match") != etag {
			w.WriteHeader(http.StatusPreconditionFailed)
			json.NewEncoder(w).Encode(root)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&root); err != nil {
			t.Error(err)
		}
		version++
		json.NewEncoder(w).Encode(root)
	}))
	t.Cleanup(server.Close)
	t.Setenv("FIREBASE_DATABASE_EMULATOR_HOST", strings.Replace(server.URL, "http://127.0.0.1", "localhost", 1)+"?ns=capacity-fixture")
	app, err := firebase.NewApp(context.Background(), &firebase.Config{ProjectID: "capacity-fixture", DatabaseURL: "https://capacity-fixture.firebaseio.com"}, option.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatal(err)
	}
	client, err := app.Database(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	previous := firebaseDatabaseClient
	firebaseDatabaseClient = client
	t.Cleanup(func() { firebaseDatabaseClient = previous })
	return &reads, &writes
}

func TestRTDBOneHundredConcurrentWritesKeepEveryMutation(t *testing.T) {
	_, writes := capacityFixture(t)
	started := time.Now()
	var wg sync.WaitGroup
	var failures atomic.Int32
	start := make(chan struct{})
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := rtdbTransaction(ctx, func(root map[string]interface{}) error {
				root["count"] = numberValue(root["count"]) + 1
				return nil
			}); err != nil {
				failures.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	var count float64
	if err := rtdbGet(context.Background(), "count", &count); err != nil {
		t.Fatal(err)
	}
	t.Logf("100 concurrent local SDK transactions: errors=%d, PUT attempts=%d, committed=%.0f, elapsed=%s", failures.Load(), writes.Load(), count, time.Since(started))
	if failures.Load() != 0 || count != 100 || writes.Load() != 100 {
		t.Fatalf("write burst lost mutations or amplified retries: errors=%d count=%.0f PUTs=%d", failures.Load(), count, writes.Load())
	}
}

func TestRTDBTransactionRechecksCurrentStaffRole(t *testing.T) {
	root := map[string]interface{}{"staff": map[string]interface{}{"officer": map[string]interface{}{"uid": "officer", "id_petugas": 4, "id_level": 2, "role": "petugas", "active": false}}}
	snapshot := paymentRTDBFixture(t, root)
	request := withRTDBClaims(httptest.NewRequest("PUT", "/", nil), &RTDBClaims{UID: "officer", ID: 4, Role: RolePetugas})
	err := rtdbTransaction(request.Context(), func(root map[string]interface{}) error { root["unauthorized"] = true; return nil })
	if err == nil || snapshot()["unauthorized"] != nil {
		t.Fatal("deactivated officer committed a mutation with stale claims")
	}
}

func TestRTDBPublicReadsCoalesceWithoutSharingMutableMaps(t *testing.T) {
	reads, _ := capacityFixture(t)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			var items map[string]map[string]interface{}
			if err := rtdbGet(context.Background(), "items", &items); err != nil {
				t.Error(err)
				return
			}
			if items["1"]["nama_barang"] != "fixture" {
				t.Error("read reused another caller's edited map")
			}
			items["1"]["nama_barang"] = "caller edit"
		}()
	}
	close(start)
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("100 public reads issued %d SDK GETs", reads.Load())
	}
	for i := 0; i < 2; i++ {
		var user map[string]interface{}
		if err := rtdbGet(context.Background(), "users/reader", &user); err != nil {
			t.Fatal(err)
		}
	}
	if reads.Load() != 3 {
		t.Fatal("private identity reads were cached")
	}
	if err := rtdbTransaction(context.Background(), func(root map[string]interface{}) error {
		treeRecord(root, "items", "1")["nama_barang"] = "updated"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var items map[string]map[string]interface{}
	if err := rtdbGet(context.Background(), "items", &items); err != nil {
		t.Fatal(err)
	}
	if items["1"]["nama_barang"] != "updated" {
		t.Fatal("write did not invalidate catalog cache")
	}
}

func TestRTDBQueuedCancellationDoesNotMutate(t *testing.T) {
	capacityFixture(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		done <- rtdbTransaction(context.Background(), func(root map[string]interface{}) error { close(entered); <-release; return nil })
	}()
	<-entered
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	err := rtdbTransaction(ctx, func(root map[string]interface{}) error { called = true; return nil })
	close(release)
	if firstErr := <-done; firstErr != nil {
		t.Fatal(firstErr)
	}
	if err != context.Canceled || called {
		t.Fatal("cancelled queued mutation executed")
	}
}

func TestRTDBSharedReadSurvivesFirstCallerCancellation(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	reads, _ := capacityFixture(t, func() { close(entered); <-release })
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { var items map[string]interface{}; done <- rtdbGet(ctx, "items", &items) }()
	<-entered
	cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("cancelled caller got %v", err)
	}
	other := make(chan error, 1)
	go func() { var items map[string]interface{}; other <- rtdbGet(context.Background(), "items", &items) }()
	close(release)
	if err := <-other; err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 1 {
		t.Fatalf("shared read restarted after cancelled caller: %d", reads.Load())
	}
}

func TestRTDBOldInFlightReadCannotRepopulateCacheAfterWrite(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	capacityFixture(t, func() { close(entered); <-release })
	done := make(chan error, 1)
	go func() { var items map[string]interface{}; done <- rtdbGet(context.Background(), "items", &items) }()
	<-entered
	if err := rtdbTransaction(context.Background(), func(root map[string]interface{}) error {
		treeRecord(root, "items", "1")["nama_barang"] = "new fixture"
		return nil
	}); err != nil {
		close(release)
		t.Fatal(err)
	}
	var before map[string]map[string]interface{}
	if err := rtdbGet(context.Background(), "items", &before); err != nil {
		close(release)
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var after map[string]map[string]interface{}
	if err := rtdbGet(context.Background(), "items", &after); err != nil {
		t.Fatal(err)
	}
	if before["1"]["nama_barang"] != "new fixture" || after["1"]["nama_barang"] != "new fixture" {
		t.Fatal("stale fetch poisoned post-write cache")
	}
}

func TestRTDBAuctionListBatchesOneHundredItemJoins(t *testing.T) {
	reads, _ := capacityFixture(t)
	if err := rtdbTransaction(context.Background(), func(root map[string]interface{}) error {
		for i := 1; i <= 100; i++ {
			key := fmt.Sprint(i)
			treeNode(root, "items")[key] = map[string]interface{}{"id_barang": i, "nama_barang": "fixture", "status_verifikasi": "approved"}
			treeNode(root, "auctions")[key] = map[string]interface{}{"id_lelang": i, "id_barang": i, "status": "ditutup"}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := reads.Load()
	w := httptest.NewRecorder()
	ListLelangRTDB(w, httptest.NewRequest("GET", "/api/lelang", nil))
	var response struct {
		Data []interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(response.Data) != 100 || reads.Load()-before != 2 {
		t.Fatalf("100 lot list: status=%d lots=%d GETs=%d", w.Code, len(response.Data), reads.Load()-before)
	}
}
