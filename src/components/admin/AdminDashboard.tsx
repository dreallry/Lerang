import { useMemo } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah, formatDateIndo } from '../../utils/formatters';
import { dateKey, inDateRange, paymentSeries, validRange, verifiedPayments } from '../../utils/reporting';
import { useReportRange } from './useReportRange';
import { DateRangeFilter } from './DateRangeFilter';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export function AdminDashboard({ onNavigate }: { onNavigate: (view: string, id?: number) => void }) {
  const { lelangList, barangList, pembayaranList, historyList, accountDataStatus, catalogStatus, accountUpdatedAt, reloadAccountData, reloadCatalog } = useAuction();
  const [range, setRange] = useReportRange();
  const valid = validRange(range);
  const ready = accountDataStatus === 'ready' && catalogStatus === 'ready';
  const paid = verifiedPayments(pembayaranList, range);
  const omzet = paid.reduce((sum, invoice) => sum + invoice.jumlah_pembayaran, 0);
  const commissions = paid.reduce((sum, invoice) => sum + invoice.biaya_komisi_platform, 0);
  const bids = historyList.filter(bid => inDateRange(bid.created_at, range));
  const series = useMemo(() => paymentSeries(verifiedPayments(pembayaranList, range), range), [pembayaranList, range]);
  const pending = barangList.filter(item => item.status_verifikasi === 'pending').length;
  const active = lelangList.filter(auction => auction.status === 'dibuka').length;
  const excluded = pembayaranList.filter(invoice => invoice.status === 'Sudah Dibayar' && (invoice.legacy_historical || invoice.payment_review_required) && inDateRange(invoice.tgl_pembayaran, range)).length;
  const undated = pembayaranList.filter(invoice => invoice.status === 'Sudah Dibayar' && !dateKey(invoice.tgl_pembayaran)).length;
  const categories = Object.entries(barangList.filter(item => inDateRange(item.tanggal, range)).reduce<Record<string, number>>((counts, item) => { counts[item.kategori] = (counts[item.kategori] || 0) + 1; return counts; }, {}));

  return <div className="admin-page space-y-7 pb-20">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl sm:text-4xl font-medium tracking-tight">Ringkasan lelang</h1><p className="mt-3 text-sm text-muted-foreground">Tinjau nilai lelang dan aktivitas pada periode yang dipilih.</p></div><button type="button" className="button-secondary" onClick={() => { reloadAccountData(); reloadCatalog(); }} disabled={accountDataStatus === 'loading' || catalogStatus === 'loading'}>Muat ulang statistik</button></header>
    <DateRangeFilter value={range} onChange={setRange} />
    <p className="text-sm text-muted-foreground">{accountUpdatedAt ? `Data akun diperbarui ${formatDateIndo(accountUpdatedAt)}.` : 'Memuat data akun.'} Nilai palu dan komisi memakai tanggal pembayaran; bid memakai waktu penawaran. Arsip SQL dan pembayaran yang perlu diperiksa tidak dihitung sebagai pendapatan terverifikasi.</p>
    {!ready && <p role="status" className="border border-border bg-muted p-4 text-sm">{accountDataStatus === 'error' || catalogStatus === 'error' ? 'Pembaruan belum berhasil. Statistik terakhir belum dapat dipastikan; muat ulang data.' : 'Memuat data statistik...'}</p>}
    {valid && ready && <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Statistik dalam rentang tanggal">{[
        ['Nilai palu terbayar', formatRupiah(omzet), 'Sebelum premi, tanpa top up dan ongkir'],
        ['Tagihan lunas', String(paid.length), 'Transaksi nonarsip tanpa penanda pemeriksaan'],
        ['Komisi tagihan lunas', formatRupiah(commissions), 'Komisi tercatat, belum tentu sudah dicairkan'],
        ['Penawaran masuk', String(bids.length), 'Bid tersimpan dalam periode'],
      ].map(([label, value, note]) => <div key={label} className="border border-border bg-card p-5"><h2 className="text-sm text-muted-foreground">{label}</h2><p className="mt-4 break-words text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p></div>)}</section>
      {(excluded > 0 || undated > 0) && <p className="text-sm text-muted-foreground">{excluded} tagihan lunas berstatus arsip/perlu pemeriksaan dikecualikan pada periode ini. {undated} tagihan lunas tidak memiliki tanggal pembayaran valid; gunakan Semua waktu untuk menelusuri catatannya di laporan.</p>}
      <section className="border border-border bg-card p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-medium">Nilai palu terbayar sepanjang periode</h2>
          <p className="mt-2 text-sm text-muted-foreground">{series.length > 0 && series[0].date.length === 10 ? 'Dikelompokkan per hari.' : 'Dikelompokkan per bulan.'} Zona waktu WIB.</p>
        </div>
        {paid.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada pembayaran terverifikasi pada periode ini. Coba rentang lain atau periksa laporan pembayaran.</p> : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 10, right: 15, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis width={70} stroke="var(--muted-foreground)" fontSize={11} tickFormatter={value => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(value)} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} labelFormatter={(_label, rows) => rows[0]?.payload.date || ''} formatter={(value: number) => [formatRupiah(value), 'Nilai palu']} />
                <Bar dataKey="amount" fill="var(--primary)" maxBarSize={64} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <button type="button" className="button-secondary" onClick={() => onNavigate('admin-reports')}>Periksa rincian laporan</button>
      </section>
      <section className="border border-border bg-card p-5 sm:p-6"><h2 className="text-lg font-medium">Barang masuk pada periode</h2><p className="mt-2 text-sm text-muted-foreground">Berdasarkan tanggal barang tercatat, mencakup seluruh kategori dan status kurasi saat ini.</p>{categories.length ? <dl className="mt-4 divide-y divide-border">{categories.map(([name, count]) => <div key={name} className="flex justify-between gap-4 py-3 text-sm"><dt>{name}</dt><dd className="tabular-nums">{count} barang</dd></div>)}</dl> : <p className="mt-5 text-sm text-muted-foreground">Tidak ada barang tercatat pada periode ini.</p>}</section>
    </>}
    <section className="flex flex-wrap items-center gap-4 border-y border-border py-5" aria-label="Pekerjaan saat ini"><h2 className="text-sm font-medium">Saat ini, di luar filter tanggal</h2><button type="button" className="button-secondary" onClick={() => onNavigate('admin-curation')}>Kurasi ({pending})</button><button type="button" className="button-secondary" onClick={() => onNavigate('admin-auctions')}>Lelang aktif ({active})</button><button type="button" className="button-secondary" onClick={() => onNavigate('fulfillment')}>Kelola pengiriman</button></section>
  </div>;
}
