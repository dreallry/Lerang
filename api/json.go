package api

import (
	"encoding/json"
	"net/http"
	"io"
	"errors"
)

func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

func DecodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body,1<<20))
	dec.DisallowUnknownFields()
	if err:=dec.Decode(dst);err!=nil{return err}
	var extra interface{}
	if err:=dec.Decode(&extra);err!=io.EOF{return errors.New("body harus berisi satu objek JSON")}
	return nil
}
