export function authErrorMessage(error: unknown): string {
  if(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name))return 'Server belum merespons. Periksa riwayat transaksi sebelum mencoba lagi.';
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/configuration-not-found': 'Layanan masuk situs belum diaktifkan. Hubungi pengelola untuk mengaktifkan Firebase Authentication.',
    'auth/operation-not-allowed': 'Metode masuk ini belum diaktifkan. Hubungi pengelola situs.',
    'auth/popup-blocked': 'Jendela Google diblokir browser. Izinkan popup untuk situs ini, lalu coba lagi.',
    'auth/popup-closed-by-user': 'Masuk dengan Google dibatalkan. Anda dapat mencoba lagi atau memakai email dan kata sandi.',
    'auth/cancelled-popup-request': 'Jendela masuk lain sudah dibuka. Selesaikan satu proses masuk terlebih dahulu.',
    'auth/account-exists-with-different-credential': 'Email ini sudah memakai metode masuk lain. Masuk dengan metode yang sebelumnya digunakan.',
    'auth/expired-action-code': 'Tautan sudah kedaluwarsa. Minta tautan baru dan gunakan email yang paling baru.',
    'auth/invalid-action-code': 'Tautan sudah dipakai atau tidak valid. Minta tautan baru untuk melanjutkan.',
    'auth/user-token-expired': 'Sesi telah berakhir. Masuk kembali untuk melanjutkan.',
    'auth/invalid-api-key': 'Konfigurasi layanan masuk belum valid. Hubungi pengelola situs.',
    'auth/app-not-authorized': 'Situs ini belum diizinkan memakai layanan masuk. Hubungi pengelola situs.',
    'auth/unauthorized-domain': 'Alamat situs ini belum diizinkan memakai layanan masuk. Hubungi pengelola situs.',
    'auth/invalid-credential': 'Email atau kata sandi salah. Jika lupa kata sandi, gunakan tautan reset.',
    'auth/wrong-password': 'Email atau kata sandi salah. Jika lupa kata sandi, gunakan tautan reset.',
    'auth/user-not-found': 'Email atau kata sandi salah. Jika lupa kata sandi, gunakan tautan reset.',
    'auth/email-already-in-use': 'Email sudah terdaftar. Gunakan halaman masuk atau reset kata sandi.',
    'auth/invalid-email': 'Format email belum valid.',
    'auth/weak-password': 'Kata sandi belum memenuhi persyaratan. Gunakan sedikitnya 6 karakter.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
    'auth/network-request-failed': 'Koneksi ke layanan masuk gagal. Periksa koneksi internet Anda.',
    'auth/user-disabled': 'Akun ini dinonaktifkan. Hubungi pengelola situs.',
    'auth/requires-recent-login': 'Masuk kembali sebelum melanjutkan tindakan ini.',
  };
  if (messages[code]) return messages[code];
  if (code.startsWith('auth/')) return 'Permintaan ke layanan masuk gagal. Silakan coba lagi.';
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|networkerror/i.test(message)) return 'Server lelang belum terhubung. Coba kembali beberapa saat lagi.';
  if (/profil masyarakat|belum memiliki profil/i.test(message)) return 'Akun berhasil masuk, tetapi profil peserta belum lengkap. Buka halaman daftar untuk melengkapi profil Anda.';
  return message || 'Permintaan gagal. Silakan coba lagi.';
}
