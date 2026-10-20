package api

import (
	"crypto/rand"
	"encoding/hex"
)

// NewHashID menghasilkan 64 karakter hex acak (32 byte) untuk dipakai di URL.
func NewHashID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func NewOrderID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "LELANG-" + hex.EncodeToString(b), nil
}
