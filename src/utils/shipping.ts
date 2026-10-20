import type { FulfillmentOrder, FulfillmentStatus, TbPembayaran } from '../types';

export const pickupCourier = 'Ambil di balai lelang';
export const shippingLabels: Record<FulfillmentStatus, string> = { menunggu_alamat: 'Menunggu data penerima', dikemas: 'Disiapkan petugas', dikirim: 'Dalam pengiriman', diterima: 'Menunggu konfirmasi pembeli', selesai: 'Selesai' };
export const isPickup = (order: FulfillmentOrder) => order.kurir === pickupCourier;
export const recipientReady = (order: FulfillmentOrder) => !!order.nama_penerima && !!order.telp_penerima && (isPickup(order) || !!order.alamat_lengkap && !!order.kota && !!order.kode_pos);

export function shippingBlockReason(order: FulfillmentOrder, invoice?: TbPembayaran): string {
  if (order.legacy_historical || invoice?.legacy_historical) return 'Arsip SQL hanya dapat dibaca. Cocokkan dengan bukti lama sebelum tindakan lebih lanjut.';
  if (!invoice || invoice.status !== 'Sudah Dibayar' || invoice.payment_review_required) return 'Tagihan belum lunas atau memerlukan pemeriksaan. Pengiriman belum dapat diubah.';
  if (order.id_user_pembeli !== invoice.id_user || order.id_barang !== invoice.id_barang || order.id_lelang !== invoice.id_lelang) return 'Relasi pesanan dan tagihan perlu diperiksa.';
  return '';
}

export function nextShippingStatus(order: FulfillmentOrder): FulfillmentStatus | null {
  if (order.status === 'dikemas') return isPickup(order) ? 'diterima' : 'dikirim';
  return order.status === 'dikirim' ? 'diterima' : null;
}
