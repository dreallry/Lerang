import type { FulfillmentOrder, NotificationItem, TbPembayaran, WalletTransaction } from '../types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respons data akun tidak valid.');
  return value as Record<string, unknown>;
}

function id(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('ID data akun tidak valid.');
  return result;
}

function money(value: unknown): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Nominal dari server tidak valid.');
  return result;
}

export function normalizeInvoice(value: unknown): TbPembayaran {
  const data = object(value);
  const result = { ...data } as unknown as TbPembayaran;
  for (const key of ['id_pembayaran', 'id_lelang', 'id_barang', 'id_user'] as const) result[key] = id(data[key]);
  for (const key of ['jumlah_pembayaran', 'premi_pembeli', 'premi_persen', 'total_keseluruhan', 'uang_jaminan_dipotong', 'sisa_tagihan', 'biaya_komisi_platform', 'dana_penjual_diterima'] as const) result[key] = money(data[key]);
  return result;
}

export function normalizeFulfillment(value: unknown): FulfillmentOrder {
  const data = object(value);
  if (!data.id_fulfillment) throw new Error('ID pengiriman tidak valid.');
  return {
    ...data,
    id_fulfillment: String(data.id_fulfillment),
    id_pembayaran: id(data.id_pembayaran),
    id_lelang: id(data.id_lelang),
    id_barang: id(data.id_barang),
    id_user_pembeli: id(data.id_user_pembeli),
    id_user_penjual: data.id_user_penjual ? id(data.id_user_penjual) : null,
    ongkir: money(data.ongkir),
    tracking_history: Array.isArray(data.tracking_history) ? data.tracking_history : [],
  } as FulfillmentOrder;
}

export function normalizeNotification(value: unknown): NotificationItem {
  const data = object(value);
  if (!data.id) throw new Error('ID notifikasi tidak valid.');
  return { ...data, id: String(data.id), id_user: Number(data.id_user || 0), dibaca: data.dibaca === true } as NotificationItem;
}

export function normalizeWallet(value: unknown, userID: number) {
  const data = object(value);
  id(userID);
  if (data.saldo_wallet === undefined || data.saldo_hold === undefined) throw new Error('Saldo belum diberikan oleh server.');
  if (!Array.isArray(data.transactions)) throw new Error('Riwayat saldo dari server tidak valid.');
  const deposits = object(data.held_deposits || {});
  const bids = object(data.auto_bids || {});
  const heldDeposits: Record<string, boolean> = {};
  const autoBids: Record<string, number> = {};
  for (const [key, locked] of Object.entries(deposits)) {
    if (!new RegExp(`^[1-9]\\d*_${userID}$`).test(key) || typeof locked !== 'boolean') throw new Error('Jaminan akun dari server tidak valid.');
    heldDeposits[key] = locked;
  }
  for (const [key, limit] of Object.entries(bids)) {
    if (!new RegExp(`^[1-9]\\d*_${userID}$`).test(key)) throw new Error('Batas tawaran akun dari server tidak valid.');
    autoBids[key] = money(limit);
  }
  return {
    saldo_wallet: money(data.saldo_wallet),
    saldo_hold: money(data.saldo_hold),
    financial_review_required: data.financial_review_required === true,
    heldDeposits,
    autoBids,
    transactions: data.transactions.map(value => {
      const transaction = object(value);
      if (!transaction.id && !transaction.id_transaksi) throw new Error('ID transaksi tidak valid.');
      if (transaction.id_user !== undefined && id(transaction.id_user) !== userID) throw new Error('Riwayat saldo bukan milik akun ini.');
      return { ...transaction, id: String(transaction.id || transaction.id_transaksi), id_user: userID, nominal: money(transaction.nominal) } as WalletTransaction;
    }),
  };
}
