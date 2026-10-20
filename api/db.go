package api

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var DB *sql.DB

func InitDB() {
	user := Env("DB_USER", "root")
	pass := Env("DB_PASS", "")
	host := Env("DB_HOST", "127.0.0.1")
	port := Env("DB_PORT", "3306")
	name := Env("DB_NAME", "db_lelang")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4",
		user, pass, host, port, name)

	var err error
	DB, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("gagal buka koneksi MySQL: %v", err)
	}

	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(10)
	DB.SetConnMaxLifetime(5 * time.Minute)

	if err := DB.Ping(); err != nil {
		log.Fatalf("MySQL tidak merespons (cek XAMPP MySQL & database db_lelang): %v", err)
	}

	log.Println("MySQL XAMPP terhubung:", name)
}
