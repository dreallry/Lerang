package api

import "testing"

func TestLegacyDisplayRepairsKnownMojibakeAndPreservesValidText(t *testing.T) {
	for input, want := range map[string]string{
		`MacBook 16\"`:                  `MacBook 16"`,
		`MacBook 16"`:                   `MacBook 16"`,
		"Gom├®r & Andersson Link├Âping": "Gomér & Andersson Linköping",
		"Sep 28 ┬À Hammer auction":      "Sep 28 · Hammer auction",
		"Koleksi Café":                  "Koleksi Café",
		"┬ field separator":             "┬ field separator",
	} {
		if got := legacyDisplayText(input); got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}
