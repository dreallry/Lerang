# Lerang

Aplikasi lelang barang berbasis web, dengan peran peserta, petugas, dan administrator.

## Stack dan fitur

- React, TypeScript, Vite, dan Tailwind CSS untuk antarmuka.
- Go dengan REST API untuk validasi dan proses bisnis.
- Firebase Authentication dan Realtime Database untuk akun serta data aplikasi.
- Midtrans Snap Sandbox untuk pengujian pembayaran dan sinkronisasi status.
- Pengajuan/kurasi barang, sesi lelang, penawaran, jaminan, tagihan, dan pencatatan pengiriman.
- Administrasi transaksi, statistik berdasarkan periode, dan ekspor laporan PDF/CSV.
- Unggah beberapa foto melalui server Go, dengan pratinjau dan pilihan sampul.

## Menjalankan lokal

Siapkan Node.js yang mendukung Vite 6, Go sesuai `go.mod`, dan proyek Firebase milik sendiri.

1. Salin `.env.example` menjadi `.env`, kemudian isi konfigurasi Firebase Web App dan URL Realtime Database.
2. Simpan service-account di `secrets/firebase-service-account.json` dan sesuaikan `FIREBASE_CREDENTIALS`.
3. Aktifkan metode autentikasi yang dipakai pada Firebase Console. Domain website harus diizinkan pada konfigurasi Authentication.
4. Isi pasangan kunci Midtrans Sandbox bila ingin menguji pembayaran. Biarkan `MIDTRANS_IS_PRODUCTION=false` untuk pengembangan.
5. Jalankan `npm ci`, lalu `go run .` dan `npm run dev` pada terminal terpisah.

Vite berjalan di `http://localhost:5173` dan meneruskan `/api` ke Go pada port 8080. Frontend tidak membaca data RTDB secara langsung; aturan database pada `database.rules.json` menolak akses klien, sementara API menggunakan Firebase Admin SDK.

## Foto dan deployment

`PHOTO_UPLOAD_DIR` mengaktifkan penyimpanan foto pada folder server jika Firebase Storage tidak tersedia. Batasnya 10 MB per file dan 500 MB untuk folder foto. Gunakan disk persisten dan cadangkan folder tersebut bersama database.

Hosting statis saja tidak menjalankan Go. Saat deploy, jalankan API sebagai layanan tersendiri dan teruskan `/api`, termasuk `/api/photos`, melalui reverse proxy. Sesuaikan origin, URL website, dan konfigurasi Firebase sebelum deploy.

`firebase.json` mengatur hosting halaman aksi email dan rules database. Pilih proyek/site Firebase milik sendiri sebelum menjalankan perintah deploy. Konfigurasi itu tidak memublikasikan seluruh aplikasi maupun API Go.

## Pemeriksaan

```sh
npm test
go test ./...
npm run build
```

`npm run check:firebase` dan `npm run check:payments` memeriksa layanan menggunakan `.env` lokal. Command daftar akun hanya untuk administrator dan hasilnya tidak boleh ditambahkan ke repository.

Panduan migrasi, provisioning staf, dan pemeliharaan ada di [scripts/README.md](scripts/README.md). MySQL hanya diperlukan untuk migrasi data lama; aplikasi menggunakan RTDB sebagai database utama. Dump dan akun asli tidak disertakan.

## Berkas privat

`.env`, service-account, folder `secrets/`, unggahan pengguna, dump database, catatan/screenshot pengujian, dan hasil build dikecualikan dari Git. Nilai `VITE_*` masuk ke bundle browser, sehingga hanya boleh memuat konfigurasi publik Firebase, bukan Server Key atau private key.

Pembayaran berjalan pada Sandbox selama pengembangan. Penarikan bank, ongkir, dan riwayat ekspedisi masih memerlukan pencatatan petugas; aplikasi tidak mengirim transfer bank atau mengambil tracking kurir secara otomatis.
