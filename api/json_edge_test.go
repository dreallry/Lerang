package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsNullAndTruncatedOversizedBody(t *testing.T) {
	for _, body := range []string{"null", `[]`, `{"ok":true}` + strings.Repeat(" ", 1<<20) + `{"hidden":true}`} {
		var target map[string]interface{}
		if err := DecodeJSON(httptest.NewRequest("POST", "/", strings.NewReader(body)), &target); err == nil {
			t.Fatalf("accepted invalid object body (length %d)", len(body))
		}
	}
	var target struct {
		OK bool `json:"ok"`
	}
	for _, body := range []string{`{"unknown":true}`, `{"ok":true} {"ok":false}`} {
		if err := DecodeJSON(httptest.NewRequest("POST", "/", strings.NewReader(body)), &target); err == nil {
			t.Fatal("accepted unknown field or multiple objects")
		}
	}
	if err := DecodeJSON(httptest.NewRequest("POST", "/", strings.NewReader("{\"ok\":true}\n  ")), &target); err != nil || !target.OK {
		t.Fatalf("valid object rejected: %v", err)
	}
}
