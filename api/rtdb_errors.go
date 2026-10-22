package api

import (
	"errors"
	"log"
	"net/http"
)

type transactionError struct {
	status  int
	message string
}

func (e *transactionError) Error() string          { return e.message }
func domainError(status int, message string) error { return &transactionError{status, message} }

func rtdbJSONError(w http.ResponseWriter, err error) {
	var actionError *transactionError
	if errors.As(err, &actionError) {
		Error(w, actionError.status, actionError.message)
		return
	}
	if errors.Is(err, ErrRTDBUnavailable) {
		Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	log.Printf("Realtime Database request failed: %v", err)
	Error(w, http.StatusInternalServerError, "Data belum dapat dimuat atau disimpan. Coba lagi beberapa saat lagi")
}
