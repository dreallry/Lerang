package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	api "lelang_barang/api"
)

func main() {
	api.LoadEnv()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := api.InitPhotoUploads(); err != nil {
		log.Printf("Penyimpanan foto server belum tersedia: %v", err)
	}
	if err := api.InitFirebase(); err != nil {
		log.Printf("Firebase belum tersedia: %v", err)
	}
	if err := api.InitMidtrans(); err != nil {
		log.Printf("Pembayaran dinonaktifkan: %v", err)
	}
	if api.FirebaseDatabaseReady() {
		api.StartAuctionWorker(ctx)
		if api.MidtransReady() {
			api.StartPaymentReconciler(ctx)
		}
	}
	server := api.NewHTTPServer(":" + api.Env("PORT", "8080"))
	serverError := make(chan error, 1)
	go func() { serverError <- server.ListenAndServe() }()
	log.Printf("Server lelang berjalan di http://localhost%s", server.Addr)
	select {
	case err := <-serverError:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			log.Printf("Batas waktu penghentian server tercapai: %v", err)
			_ = server.Close()
		}
	}
}
