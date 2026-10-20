package api

import (
	"context"
	"errors"
	"log"
	"sort"
	"time"
)

func reconcileRTDBPayment(ctx context.Context, id, actor string) (map[string]interface{}, error) {
	notification, gatewayErr := authoritativeMidtransNotification(id)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	status := ""
	err := rtdbTransaction(ctx, func(root map[string]interface{}) error {
		order := treeRecord(root, "paymentOrders", id)
		if order == nil {
			return domainError(404, "Transaksi pembayaran tidak ditemukan")
		}
		order["last_checked_at"], order["last_checked_by"] = now, actor
		order["last_check_error"] = nil
		if gatewayErr != nil {
			order["last_check_error"] = "Status pembayaran belum dapat diperiksa ke Midtrans"
			var known *transactionError
			if errors.As(gatewayErr, &known) {
				order["last_check_error"] = known.message
			}
		} else if err := applyRTDBPaymentNotification(root, notification, time.Now()); err != nil {
			return err
		}
		status = stringValue(order["status"], "")
		return nil
	})
	if err != nil {
		var known *transactionError
		if gatewayErr == nil && errors.As(err, &known) && known.status >= 400 && known.status < 500 {
			// Persist diagnostics separately after the rejected financial transaction has rolled back.
			if recordErr := rtdbTransaction(ctx, func(root map[string]interface{}) error {
				if order := treeRecord(root, "paymentOrders", id); order != nil {
					order["last_checked_at"], order["last_checked_by"], order["last_check_error"] = now, actor, known.message
				}
				return nil
			}); recordErr != nil {
				return nil, recordErr
			}
		}
		return nil, err
	}
	return map[string]interface{}{"order_id": id, "status": status, "gateway_status": notification.TransactionStatus, "is_production": midtransProduction()}, gatewayErr
}

func StartPaymentReconciler(ctx context.Context) {
	go func() {
		timer := time.NewTicker(30 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				var orders map[string]map[string]interface{}
				if err := rtdbGet(ctx, "paymentOrders", &orders); err != nil {
					log.Print("Antrean rekonsiliasi pembayaran belum dapat dimuat")
					continue
				}
				ids := make([]string, 0)
				for id, order := range orders {
					status := stringValue(order["status"], "")
					if status != "pending" && status != "failed" {
						continue
					}
					if created, err := auctionTime(order["created_at"]); err == nil && time.Since(created) < 72*time.Hour {
						ids = append(ids, id)
					}
				}
				sort.Slice(ids, func(i, j int) bool {
					return stringValue(orders[ids[i]]["last_checked_at"], "") < stringValue(orders[ids[j]]["last_checked_at"], "")
				})
				if len(ids) > 20 {
					ids = ids[:20]
				}
				for _, id := range ids {
					if ctx.Err() != nil {
						return
					}
					_, err := reconcileRTDBPayment(ctx, id, "automatic")
					if err != nil && err != errNoLifecycleWork {
						log.Print("Satu transaksi pembayaran menunggu pemeriksaan ulang")
					}
				}
			}
		}
	}()
}
