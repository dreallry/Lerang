package api

import "regexp"

var paymentRequestIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func validTopUpRequestID(requestID string) bool {
	return paymentRequestIDPattern.MatchString(requestID)
}

type midtransNotification struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	Currency          string `json:"currency"`
	SignatureKey      string `json:"signature_key"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	PaymentType       string `json:"payment_type"`
}

type paymentEvent int

const (
	paymentEventPending paymentEvent = iota
	paymentEventPaid
	paymentEventFailed
	paymentEventManualReview
)

func classifyMidtransEvent(transactionStatus, fraudStatus string) (paymentEvent, bool) {
	switch transactionStatus {
	case "settlement":
		return paymentEventPaid, true
	case "capture":
		switch fraudStatus {
		case "accept":
			return paymentEventPaid, true
		case "deny":
			return paymentEventFailed, true
		case "challenge", "":
			return paymentEventPending, true
		default:
			return paymentEventPending, false
		}
	case "pending", "authorize":
		return paymentEventPending, true
	case "deny", "cancel", "expire", "failure":
		return paymentEventFailed, true
	case "refund", "partial_refund", "chargeback", "partial_chargeback":
		return paymentEventManualReview, true
	default:
		return paymentEventPending, false
	}
}
