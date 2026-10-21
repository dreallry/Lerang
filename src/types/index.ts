// ERD Types & Models matching database schema

export type UserRole = 'masyarakat' | 'petugas' | 'administrator';

export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type AuctionStatus = 'draft' | 'terjadwal' | 'dibuka' | 'ditutup' | 'dibatalkan';
export type PaymentStatus = 'Belum Dibayar' | 'Sudah Dibayar' | 'Kadaluarsa';
export type CategoryType = 'Kendaraan' | 'Elektronik & Gadget' | 'Properti' | 'Barang Mewah & Jam' | 'Koleksi & Seni' | 'Lainnya';

export type SesiStatus = 'upcoming' | 'live' | 'closed';
export type SesiType = 'reguler' | 'tematik' | 'flash';

export interface TbSesiLelang {
  id_sesi: number;
  judul: string;
  deskripsi: string;
  tipe: SesiType;
  tgl_mulai: string; // ISO datetime
  durasi_default_jam: number;
  id_lelang_list: number[];
  gambar_banner: string;
  status: SesiStatus;
  kurator: string;
  created_by: number;
  created_at: string;
}

export interface TbMasyarakat {
	display_name?: string;
	email_verified?: boolean;
	legacy_historical?: boolean;
	financial_review_required?: boolean;
  id_user: number;
  nama_lengkap: string;
  username: string;
  telp: string;
  nik?: string;
  email?: string;
  alamat?: string;
  avatar_url?: string;
  saldo_wallet: number; // Saldo deposit aktif
  saldo_hold: number;   // Saldo deposit yang sedang dikunci sebagai jaminan
  is_verified: boolean; // KYC / OTP verification
  created_at?: string;
}

export interface TbPetugas {
  display_name?: string;
  id_petugas: number;
  nama_petugas: string;
  username: string;
  email?: string;
  active?: boolean;
  legacy_historical?: boolean;
  requires_identity_link?: boolean;
  id_level: number; // 1: Administrator, 2: Petugas
  avatar_url?: string;
  nip?: string;
}

export interface TbLevel {
  id_level: number;
  level: 'administrator' | 'petugas';
}

export interface TbBarang {
  id_barang: number;
  nama_barang: string;
  tanggal: string; // Tanggal input
  created_at?: string;
  updated_at?: string;
  harga_awal: number; // Harga limit awal
  deskripsi_barang: string;
  kategori: CategoryType;
  foto_barang: string[]; // Foto multi-sudut
  dokumen_pendukung?: string[]; // Tautan dokumen untuk pemeriksaan petugas.
  spesifikasi?: Record<string, string>;

  // Extension for C2C:
  id_user?: number | null; // null jika barang milik balai lelang/petugas, or id_user jika diajukan masyarakat
  status_verifikasi: VerificationStatus; // 'pending' | 'approved' | 'rejected'
  catatan_kurasi?: string; // Alasan penolakan / catatan dari petugas
  estimasi_pasar?: number;
  reserve_price?: number; // Harga cadangan minimal rahasia dari penjual
  relist_count?: number; // Jumlah auto-relist jika lelang tidak laku (0 bid)
  is_featured?: boolean; // Tampil unggulan di etalase utama
}

export interface TbLelang {
  legacy_historical?: boolean;
  id_lelang: number;
  id_barang: number;
  id_sesi?: number; // Referensi ke sesi lelang terjadwal
  tgl_mulai: string; // ISO datetime
  tgl_selesai: string; // ISO datetime
  kelipatan_minimal: number; // Minimum bid increment (misal: 100000)
  uang_jaminan: number; // Nilai deposit wajib untuk ikut lelang ini
  harga_akhir: number; // Highest current bid or final price
  minimum_bid?: number;
  bid_increment?: number;
  id_user: number | null; // ID user pemenang / penawar tertinggi saat ini
  id_petugas: number; // Petugas yang membuka/menyetujui
  status: AuctionStatus; // 'dibuka' | 'ditutup' | 'draft' | 'terjadwal' | 'dibatalkan'
  reserve_price?: number; // Harga cadangan rahasia (lot tidak terjual jika bid < reserve)
  is_reserve_met?: boolean; // Indikator apakah bid tertinggi sudah menyamai/melampaui reserve
  is_extended?: boolean; // Apakah waktu pernah diperpanjang anti-snipe
  extension_count?: number; // Frekuensi perpanjangan waktu lelang
}

export interface TbTheme {
  id_theme: number;
  nama_theme: string;
  subjudul_jadwal: string; // Misal 'Sep 28 · Hammer auction' atau 'Sep 30 · Themed auction'
  badge_waktu?: string; // Misal 'Today 18:00', 'Ending today'
  nama_kurator: string; // Misal 'Stockholms Auktionsverk Fine Art', 'Balai Lelang Batavia'
  gambar_cover: string;
  tipe: 'themed' | 'hammer';
  id_lelang_list: number[]; // ID lot lelang yang terhubung dengan tema ini
  deskripsi?: string;
}

export interface HistoryLelang {
  id_history: number | string;
  id_lelang: number;
  id_barang: number;
  id_user: number;
  nama_user: string;
  penawaran_harga: number;
  created_at: string;
  is_auto_bid?: boolean;
}

export interface TbPembayaran {
  created_at?: string;
  escrow_status?: string;
  released_at?: string;
  id_pembayaran: number;
  order_id?: string;
  legacy_historical?: boolean;
  payment_review_required?: boolean;
  id_lelang: number;
  id_barang: number;
  id_user: number;
  tgl_pembayaran: string;
  jumlah_pembayaran: number; // Total harga akhir lelang (Hammer Price)
  premi_pembeli?: number; // Buyer's Premium (misal 8% dari hammer price)
  premi_persen?: number; // Persentase premi pembeli (5%, 8%, 10%)
  total_keseluruhan?: number; // jumlah_pembayaran + (premi_pembeli || 0)
  uang_jaminan_dipotong: number; // Uang jaminan yang diperhitungkan
  sisa_tagihan: number; // (jumlah_pembayaran + premi_pembeli) - uang_jaminan_dipotong
  biaya_komisi_platform: number; // Misal 5% dari harga akhir (khusus C2C)
  dana_penjual_diterima?: number; // Sisa dana diteruskan ke user penjual
  metode_pembayaran?: string; // QRIS / VA BCA / Midtrans Snap
  nomor_va?: string;
  status: PaymentStatus; // 'Belum Dibayar' | 'Sudah Dibayar' | 'Kadaluarsa'
  bukti_pembayaran?: string;
  batas_pembayaran: string; // ISO Datetime
}

export interface WalletTransaction {
  request_id?: string;
  id: string;
  id_user: number;
  tipe: 'topup' | 'hold' | 'unhold' | 'pelunasan' | 'payout_c2c' | 'withdraw' | 'forfeit';
  nominal: number;
  keterangan: string;
  status: 'sukses' | 'pending' | 'gagal';
  created_at: string;
  referensi_id?: string;
}

export interface NotificationItem {
  id: string;
  id_user: number;
  role_target?: UserRole;
  judul: string;
  pesan: string;
  tipe: 'info' | 'bid' | 'win' | 'outbid' | 'curation' | 'payment' | 'warning';
  dibaca: boolean;
  created_at: string;
  link_target?: string;
}

// Joined View Types for UI convenience
export interface AuctionDetailItem {
  lelang: TbLelang;
  barang: TbBarang;
  penawarTertinggi?: TbMasyarakat | null;
  petugas?: TbPetugas | null;
  penjual?: TbMasyarakat | null;
  totalBids: number;
  history: HistoryLelang[];
}

export type FulfillmentStatus = 'menunggu_alamat' | 'dikemas' | 'dikirim' | 'diterima' | 'selesai';

export interface FulfillmentTrackingItem {
  status: FulfillmentStatus;
  deskripsi: string;
  waktu: string;
}

export interface FulfillmentOrder {
  legacy_historical?: boolean;
  id_fulfillment: string;
  id_pembayaran: number;
  id_lelang: number;
  id_barang: number;
  id_user_pembeli: number;
  id_user_penjual?: number | null;

  // Alamat Pengiriman
  nama_penerima?: string;
  telp_penerima?: string;
  alamat_lengkap?: string;
  kota?: string;
  kode_pos?: string;

  // Ekspedisi
  kurir?: string;
  layanan_kurir?: string;
  nomor_resi?: string;
  ongkir?: number;
  shipping_payment_status?: 'not_required' | 'arrange_with_staff' | 'paid_manual';
  shipping_payment_reference?: string;
  shipping_paid_at?: string;

  // Status Tracking
  status: FulfillmentStatus;
  tgl_update: string;
  tracking_history: FulfillmentTrackingItem[];

  // Ulasan & Rating
  rating?: number;
  ulasan?: string;
}
