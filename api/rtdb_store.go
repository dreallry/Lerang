package api

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"time"

	firebaseDB "firebase.google.com/go/v4/db"
)

// RTDB is the authoritative application store after the MySQL cutover.
// Numeric IDs are retained in each record so existing frontend relations stay stable.
var ErrRTDBUnavailable = errors.New("Firebase Realtime Database belum siap")

func rtdbRef(path string) (*firebaseDB.Ref, error) {
	if firebaseDatabaseClient == nil {
		return nil, ErrRTDBUnavailable
	}
	return firebaseDatabaseClient.NewRef(path), nil
}

func rtdbGet(ctx context.Context, path string, target any) error {
	targetType := reflect.TypeOf(target)
	if targetType == nil || targetType.Kind() != reflect.Pointer || reflect.ValueOf(target).IsNil() {
		return errors.New("tujuan pembacaan Firebase harus pointer")
	}
	raw, err := rtdbRead(ctx, path)
	if err != nil {
		return err
	}
	bytes, err := json.Marshal(rtdbValueForType(raw, targetType.Elem()))
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, target)
}

// Numeric RTDB keys can be returned as JSON arrays, while image/document fields must remain arrays.
func rtdbValueForType(value interface{}, target reflect.Type) interface{} {
	if target.Kind() != reflect.Map {
		return value
	}
	values := treeMap(value)
	if values == nil {
		return value
	}
	result := map[string]interface{}{}
	for key, child := range values {
		result[key] = rtdbValueForType(child, target.Elem())
	}
	return result
}

func rtdbSet(ctx context.Context, path string, value any) error {
	ref, err := rtdbRef(path)
	if err != nil {
		return err
	}
	if err := ref.Set(ctx, value); err != nil {
		return err
	}
	invalidatePublicReads()
	return nil
}

func rtdbUpdate(ctx context.Context, updates map[string]interface{}) error {
	if firebaseDatabaseClient == nil {
		return ErrRTDBUnavailable
	}
	if err := firebaseDatabaseClient.NewRef("").Update(ctx, updates); err != nil {
		return err
	}
	invalidatePublicReads()
	return nil
}

func rtdbDelete(ctx context.Context, path string) error {
	return rtdbSet(ctx, path, nil)
}

func rtdbNow() string { return time.Now().UTC().Format(time.RFC3339) }

func rtdbNumericID(value any) int {
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

func rtdbNextID(ctx context.Context, node string) (int, error) {
	var id int
	err := rtdbTransaction(ctx, func(root map[string]interface{}) error { id = nextTreeID(root, node); return nil })
	return id, err
}

func rtdbPathID(id int) string { return strconv.Itoa(id) }
