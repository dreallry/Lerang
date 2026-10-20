# Migrasi MySQL ke Firebase

Jalankan dari folder proyek. Aplikasi membaca Firebase Realtime Database; MySQL hanya digunakan oleh migrator. Foto menggunakan URL langsung, Firebase Storage jika bucket tersedia, atau folder server Go yang dikonfigurasi. Migrator mempertahankan URL foto SQL yang sudah ada dan tidak mengunduh ulang fotonya.

`.env` harus berisi `DB_*`, `FIREBASE_CREDENTIALS`, dan `FIREBASE_DATABASE_URL` untuk proyek tujuan. Simpan service-account dan backup di folder `secrets/`, di luar hosting publik. Jangan memasukkan kunci privat ke konfigurasi `VITE_*`.

Database dan transaksi tetap memakai RTDB. `GET /api/upload` memberi tahu formulir apakah unggah file tersedia. Firebase Storage diprioritaskan bila bucket dapat diakses. Tanpa bucket, `PHOTO_UPLOAD_DIR=uploads/lot-photos` mengaktifkan penyimpanan file di disk server Go. Kosongkan nilai tersebut untuk menonaktifkan penyimpanan disk. Tidak perlu membuat Firestore, dan tidak ada billing diaktifkan otomatis.

Form lot petugas dan titip jual memakai pemilih foto yang sama: pilih beberapa file atau drag-and-drop, lihat pratinjau, jadikan sampul, lepas foto, atau tambahkan tautan langsung. Maksimal 12 foto per barang dan 10 MB per file (JPG, PNG, WebP, GIF). Upload memerlukan sesi akun yang valid. Server memeriksa isi dan tipe file, memberi nama acak, dan hanya menyediakan foto lot melalui `/api/photos/{nama}`. Folder KTP maupun file proyek tidak disajikan endpoint ini.

Penyimpanan disk dibatasi total 500 MB. Foto yang dilepas dari formulir tetap ada di disk untuk menghindari penghapusan file yang mungkin sudah dipakai lot lain; petugas perlu membersihkan file tak terpakai saat pemeliharaan. **Cadangkan folder foto bersama backup RTDB** dan gunakan disk persisten saat deploy. Hosting statis Firebase saja tidak menjalankan Go atau menyimpan upload server. Reverse proxy website harus meneruskan `/api` termasuk `/api/photos` ke Go, sehingga path foto relatif tetap bekerja setelah perpindahan domain. Bila API ditempatkan pada domain terpisah, tambahkan proxy foto pada domain website juga. Tidak menyimpan base64 foto di RTDB atau browser.

`npm run check:firebase` memeriksa kecocokan proyek, layanan Auth, akses RTDB, dan keberadaan bucket Storage menggunakan pemeriksaan baca saja. Bucket harus benar-benar dibuat di Firebase Console; mengisi namanya di `.env` belum membuat bucket. Jika Console meminta aktivasi paket Blaze, pemilik akun perlu mengaktifkan billing sendiri. Panduan: [Firebase Cloud Storage](https://firebase.google.com/docs/storage/web/start).

## Sumber dan pemeriksaan awal

Migrator membaca database MySQL, bukan langsung mengeksekusi file SQL. Impor dump ke database staging yang terpisah bila database asal belum tersedia. Pilih nama database staging melalui `DB_NAME`; `--source-file` hanya mencatat checksum dump asal.

```powershell
$env:DB_NAME = 'nama_database_staging'
go run ./scripts/migrate-mysql-to-rtdb --validate --source-file db_lelang.sql
go run ./scripts/migrate-mysql-to-rtdb --dry-run --legacy-identities --source-file db_lelang.sql
```

`--validate` memeriksa 14 tabel, primary key, JSON, serta relasi tanpa menghubungi Firebase. `--dry-run` juga membaca Firebase untuk memeriksa konflik, tanpa menulis. Default waktu DATETIME sumber adalah Asia/Jakarta; TIMESTAMP dibaca UTC.

`--legacy-identities` menyimpan identitas SQL sebagai akun lama yang belum tertaut. Gunakan ini saat berpindah proyek Firebase: UID dari proyek lama tidak membuktikan kepemilikan akun di proyek baru. Peserta dapat menautkan riwayat melalui email Firebase yang sudah diverifikasi. Petugas dibuat menggunakan command provisioning di bawah. Hash password MySQL tidak disalin.

## Konflik ID dan penulisan

Migrasi menambahkan data yang belum ada. Data aktif tidak ditimpa. Nilai yang sudah sama dibiarkan; konflik membatalkan seluruh transaksi.

Jika pengguna SQL mempunyai ID yang sudah dimiliki akun aktif, tentukan pemetaan terlebih dahulu. Setelah pemetaan disetujui, tambahkan `--remap-user-collisions` untuk memberikan ID baru hanya kepada pengguna SQL yang berbenturan dan memperbarui semua relasinya. Akun aktif tetap dipertahankan. Pemetaan tersimpan dalam manifest dan metadata agar hasil eksekusi ulang tetap sama.

```powershell
# Periksa kembali dengan pemetaan yang sudah disetujui.
go run ./scripts/migrate-mysql-to-rtdb --dry-run --legacy-identities --remap-user-collisions --source-file db_lelang.sql

# Tulis hanya setelah hasil pemeriksaan sesuai.
go run ./scripts/migrate-mysql-to-rtdb --legacy-identities --remap-user-collisions --source-file db_lelang.sql

# Pemeriksaan ulang: tidak ada node baru atau konflik sebelum data hasil migrasi diubah aplikasi.
go run ./scripts/migrate-mysql-to-rtdb --dry-run --legacy-identities --remap-user-collisions --source-file db_lelang.sql
```

Migrator membuat backup tujuan sebelum penulisan dan manifest privat di `secrets/migration-backups/`, melakukan satu transaksi RTDB, kemudian membaca ulang hasilnya. Metadata tersedia di `migrationMeta/mysqlToRtdb/runs/{checksum}`. Proses tidak menghapus data tujuan dan tidak menghitung ulang saldo dari riwayat transaksi.

Setelah data hasil migrasi diedit atau akun lama ditautkan, eksekusi ulang dapat melaporkan konflik. Itu adalah perlindungan terhadap penimpaan; periksa manifest dan jangan menghapus data aktif untuk memaksa migrasi.

## Bentuk data tujuan

Data aplikasi berada pada `users`, `staff`, `levels`, `items`, `bids/{id_lelang}/{id_history}`, `schedules`, `categories`, `auctions`, `invoices`, `fulfillments`, `sessions`, dan `themes`. Profil aktif memakai Firebase UID, dengan indeks numerik `user_ids/{id_user}`.

Identitas yang belum terverifikasi disimpan pada `legacy_users` dan `legacy_staff`. Notifikasi serta riwayat dompet ditaruh di `notifications/{uid}` dan `walletTransactions/{uid}`, atau di koleksi `legacy_*` berdasarkan ID numerik sampai identitas tertaut.

Lelang SQL yang sudah lewat dipertahankan sebagai lelang selesai. Semua tagihan dan pengiriman impor diberi `legacy_historical`: server tidak membuka ulang, menagih, memotong jaminan, atau mencairkan hasil lama secara otomatis. Saldo jaminan lama yang belum dapat direkonsiliasi diberi tanda pemeriksaan. Status pembayaran/pengiriman SQL yang bertentangan harus diperiksa pengelola.

## Akun petugas

```powershell
go run ./scripts/provision-firebase-staff --email admin@example.com --role administrator
```

Command ini membuat atau memperbarui akun Auth beserta role RTDB. Akun baru tanpa password dapat menggunakan **Lupa kata sandi** di halaman masuk untuk menetapkan password melalui email Firebase. Untuk menautkan petugas SQL tertentu, gunakan `--id-petugas` dan `--id-level` yang sudah diperiksa. Jangan menjalankan provisioning dengan email contoh.

## Pembayaran dan operasional

Gunakan pasangan Server Key dan Client Key dari environment **Sandbox** Midtrans. `MIDTRANS_SERVER_KEY` hanya dibaca Go; Client Key dikirim ke Snap. Setelah mengganti `.env`, restart Go. Webhook harus menunjuk endpoint publik HTTPS `/api/midtrans/webhook`; server juga memeriksa pembayaran tertunda setiap 30 detik dan menyediakan sinkronisasi status untuk peserta pemilik order.

Salin kunci persis dari dashboard; jangan menambahkan `SB-` sendiri. Kunci Sandbox yang valid dapat diawali `Mid-server-` dan `Mid-client-`. Mode ditentukan oleh `MIDTRANS_IS_PRODUCTION=false`; tanpa flag, server tetap memilih Sandbox. Jalankan `npm run check:payments` untuk pemeriksaan akses tanpa membuat pembayaran.

Jalankan `npm run check:payments` untuk memeriksa penerimaan Server Key tanpa membuat order atau pembayaran. Pemeriksaan ini tidak membuktikan bahwa Client Key merupakan pasangan yang benar; pembuktian tersebut memerlukan checkout Snap setelah kunci diperbaiki.

Status lunas membutuhkan konfirmasi API Midtrans dengan ID dan nominal yang cocok. Callback browser tidak menambah saldo. Order, saldo, invoice, dan ledger diperbarui melalui transaksi RTDB agar permintaan ulang tidak menggandakan dana. Refund/chargeback dan pembayaran terlambat ditandai untuk pemeriksaan pengelola.

Penarikan rekening masuk antrean petugas. Petugas mencatat referensi setelah transfer bank benar-benar dilakukan; aplikasi tidak berpura-pura mengirim uang melalui API bank. Tarif ekspedisi juga menunggu penawaran dan pengaturan dengan petugas; pilihan ambil mandiri berasal dari server.

Deploy `database.rules.json` menggunakan konfigurasi `firebase.json`. Seluruh baca/tulis RTDB dari klien ditolak. Frontend hanya memakai Firebase Authentication; data publik maupun privat dimuat melalui Go. Admin SDK pada server tetap dapat mengakses database. Jangan membuka kembali rules hanya untuk memperbaiki error API; periksa role, profil, dan service-account.

## Akses dan pemeliharaan server

`api/router.go` memuat endpoint dan pembatasan role; `api/http_security.go` mengatur origin, header, dan timeout. `main.go` hanya memulai layanan dan menghentikannya dengan tertib. Login peserta maupun staf memakai formulir yang sama, kemudian diarahkan berdasarkan profil server.

Daftar lengkap peserta dan staf hanya tersedia untuk administrator. Staf wajib memiliki `active: true`, UID yang cocok, role yang valid, dan ID level yang sesuai di `staff/{uid}`. Token akun yang dinonaktifkan atau dicabut ditolak melalui pemeriksaan Firebase Admin. Tidak ada password atau hash password dalam respons daftar staf.

Saat deploy, isi `CORS_ALLOWED_ORIGINS` dengan origin HTTPS website, dipisahkan koma jika ada beberapa. Tanpa pengaturan ini, hanya origin pengembangan lokal port 5173 dan 4173 yang diterima. Webhook dan klien server tanpa header Origin tetap harus melalui validasi autentikasi/signature endpoint masing-masing.

Jalankan `go test ./...`, `npm test`, dan `npm run build` sebelum memasang perubahan. Tes akses memakai sertifikat, token bertanda tangan, serta layanan lokal sebagai fixture; tidak memakai akun atau kredensial Firebase proyek sebenarnya.

## Daftar akun dan login Google

Jalankan `npm run accounts:list` dari folder proyek untuk membaca akun Firebase Auth, status email, metode masuk yang sudah tertaut, serta ketersediaan profil aplikasi. Command ini tidak menampilkan password atau hash. Akun dengan `providers: []` belum memiliki password; pemilik dapat memakai Google dengan email yang sama atau menetapkan password melalui **Lupa kata sandi**.

Google diaktifkan melalui Firebase Console, Authentication, Sign-in method. `localhost` dan `127.0.0.1` harus ada pada Authorized domains untuk demo lokal. Backend hanya menerima metadata dari sesi Google dengan email terverifikasi. Nama tampilan dan foto Google tidak mengubah nama legal, role, saldo, atau status pemeriksaan identitas. Akun tanpa profil melengkapi identitas melalui halaman daftar; role penjual dan penawar sama-sama `masyarakat`.

## Halaman pemulihan akun

`npm run build:auth` membuat situs statis khusus aksi email di `dist-auth/`. `firebase deploy --only hosting --project lerangku` memasangnya tanpa memublikasikan API Go lokal. Handler mendukung reset sandi, verifikasi email, dan pemulihan perubahan email. URL kembali mengikuti `VITE_APP_URL`; ubah ke alamat situs yang benar saat situs utama dipublikasikan.

Agar email Firebase memakai handler ini, atur Authentication, Templates, Customize action URL ke `https://lerangku.web.app`. Pada 19 Oktober 2026, Firebase menolak pembaruan dengan `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`; pemilik memilih menundanya. Email masih memakai handler bawaan, walaupun halaman baru sudah terbit. Jangan menyatakan tautan email sudah dipindahkan sebelum membaca ulang konfigurasi atau memeriksa email baru. Referensi: [panduan resmi handler email](https://firebase.google.com/docs/auth/custom-email-handler).

Top up yang belum selesai dapat dilanjutkan dari riwayat dompet. Request ID disimpan di ledger server dan dipakai ulang setelah dialog ditutup atau halaman dimuat ulang. Penyimpanan browser hanya membantu percobaan ulang dan tidak menyimpan token Snap atau menjadi sumber saldo. Penarikan akun Google memakai autentikasi ulang Google; server tetap memeriksa waktu autentikasi terbaru.

## Pemeriksaan halaman administrasi

Dengan server pengembangan aktif di port 5173, jalankan `npm run check:admin-modules`. Pemeriksaan ini mengambil sembilan modul halaman administrasi beserta dependensinya dan gagal jika grafik atau laporan tidak dapat dimuat. Alamat lokal lain dapat diberikan melalui `npm run check:admin-modules -- http://127.0.0.1:5173`.

Konfigurasi utama memakai `node_modules/.vite-app`. Jika menjalankan Vite dengan konfigurasi pengujian lain, pilih `cacheDir` yang berbeda. Pada 19 Oktober 2026, konfigurasi pengujian menimpa cache bersama sehingga `recharts`, `jspdf`, dan `jspdf-autotable` mendapat HTTP 504 dan dashboard menjadi putih. Pemeriksaan modul di atas mendeteksi kegagalan tersebut sebelum cache dipisahkan.

`tests/browser/error-boundary.html` merupakan fixture pemulihan halaman. Buka melalui server pengembangan untuk memicu kegagalan lazy import yang disengaja. Harus tampil pesan pemulihan dengan tombol muat ulang dan kembali ke katalog; tombol kedua membuka halaman katalog fixture. Fixture tidak masuk build situs dan tidak memakai data atau kredensial Firebase.

`npm test` juga memeriksa waktu lokal formulir sesi pada beberapa zona waktu serta pengutipan dan perlindungan formula pada CSV. Untuk pengujian browser administrasi dengan data asli, gunakan sesi admin, buka kesembilan menu, lalu periksa unduhan CSV/PDF. Pemeriksaan baca tidak memerlukan persetujuan barang, pembatalan lelang, atau perubahan dana.

## Pusat operasi dan pemeriksaan pembayaran

Pusat operasi menampilkan semua tugas yang cocok dengan pencarian dan filter. Kasus pemeriksaan dana dan lelang yang melewati waktu penutupan berada di awal, kemudian tagihan yang terlambat, tugas rutin, dan arsip SQL. Jumlah pada filter dihitung dari tugas yang sama. Waktu pembaruan menunjukkan keberhasilan pemuatan data akun; jangan mengartikan kegagalan fetch sebagai antrean kosong.

Panel Pembayaran Midtrans memakai `GET /api/admin/payments`, dengan filter `status`, pencarian ID order/ID peserta `q`, serta `page` (20 order per halaman). Respons hanya memuat rincian yang dibutuhkan petugas. Snap token, UID pemilik, dan reservasi internal tidak dikirim. Administrator dan petugas dapat memakai `POST /api/admin/payments/{orderID}/sync`; peserta hanya dapat memakai sinkronisasi order miliknya sendiri.

Sinkronisasi petugas, peserta, dan rekonsiliasi otomatis memakai fungsi yang sama: status dan nominal diperiksa ke Midtrans, lalu perubahan finansial disimpan atomik di RTDB. Waktu, aktor, dan kegagalan pemeriksaan dicatat di server. Respons gagal atau nominal berbeda tidak menambah saldo. Refund/chargeback tetap ditandai untuk pemeriksaan dan tidak dibersihkan hanya dengan menekan cek ulang.

Lot baru dari formulir Kelola lot disimpan sebagai draft tanpa jadwal. Pilih lot tersebut di Sesi Lelang untuk menetapkan waktu pembukaannya. Dialog administrasi menggunakan dialog browser untuk mengunci fokus, mengembalikan fokus, dan mendukung Escape. Polling data menunggu pemuatan sebelumnya selesai dan berhenti saat komponen dilepas.

## Rentang statistik dan laporan

Ringkasan dan laporan memakai filter tanggal WIB (Asia/Jakarta), termasuk kedua tanggal batas, dengan pilihan 7/30/90 hari dan Semua waktu. Periode terakhir disimpan di sesi browser dan dibawa saat berpindah di antara kedua halaman. Statistik nilai palu/komisi memakai tanggal pembayaran yang valid dan mengecualikan arsip SQL atau tagihan yang perlu diperiksa. Top up, ongkir, dan dana penjual tidak dicampur ke nilai palu. Komisi pada tagihan lunas adalah nilai tercatat, bukan klaim dana sudah dicairkan.

Pada laporan, tanggal acuan lelang adalah jadwal selesai. Tagihan lunas memakai tanggal pembayaran; tagihan lain memakai tanggal pembuatan tersimpan, dengan fallback tanggal legacy jika tersedia. Data tanpa tanggal hanya masuk daftar Semua waktu; data tersebut tidak masuk grafik pembayaran. Pratinjau, CSV, dan PDF memakai daftar hasil filter yang sama. Filter status pembayaran terpisah dari filter status lelang. Tanggal terbalik menonaktifkan ekspor.

## Pengiriman dan pengambilan

Menu Pengiriman untuk administrator/petugas menampilkan antrean yang bisa dicari berdasarkan barang, tagihan, penerima, kurir, atau resi. Filter awal menyembunyikan arsip SQL dan pesanan selesai. Arsip tetap dapat dibaca melalui filter Arsip SQL/Semua pesanan, tetapi tidak dapat dimutasi. Server memeriksa kecocokan pembeli, barang, dan lelang dengan tagihan lunas sebelum menerima perubahan.

Ekspedisi memerlukan alamat lengkap. Petugas memasukkan kurir/layanan/biaya sesuai penawaran penyedia. Perubahan tujuan membatalkan penawaran yang belum dibayar. Jika ongkir positif, petugas mencatat referensi dana yang benar-benar telah diterima melalui `POST /api/fulfillment/{id}/shipping-payment` (reference, amount, courier, service). Nominal dan layanan harus cocok dengan penawaran terkini. Pencatatan ini manual dan tidak menagih Midtrans atau mengubah saldo/tagihan lelang. Setelah bukti dicatat, tujuan dan biaya dikunci agar pembayaran tidak tertimpa.

Setelah data lengkap, petugas memasukkan resi dan catatan penyerahan ke ekspedisi. Koreksi resi atau catatan tambahan bisa disimpan pada tahap persiapan/pengiriman; status tidak dapat dimundurkan. Permintaan ulang yang sama tidak menggandakan riwayat.

Ambil mandiri menggunakan layanan server dengan ongkir nol. Nama dan kontak penerima wajib, alamat dan AWB tidak diperlukan. Petugas mencatat keterangan serah terima sehingga status menjadi diterima. Baik ekspedisi maupun ambil mandiri tetap memerlukan konfirmasi pembeli sebelum hasil penjual dicairkan; petugas tidak dapat menggantikan konfirmasi pembeli.

Belum ada API tarif/tracking ekspedisi otomatis. Jangan menampilkan data perjalanan seolah berasal dari kurir; riwayat adalah catatan petugas. Pengiriman eksternal dan penerimaan ongkir tetap perlu dilakukan di luar aplikasi sesuai kesepakatan.
