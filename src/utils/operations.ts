import type { TbBarang, TbLelang, TbPembayaran, FulfillmentOrder } from '../types';
import { formatDateIndo, formatCompactRupiah } from './formatters.ts';

export type QueueKind = 'review' | 'auction' | 'payment' | 'delivery';
export interface OperationsTask { id: string; kind: QueueKind; title: string; detail: string; meta: string; view: string; recordId?: number; priority: number }

export function operationsTasks(items: TbBarang[], auctions: TbLelang[], invoices: TbPembayaran[], deliveries: FulfillmentOrder[], now: number): OperationsTask[] {
  const tasks: OperationsTask[] = [];
  for (const item of items.filter(item => item.status_verifikasi === 'pending')) {
    tasks.push({ id: `review-${item.id_barang}`, kind: 'review', title: `Periksa pengajuan ${item.nama_barang}`, detail: 'Periksa kondisi barang dan dokumen sebelum menyetujui atau menolak.', meta: 'Kurasi', view: 'admin-curation', priority: 2 });
  }
  for (const auction of auctions.filter(auction => auction.status === 'dibuka')) {
    const ended = new Date(auction.tgl_selesai).getTime() <= now;
    const item = items.find(item => item.id_barang === auction.id_barang);
    tasks.push({ id: `auction-${auction.id_lelang}`, kind: 'auction', title: `${item?.nama_barang || `Lot #${auction.id_lelang}`}${ended ? ' menunggu penutupan' : ' sedang berlangsung'}`, detail: ended ? 'Jadwal selesai sudah lewat. Periksa status layanan penutupan sebelum mengambil tindakan.' : `Berakhir ${formatDateIndo(auction.tgl_selesai)}.`, meta: ended ? 'Periksa jadwal' : 'Live', view: ended ? 'admin-auctions' : 'auction-detail', recordId: ended ? undefined : auction.id_lelang, priority: ended ? 0 : 2 });
  }
  for (const invoice of invoices.filter(invoice => invoice.status === 'Belum Dibayar' || invoice.payment_review_required)) {
    const item = items.find(item => item.id_barang === invoice.id_barang);
    const historical = invoice.legacy_historical;
    const overdue = !historical && new Date(invoice.batas_pembayaran).getTime() <= now;
    const review = invoice.payment_review_required;
    tasks.push({ id: `payment-${invoice.id_pembayaran}`, kind: 'payment', title: `${historical ? 'Cocokkan tagihan arsip' : review ? 'Periksa transaksi' : overdue ? 'Pembayaran melewati tenggat' : 'Pantau pelunasan'}: ${item?.nama_barang || `tagihan #${invoice.id_pembayaran}`}`, detail: historical ? 'Cocokkan dengan bukti lama. Arsip tidak ditagih atau diselesaikan otomatis.' : review ? 'Dana atau status pembayaran memerlukan pemeriksaan sebelum pengiriman dilanjutkan.' : `Jatuh tempo ${formatDateIndo(invoice.batas_pembayaran)}.`, meta: formatCompactRupiah(invoice.sisa_tagihan), view: 'invoices', priority: historical ? 3 : review ? 0 : overdue ? 1 : 2 });
  }
  for (const delivery of deliveries.filter(delivery => !delivery.legacy_historical && !['diterima', 'selesai'].includes(delivery.status))) {
    tasks.push({ id: `delivery-${delivery.id_fulfillment}`, kind: 'delivery', title: `Pengiriman tagihan #${delivery.id_pembayaran}`, detail: `Status: ${delivery.status.replace(/_/g, ' ')}.`, meta: 'Pengiriman', view: 'fulfillment', recordId: delivery.id_pembayaran, priority: 2 });
  }
  return tasks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id, 'id', { numeric: true }));
}
