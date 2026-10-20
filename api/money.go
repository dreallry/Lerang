package api

import (
	"errors"
	"strconv"
	"strings"
)

const maxInt64 = int64(^uint64(0) >> 1)
const maxDatabaseRupiah = int64(9_999_999_999_999)

func parseRupiahAmount(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("nominal kosong")
	}

	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("format nominal tidak valid")
	}
	for _, digit := range parts[0] {
		if digit < '0' || digit > '9' {
			return 0, errors.New("format nominal tidak valid")
		}
	}

	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole < 0 || whole > maxInt64/100 {
		return 0, errors.New("nominal di luar batas")
	}
	fraction := "00"
	if len(parts) == 2 {
		if len(parts[1]) != 2 {
			return 0, errors.New("nominal harus memiliki maksimal dua angka desimal")
		}
		for _, digit := range parts[1] {
			if digit < '0' || digit > '9' {
				return 0, errors.New("format nominal tidak valid")
			}
		}
		fraction = parts[1]
	}

	minor, _ := strconv.ParseInt(fraction, 10, 64)
	if whole == maxInt64/100 && minor > maxInt64%100 {
		return 0, errors.New("nominal di luar batas")
	}
	return whole*100 + minor, nil
}

func rupiahAmountToMidtrans(value string) (int64, error) {
	minor, err := parseRupiahAmount(value)
	if err != nil {
		return 0, err
	}
	if minor%100 != 0 {
		return 0, errors.New("nominal IDR harus berupa bilangan rupiah utuh")
	}
	return minor / 100, nil
}

func validPaymentAmount(amount int64) bool {
	return amount > 0 && amount <= maxDatabaseRupiah
}
