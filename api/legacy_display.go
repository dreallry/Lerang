package api

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

func legacyDisplayText(value string) string {
	value = strings.ReplaceAll(value, `\"`, `"`)
	if !strings.ContainsAny(value, "┬├") {
		return value
	}
	// Some display strings in the SQL dump already contain UTF-8 decoded as DOS code page 850.
	repaired, err := charmap.CodePage850.NewEncoder().String(value)
	if err == nil && utf8.ValidString(repaired) {
		return repaired
	}
	return value
}

func formatDisplayFields(row map[string]interface{}, fields ...string) {
	for _, field := range fields {
		if value, ok := row[field].(string); ok {
			row[field] = legacyDisplayText(value)
		}
	}
}
