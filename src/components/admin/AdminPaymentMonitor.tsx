import { useCallback, useEffect, useRef, useState } from 'react';
import api, { type AdminPaymentPage, type AdminPaymentStatus } from '../../services/api';
import { authErrorMessage } from '../../utils/authErrors';
import { formatDateIndo, formatRupiah } from '../../utils/formatters';
import { startPolling } from '../../utils/polling';

const labels: Record<AdminPaymentStatus, string> = {
  pending: 'Menunggu', review_required: 'Perlu pemeriksaan', failed: 'Gagal / berakhir', paid: 'Lunas',
};

export function AdminPaymentMonitor({ onUpdated }: { onUpdated: () => void }) {
  const [data, setData] = useState<AdminPaymentPage | null>(null);
  const [status, setStatus] = useState<AdminPaymentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState('');
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const response = await api.getAdminPayments(status, query, page);
      const next = response.data;
      if (!Array.isArray(next?.rows) || !next.counts || !Number.isSafeInteger(next.total) || !Number.isSafeInteger(next.pages)) throw new Error('Daftar pembayaran dari server belum valid.');
      if (id === request.current) { setData(next); setError(''); }
    } catch (err) { if (id === request.current) setError(authErrorMessage(err)); }
    finally { if (id === request.current) setLoading(false); }
  }, [status, query, page]);

  useEffect(() => {
    setData(null); setLoading(true); setNotice('');
    const stop = startPolling(load, 30000);
    return () => { stop(); request.current++; };
  }, [load]);

  const sync = async (orderId: string) => {
    if (checking) return;
    setChecking(orderId); setError(''); setNotice('');
    try {
      const response = await api.syncAdminPayment(orderId);
      setNotice(`${orderId}: ${labels[response.data.status] || 'status diperbarui'}.`);
      onUpdated();
    } catch (err) { setNotice(authErrorMessage(err)); }
    finally { await load(); setChecking(''); }
  };

  return <section id="admin-payments" className="border border-border bg-card p-5 sm:p-6 space-y-5" aria-labelledby="payment-monitor-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl"><h2 id="payment-monitor-title" className="text-xl font-medium">Pembayaran Midtrans</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Telusuri top up dan pelunasan. Cek ulang mengambil status dari Midtrans; saldo dan tagihan diperbarui oleh server setelah nominal cocok.</p>{data && <p className="mt-2 text-sm font-medium">Mode {data.is_production ? 'Produksi' : 'Sandbox (pengujian)'}</p>}</div>
      <button type="button" className="button-secondary" disabled={loading || !!checking} onClick={() => { setLoading(true); void load(); }}>Muat ulang pembayaran</button>
    </div>
    <form className="flex flex-col sm:flex-row gap-3" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
      <div className="flex-1"><label htmlFor="payment-search" className="mb-2 block text-sm">Cari ID order atau ID peserta</label><input id="payment-search" value={search} maxLength={100} disabled={!!checking} onChange={event => setSearch(event.target.value)} className="catalog-input w-full" placeholder="ID order atau nomor peserta" /></div>
      <button type="submit" className="button-secondary sm:self-end" disabled={!!checking}>Cari pembayaran</button>
    </form>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter status pembayaran">
      {(['', 'review_required', 'pending', 'failed', 'paid'] as const).map(value => <button key={value} type="button" aria-pressed={status === value} disabled={!!checking} onClick={() => { setPage(1); setStatus(value); }} className={`min-h-11 border px-3 py-2 text-sm focus-ring ${status === value ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>{value ? labels[value] : 'Semua'}{data && <span className="ml-2 tabular-nums">{value ? data.counts[value] : Object.values(data.counts).reduce((sum, count) => sum + count, 0)}</span>}</button>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error} {data ? 'Daftar berikut adalah data terakhir yang berhasil dimuat.' : 'Gunakan muat ulang pembayaran untuk mencoba lagi.'}</p>}
    {notice && <p role="status" className="text-sm border border-border bg-muted p-3 break-words">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Memuat transaksi pembayaran...</p>}
    {!loading && data?.rows.length === 0 && <p className="text-sm text-muted-foreground">{query || status ? 'Tidak ada pembayaran yang cocok. Ubah pencarian atau filter status.' : 'Belum ada order Midtrans. Order muncul setelah peserta memulai top up atau pelunasan.'}</p>}
    {data && data.rows.length > 0 && <div className="divide-y divide-border">{data.rows.map(row => <article key={row.order_id} className="py-5 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="break-all text-sm font-semibold">{row.order_id}</h3><p className="mt-1 text-sm text-muted-foreground">{row.kind === 'topup' ? 'Top up saldo' : row.kind === 'invoice' ? `Pelunasan tagihan #${row.id_pembayaran || '?'}` : 'Jenis perlu diperiksa'} · Peserta #{row.id_user}</p></div><div><p className="text-sm font-semibold">{row.amount_valid ? formatRupiah(row.amount) : 'Nominal perlu diperiksa'}</p><p className={`mt-1 text-sm ${row.status === 'review_required' ? 'text-destructive' : 'text-muted-foreground'}`}>{labels[row.status]}</p></div></div>
      <p className="text-xs leading-6 text-muted-foreground">Dibuat {formatDateIndo(row.created_at)}. {row.last_checked_at ? `Diperiksa ${formatDateIndo(row.last_checked_at)}.` : 'Belum diperiksa ulang.'}{row.gateway_status && ` Status Midtrans: ${row.gateway_status}.`}</p>
      {row.last_check_error && <p className="text-sm text-destructive">{row.last_check_error}</p>}
      {row.status === 'review_required' && <p className="text-sm leading-6">{row.review_reason || 'Cocokkan dana dan transaksi di dashboard Midtrans. Cek ulang tidak menghapus penanda pemeriksaan atau memproses refund otomatis.'}</p>}
      <button type="button" className="button-secondary" disabled={!!checking || !!error || !row.amount_valid} onClick={() => void sync(row.order_id)}>{checking === row.order_id ? 'Memeriksa Midtrans...' : `Cek ulang ${row.order_id}`}</button>
    </article>)}</div>}
    {data && data.pages > 1 && <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4" aria-label="Halaman pembayaran"><span className="text-sm text-muted-foreground">Halaman {data.page} dari {data.pages} · {data.total} order</span><div className="flex gap-2"><button type="button" className="button-secondary" disabled={data.page <= 1 || loading || !!checking} onClick={() => setPage(data.page - 1)}>Sebelumnya</button><button type="button" className="button-secondary" disabled={data.page >= data.pages || loading || !!checking} onClick={() => setPage(data.page + 1)}>Berikutnya</button></div></nav>}
  </section>;
}
