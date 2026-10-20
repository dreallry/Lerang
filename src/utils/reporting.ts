import type { TbPembayaran } from '../types';

export interface DateRange { from: string; to: string }
const wib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });

export function validDateKey(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1970-01-01' && value <= '2100-12-31' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateKey(value?: string | Date): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !validDateKey(value.slice(0, 10))) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateKey(value) ? value : null;
  const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(' ', 'T') + '+07:00' : value;
  const date = new Date(text instanceof Date ? text.getTime() : text);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(wib.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validRange(range: DateRange): boolean {
  return (!range.from || validDateKey(range.from)) && (!range.to || validDateKey(range.to)) && (!range.from || !range.to || range.from <= range.to);
}

export function inDateRange(value: string | undefined, range: DateRange): boolean {
  if (!validRange(range)) return false;
  if (!range.from && !range.to) return true;
  const key = dateKey(value);
  return !!key && (!range.from || key >= range.from) && (!range.to || key <= range.to);
}

export function rangePreset(days: number, now = new Date()): DateRange {
  const to = dateKey(now)!;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}

export function invoiceDate(invoice: TbPembayaran): string {
  return invoice.status === 'Sudah Dibayar' ? invoice.tgl_pembayaran : invoice.created_at || invoice.tgl_pembayaran;
}

export function verifiedPayments(invoices: TbPembayaran[], range: DateRange): TbPembayaran[] {
  return invoices.filter(invoice => invoice.status === 'Sudah Dibayar' && !invoice.legacy_historical && !invoice.payment_review_required && !!dateKey(invoice.tgl_pembayaran) && inDateRange(invoice.tgl_pembayaran, range));
}

export function paymentSeries(invoices: TbPembayaran[], range: DateRange) {
  if (!validRange(range)) return [];
  const dated = invoices.map(invoice => ({ invoice, key: dateKey(invoice.tgl_pembayaran) })).filter(row => row.key).sort((a, b) => a.key!.localeCompare(b.key!));
  const from = range.from || dated[0]?.key, to = range.to || dated[dated.length - 1]?.key;
  if (!from || !to) return [];
  const daily = (Date.parse(to) - Date.parse(from)) / 86400000 <= 62;
  const cursor = new Date(`${daily ? from : from.slice(0, 7) + '-01'}T00:00:00Z`);
  const result: { date: string; label: string; amount: number; count: number }[] = [];
  while (cursor.toISOString().slice(0, 10) <= to) {
    const key = cursor.toISOString().slice(0, daily ? 10 : 7);
    const rows = dated.filter(row => row.key!.startsWith(key) && inDateRange(row.invoice.tgl_pembayaran, range));
    result.push({ date: key, label: daily ? `${key.slice(8)}/${key.slice(5, 7)}` : `${key.slice(5, 7)}/${key.slice(0, 4)}`, amount: rows.reduce((sum, row) => sum + row.invoice.jumlah_pembayaran, 0), count: rows.length });
    if (daily) cursor.setUTCDate(cursor.getUTCDate() + 1); else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
