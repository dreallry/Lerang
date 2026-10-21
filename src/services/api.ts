// API Client Service untuk Lelang Barang
// Menghubungkan Frontend React dengan API Go dan Firebase-backed services

import { auth } from '../firebase';
import type { FulfillmentStatus, TbPembayaran, WalletTransaction } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

type WalletTransactionRecord = Omit<WalletTransaction, 'id_user'> & { id_user?: number };

export interface SnapPaymentResponse {
  success: boolean;
  message: string;
  data?: {
    order_id: string;
    id_pembayaran?: number;
    id_transaksi?: string;
    nominal?: number;
    total_tagihan?: number;
    snap_token: string;
    client_key: string;
    is_production: boolean;
  };
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CourierOption {
  id: string;
  name: string;
  service: string;
  price: number;
  eta?: string;
  desc?: string;
}

export type AdminPaymentStatus = 'pending' | 'paid' | 'failed' | 'review_required';
export interface AdminPayment {
  order_id: string;
  id_user: number;
  id_pembayaran?: number;
  kind: string;
  amount: number;
  amount_valid: boolean;
  status: AdminPaymentStatus;
  gateway_status?: string;
  created_at: string;
  last_checked_at?: string;
  last_check_error?: string;
  review_reason?: string;
}
export interface AdminPaymentPage {
  rows: AdminPayment[];
  counts: Record<AdminPaymentStatus, number>;
  total: number;
  page: number;
  pages: number;
  is_production: boolean;
}

class ApiService {
  setToken(_token: null) {
    try { localStorage.removeItem('lelang_jwt_token'); }
    catch { /* Firebase owns the active session when browser storage is unavailable. */ }
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    const owner = auth.currentUser;
    const signal = options.signal || AbortSignal.timeout(30000);
    const checkSession = () => {
      signal.throwIfAborted();
      if (auth.currentUser !== owner) {
        throw new ApiError('Sesi akun berubah. Periksa akun aktif lalu ulangi tindakan ini.', 409);
      }
    };
    checkSession();
    const token = await owner?.getIdToken();
    checkSession();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      signal,
      headers,
    });

    const data = await response.json().catch(() => null);
    checkSession();

    if (!response.ok) {
      const errorMsg = data?.message || data?.error || `Request failed with status ${response.status}`;
      throw new ApiError(errorMsg, response.status);
    }
    if (!data || data.success !== true) throw new ApiError('Respons server belum valid. Muat ulang data sebelum melanjutkan.', 502);

    return data;
  }

  // ---- AUTH ----
  async registerMasyarakat(data: {
    nik: string;
    nama_lengkap: string;
    username: string;
    telp: string;
    alamat?: string;
  }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async me() {
    return this.request('/auth/me');
  }

  async syncGoogleProfile() {
    return this.request('/auth/google-profile', { method: 'POST' });
  }

  async getStaff() {
    return this.request('/admin/staff');
  }

  // ---- BARANG ----
  async getCatalog(kategori?: string) {
    const query = kategori ? `?kategori=${encodeURIComponent(kategori)}` : '';
    return this.request(`/barang${query}`);
  }

  async getMyItems() {
    return this.request('/barang/my');
  }

  async getAllItems() {
    return this.request('/admin/barang');
  }

  async getDetailBarang(id: number) {
    return this.request(`/barang/${id}`);
  }

  async submitBarang(data: {
    nama_barang: string;
    harga_awal: number;
    kategori: string;
    deskripsi_barang: string;
    foto_barang: string[];
    dokumen_pendukung?: string[];
    spesifikasi?: Record<string, string>;
    reserve_price?: number;
    estimasi_pasar?: number;
  }) {
    return this.request('/barang', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBarang(id: number, data: Record<string, unknown> & { expected_updated_at: string }) {
    return this.request(`/barang/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async cancelSubmission(id: number) {
    return this.request(`/barang/${id}`, {
      method: 'DELETE',
    });
  }

  // Upload foto melalui backend.
  async getUploadAvailability(): Promise<ApiResponse<{enabled: boolean}>> {
    return this.request('/upload');
  }

  async uploadFoto(file: File, signal?: AbortSignal): Promise<string> {
    const formData = new FormData();
    formData.append('foto', file);

    const res = await this.request('/upload', {
      method: 'POST',
      body: formData,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : undefined,
    });
    if (typeof res?.data?.url !== 'string' || !res.data.url.trim()) throw new ApiError('Server belum mengembalikan alamat foto. Pilih ulang file untuk mencoba lagi.', 502);
    return res.data.url;
  }

  // ---- LELANG ----
  async getAuctions(status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/lelang${query}`);
  }

  async getAuctionDetail(id: number) {
    return this.request(`/lelang/${id}`);
  }

  async placeBid(id: number, amount: number) {
    return this.request(`/lelang/${id}/bid`, {
      method: 'POST',
      body: JSON.stringify({ penawaran_harga: amount }),
    });
  }

  async lockDeposit(id: number) {
    return this.request(`/lelang/${id}/lock-deposit`, {
      method: 'POST',
    });
  }

  async setupAutoBid(id: number, maxAmount: number) {
    return this.request(`/lelang/${id}/auto-bid`, { method: 'PUT', body: JSON.stringify({ max_amount: maxAmount }) });
  }

  async cancelAutoBid(id: number) {
    return this.request(`/lelang/${id}/auto-bid`, { method: 'DELETE' });
  }

  async getAllAuctions() {
    return this.request('/admin/lelang');
  }

  async getAllHistory() {
    return this.request('/lelang/history');
  }

  // ---- ADMIN & KURASI ----
  async getPendingBarang() {
    return this.request('/admin/pending-barang');
  }

  async validasiBarang(id: number, data: {
    expected_updated_at: string;
    status: 'approved' | 'rejected';
    catatan_kurasi: string;
    kelipatan_minimal?: number;
    uang_jaminan?: number;
    reserve_price?: number;
  }) {
    return this.request(`/admin/barang/${id}/validasi`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Alur 4: Atur jadwal lelang & durasi
  async getJadwalHarian() {
    return this.request('/admin/jadwal-harian');
  }

  async aturJadwalHarian(tanggal_lelang: string, jam_buka: string, catatan?: string) {
    return this.request('/admin/jadwal-harian', {
      method: 'POST',
      body: JSON.stringify({ tanggal_lelang, jam_buka, catatan }),
    });
  }

  async getKategoriDurasi() {
    return this.request('/admin/kategori-durasi');
  }

  async aturDurasiKategori(nama_kategori: string, durasi_jam: number) {
    return this.request('/admin/kategori-durasi', {
      method: 'POST',
      body: JSON.stringify({ nama_kategori, durasi_jam }),
    });
  }

  async bukaLelangSerentak() {
    return this.request('/admin/buka-serentak', {
      method: 'POST',
    });
  }

  async createOfficerAuction(barang: any, lelang: any) {
    return this.request('/admin/lelang', {
      method: 'POST',
      body: JSON.stringify({ barang, lelang }),
    });
  }

  async updateAuctionStatus(id: number, status: 'dibuka' | 'ditutup' | 'dibatalkan') {
    return this.request(`/admin/lelang/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async getUsers() {
    return this.request('/admin/users');
  }

  // ---- PEMBAYARAN MIDTRANS & WALLET ----
  async getInvoices() {
    return this.request<ApiResponse<TbPembayaran[]>>('/pembayaran');
  }

  async getAdminPayments(status: AdminPaymentStatus | '', query: string, page: number) {
    const params = new URLSearchParams({ status, q: query, page: String(page) });
    return this.request<ApiResponse<AdminPaymentPage>>(`/admin/payments?${params}`);
  }

  async syncAdminPayment(orderId: string) {
    return this.request<ApiResponse<{ status: AdminPaymentStatus }>>(`/admin/payments/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
  }

  async createSnapPayment(data: {
    id_lelang?: number;
    id_pembayaran?: number;
    jumlah_tagihan?: number;
    tipe_pembayaran?: 'pelunasan' | 'topup';
    request_id?: string;
  }): Promise<SnapPaymentResponse> {
    return this.request<SnapPaymentResponse>('/pembayaran/snap', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWalletInfo() {
    return this.request<ApiResponse<{
      saldo_wallet: number;
      saldo_hold: number;
      transactions: WalletTransactionRecord[];
      held_deposits: Record<string, boolean>;
      auto_bids: Record<string, number>;
    }>>('/wallet');
  }

  async withdrawFunds(data: {
    amount: number;
    bank_name: string;
    account_number: string;
    account_holder: string;
    request_id: string;
  }): Promise<{
    success: boolean;
    message: string;
    data?: { id_transaksi: string; nominal: number };
  }> {
    return this.request<{
      success: boolean;
      message: string;
      data?: { id_transaksi: string; nominal: number };
    }>('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ---- PENGIRIMAN & FULFILLMENT ----
  async getWithdrawals() { return this.request('/admin/withdrawals'); }

  async reviewWithdrawal(id: string, status: 'paid'|'rejected', reference: string, reason: string) {
    return this.request(`/admin/withdrawals/${encodeURIComponent(id)}`, {method:'POST',body:JSON.stringify({status,reference,reason})});
  }
  async getFulfillments() {
    return this.request('/fulfillment');
  }

  async getCouriers() {
    return this.request<ApiResponse<CourierOption[]>>('/fulfillment/couriers');
  }

  async updateFulfillmentCourier(id: string, data: { kurir: string; layanan_kurir: string; ongkir: number; expected_updated_at: string }) {
    return this.request(`/fulfillment/${encodeURIComponent(id)}/courier`, { method: 'POST', body: JSON.stringify(data) });
  }

  async updateFulfillmentAddress(id: string, data: {
    expected_updated_at: string;
    nama_penerima: string;
    telp_penerima: string;
    alamat_lengkap: string;
    kota: string;
    kode_pos: string;
    kurir?: string;
    layanan_kurir?: string;
    ongkir?: number;
  }) {
    return this.request(`/fulfillment/${id}/alamat`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFulfillmentResi(id: string, nomor_resi: string, status: FulfillmentStatus, deskripsi: string | undefined, expectedUpdatedAt: string) {
    return this.request(`/fulfillment/${id}/resi`, {
      method: 'POST',
      body: JSON.stringify({ nomor_resi, status, deskripsi, expected_updated_at: expectedUpdatedAt }),
    });
  }

  async recordShippingPayment(id: string, data: { reference: string; amount: number; courier: string; service: string; expected_updated_at: string }) {
    return this.request(`/fulfillment/${encodeURIComponent(id)}/shipping-payment`, { method: 'POST', body: JSON.stringify(data) });
  }

  async selesaikanOrder(id: string, rating: number, ulasan: string) {
    return this.request(`/fulfillment/${id}/selesai`, {
      method: 'POST',
      body: JSON.stringify({ rating, ulasan }),
    });
  }

  // ---- SESI & THEMES ----
  async getSessions() {
    return this.request('/sesi');
  }

  async createSession(data: {
    judul: string;
    deskripsi: string;
    tipe: string;
    tgl_mulai: string;
    durasi_default_jam: number;
    gambar_banner: string;
    kurator?: string;
    id_lelang_list?: number[];
  }) {
    return this.request('/sesi', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async assignToSession(lelangId: number, sesiId: number, durasi_jam?: number) {
    return this.request(`/sesi/${sesiId}/lots/${lelangId}`, { method: 'PUT', body: JSON.stringify({ durasi_jam }) });
  }

  async removeFromSession(lelangId: number, sesiId: number) {
    return this.request(`/sesi/${sesiId}/lots/${lelangId}`, { method: 'DELETE' });
  }

  async cancelSession(sesiId: number) {
    return this.request(`/sesi/${sesiId}/cancel`, { method: 'POST' });
  }

  async syncPayment(orderId: string) {
    return this.request<ApiResponse<{status:string}>>(`/pembayaran/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
  }

  async getThemes() {
    return this.request('/themes');
  }

  // ---- NOTIFIKASI ----
  async getNotifications() {
    return this.request('/notifikasi');
  }

  async markNotifikasiRead(id?: string) {
    const url = id ? `/notifikasi/${id}/read` : '/notifikasi/read-all';
    return this.request(url, {
      method: 'POST',
    });
  }
}

export const api = new ApiService();
export default api;
