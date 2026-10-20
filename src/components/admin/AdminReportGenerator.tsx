import React, { useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah, toDateTimeLocal } from '../../utils/formatters';
import { toCsv } from '../../utils/csv';
import type { TbPembayaran } from '../../types';
import { inDateRange, invoiceDate, validRange, verifiedPayments } from '../../utils/reporting';
import { useReportRange } from './useReportRange';
import { DateRangeFilter } from './DateRangeFilter';
import {
  FileSpreadsheet,
  Download,
  Printer,
  FileText,
  DollarSign,
  Layers,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const paymentStatus = (payment: TbPembayaran) => payment.legacy_historical
  ? `${payment.status} (arsip SQL, perlu pemeriksaan)`
  : payment.payment_review_required ? `${payment.status} (perlu pemeriksaan)` : payment.status;

export const AdminReportGenerator: React.FC = () => {
  const { allJoinedAuctions, pembayaranList, masyarakatList, currentOfficer, accountDataStatus } = useAuction();

  const [statusFilter, setStatusFilter] = useState('all');
  const [reportType, setReportType] = useState<'lelang' | 'pembayaran'>('lelang');
  const [range, setRange] = useReportRange();
  const [includeArchives, setIncludeArchives] = useState(true);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const valid = validRange(range);
  const period = `Periode WIB: ${range.from || 'awal data'} sampai ${range.to || 'akhir data'}`;
  const reportPayments = pembayaranList.filter(payment => (includeArchives || !payment.legacy_historical) && (paymentFilter === 'all' || payment.status === paymentFilter) && inDateRange(invoiceDate(payment), range));

  // Filtered auctions
  const reportAuctions = allJoinedAuctions.filter((item) => {
    if (statusFilter !== 'all' && item.lelang.status !== statusFilter) return false;
    return (includeArchives || !item.lelang.legacy_historical) && inDateRange(item.lelang.tgl_selesai, range);
  });

  // Calculate totals
  const totalOmzetSuccess = verifiedPayments(reportPayments, range)
    .reduce((sum, p) => sum + p.jumlah_pembayaran, 0);

  const totalKomisiPlatform = verifiedPayments(reportPayments, range)
    .reduce((sum, p) => sum + p.biaya_komisi_platform, 0);

  // Generate PDF Report using jsPDF
  const exportPDF = () => {
    if (!valid || accountDataStatus !== 'ready') return;
    const doc = new jsPDF();

    // Header
    doc.setFontSize(16);
    doc.text('LERANG - REKAP LELANG', 14, 20);
    doc.setFontSize(10);
    doc.text('Laporan Rekapitulasi Data Lelang & Transaksi Pembayaran', 14, 26);
    doc.text(`Dicetak Oleh: ${currentOfficer?.nama_petugas || 'Admin'} | Tanggal: ${new Date().toLocaleDateString('id-ID')}`, 14, 32);
    doc.text(period, 14, 38);
    doc.text(`Arsip SQL: ${includeArchives ? 'disertakan' : 'dikecualikan'} | Filter: ${reportType === 'lelang' ? statusFilter : paymentFilter}`, 14, 44);

    // Divider
    doc.line(14, 48, 196, 48);

    if (reportType === 'lelang') {
      const tableData = reportAuctions.map((item) => [
        `#${item.lelang.id_lelang}`,
        item.barang.nama_barang,
        item.barang.kategori,
        formatRupiah(item.barang.harga_awal),
        formatRupiah(item.lelang.harga_akhir),
        item.penawarTertinggi ? item.penawarTertinggi.nama_lengkap : 'Belum Ada',
        item.lelang.status.toUpperCase(),
      ]);

      autoTable(doc, {
        startY: 53,
        head: [['ID', 'Nama Barang', 'Kategori', 'Harga Awal', 'Harga Akhir', 'Pemenang', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [36, 87, 67] },
        styles: { fontSize: 8 },
      });
    } else {
      const tableData = reportPayments.map((p) => {
        const item = allJoinedAuctions.find((a) => a.barang.id_barang === p.id_barang);
        const winner = masyarakatList.find((u) => u.id_user === p.id_user);
        return [
          `INV-${p.id_pembayaran}`,
          item?.barang.nama_barang || `#${p.id_barang}`,
          winner?.nama_lengkap || `User #${p.id_user}`,
          formatRupiah(p.jumlah_pembayaran),
          formatRupiah(p.uang_jaminan_dipotong),
          formatRupiah(p.sisa_tagihan),
          paymentStatus(p),
        ];
      });

      autoTable(doc, {
        startY: 53,
        head: [['No Invoice', 'Barang', 'Pembeli', 'Harga sebelum premi', 'Deposit', 'Sisa Tagihan', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [36, 87, 67] },
        styles: { fontSize: 8 },
      });
    }

    doc.save(`Laporan_Lelang_${toDateTimeLocal(new Date()).slice(0,10)}.pdf`);
  };

  // Export to CSV
  const exportCSV = () => {
    if (!valid || accountDataStatus !== 'ready') return;
    let rows: (string | number)[][];
    if (reportType === 'lelang') {
      rows = [['ID Lelang','Nama Barang','Kategori','Harga Awal','Harga Akhir','Pemenang','Status','Jadwal Selesai','Arsip SQL','Periode WIB'], ...reportAuctions.map(item => [item.lelang.id_lelang,item.barang.nama_barang,item.barang.kategori,item.barang.harga_awal,item.lelang.harga_akhir,item.penawarTertinggi?.nama_lengkap || '-',item.lelang.status,item.lelang.tgl_selesai,item.lelang.legacy_historical ? 'Ya' : 'Tidak',period])];
    } else {
      rows = [['ID Pembayaran','ID Lelang','User ID','Harga Akhir Sebelum Premi','Deposit','Sisa Tagihan','Status','Tanggal Acuan','Periode WIB'], ...reportPayments.map(payment => [payment.id_pembayaran,payment.id_lelang,payment.id_user,payment.jumlah_pembayaran,payment.uang_jaminan_dipotong,payment.sisa_tagihan,paymentStatus(payment),invoiceDate(payment),period])];
    }

    const encodedUri = URL.createObjectURL(new Blob(['\uFEFF',toCsv(rows)], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Rekap_Lelang_${toDateTimeLocal(new Date()).slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(encodedUri),1000);
  };

  return (
    <div className="admin-page space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground flex items-center gap-2.5">
            <FileSpreadsheet className="w-7 h-7 text-primary" />
            <span>Generate & Cetak Laporan Rekapitulasi</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Ekspor rekapitulasi lelang dan pembayaran dalam format PDF atau CSV.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCSV}
            disabled={accountDataStatus !== 'ready' || !valid}
            className="py-2.5 px-4 rounded-xl bg-muted hover:bg-card border border-border text-foreground font-bold text-xs transition flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-primary" />
            <span>Unduh CSV</span>
          </button>
          <button
            type="button"
            onClick={exportPDF}
            disabled={accountDataStatus !== 'ready' || !valid}
            className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs border border-border shadow-sm transition hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>Unduh Laporan PDF</span>
          </button>
        </div>
      </div>

      <DateRangeFilter value={range} onChange={setRange} />
      <p className="text-sm text-muted-foreground">Lelang memakai jadwal selesai. Tagihan lunas memakai tanggal pembayaran; tagihan lain memakai tanggal pembuatan yang tersimpan. Baris tanpa tanggal hanya muncul pada Semua waktu. Nilai palu dan komisi di bawah hanya menghitung tagihan lunas nonarsip yang tidak memerlukan pemeriksaan, tanpa top up atau ongkir.</p>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includeArchives} onChange={event => setIncludeArchives(event.target.checked)} className="h-5 w-5" />Sertakan arsip SQL dalam daftar dan ekspor</label>

      {/* Summary KPI Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-card border border-border flex items-center justify-between gap-4">
          <div>
            <span className="text-[11px] text-muted-foreground block">Lot berstatus ditutup dalam filter</span>
            <span className="text-xl font-bold font-mono text-foreground">
              {reportAuctions.filter((a) => a.lelang.status === 'ditutup').length} Unit
            </span>
          </div>
          <Layers className="w-6 h-6 text-primary" />
        </div>

        <div className="p-4 rounded-lg bg-card border border-border flex items-center justify-between gap-4">
          <div>
            <span className="text-[11px] text-muted-foreground block">Nilai palu terbayar dalam filter</span>
            <span className="text-xl font-bold font-mono text-foreground">
              {formatRupiah(totalOmzetSuccess)}
            </span>
          </div>
          <DollarSign className="w-6 h-6 text-primary" />
        </div>

        <div className="p-4 rounded-lg bg-card border border-border flex items-center justify-between gap-4">
          <div>
            <span className="text-[11px] text-muted-foreground block">Komisi tagihan lunas dalam filter</span>
            <span className="text-xl font-bold font-mono text-foreground">
              {formatRupiah(totalKomisiPlatform)}
            </span>
          </div>
          <DollarSign className="w-6 h-6 text-primary" />
        </div>
      </div>

      {/* Filter and Tab Selector */}
      <div className="p-4 rounded-lg bg-card border border-border flex flex-wrap items-center justify-between gap-4">
        {/* Report Type */}
        <div className="flex items-center gap-1 bg-muted p-1 rounded-xl border border-border text-xs font-semibold">
          <button
            onClick={() => setReportType('lelang')}
            className={`py-1.5 px-3 rounded-lg transition ${
              reportType === 'lelang' ? 'bg-card text-foreground shadow-sm font-bold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Rekap Data Lelang
          </button>
          <button
            onClick={() => setReportType('pembayaran')}
            className={`py-1.5 px-3 rounded-lg transition ${
              reportType === 'pembayaran' ? 'bg-card text-foreground shadow-sm font-bold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Rekap Pembayaran
          </button>
        </div>

        {/* Status filter */}
        {reportType === 'lelang' && <div className="flex items-center gap-2 text-xs">
          <label htmlFor="report-status" className="text-muted-foreground">Filter status lelang:</label>
          <select
            id="report-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-muted border border-border rounded-xl px-3 py-1.5 text-foreground"
          >
            <option value="all">Semua Status</option>
            <option value="ditutup">Hanya Ditutup (Selesai)</option>
            <option value="dibuka">Hanya Dibuka (Aktif)</option>
            <option value="draft">Draft / Lot Pool</option>
            <option value="terjadwal">Terjadwal</option>
            <option value="dibatalkan">Dibatalkan</option>
          </select>
        </div>}
        {reportType === 'pembayaran' && <label className="flex flex-wrap items-center gap-2 text-sm">Status tagihan<select className="catalog-input" value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)}><option value="all">Semua status tagihan</option><option value="Sudah Dibayar">Sudah dibayar</option><option value="Belum Dibayar">Belum dibayar</option><option value="Kadaluarsa">Kedaluwarsa</option></select></label>}
      </div>

      {/* Preview Table */}
      <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <span>Pratinjau Lembar Laporan</span>
        </h3>

        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pratinjau laporan, geser untuk melihat semua kolom">
          {reportType === 'lelang' ? (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-3 px-3">No. Lelang</th>
                  <th className="py-3 px-3">Nama Barang</th>
                  <th className="py-3 px-3">Kategori</th>
                  <th className="py-3 px-3">Harga Limit Awal</th>
                  <th className="py-3 px-3">Harga Akhir</th>
                  <th className="py-3 px-3">Pemenang</th>
                  <th className="py-3 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-medium">
                {reportAuctions.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Tidak ada lelang sesuai filter ini.</td></tr>}
                {reportAuctions.map((item) => (
                  <tr key={item.lelang.id_lelang} className="hover:bg-muted/40">
                    <td className="py-3 px-3 font-mono text-muted-foreground">#{item.lelang.id_lelang}</td>
                    <td className="py-3 px-3 font-semibold text-foreground">{item.barang.nama_barang}</td>
                    <td className="py-3 px-3 text-muted-foreground">{item.barang.kategori}</td>
                    <td className="py-3 px-3 font-mono text-muted-foreground">{formatRupiah(item.barang.harga_awal)}</td>
                    <td className="py-3 px-3 font-mono font-bold text-foreground">
                      {formatRupiah(item.lelang.harga_akhir)}
                    </td>
                    <td className="py-3 px-3 text-foreground">
                      {item.penawarTertinggi ? item.penawarTertinggi.nama_lengkap : '-'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-muted text-[10px] font-bold text-muted-foreground uppercase border border-border">
                        {item.lelang.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-3 px-3">ID Pembayaran</th>
                  <th className="py-3 px-3">ID Lelang</th>
                  <th className="py-3 px-3">Pemenang / Pembeli</th>
                  <th className="py-3 px-3">Harga akhir sebelum premi</th>
                  <th className="py-3 px-3">Deposit Dipotong</th>
                  <th className="py-3 px-3">Sisa Tagihan</th>
                  <th className="py-3 px-3 text-center">Status Pembayaran</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-medium">
                {reportPayments.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Tidak ada tagihan sesuai filter ini.</td></tr>}
                {reportPayments.map((p) => {
                  const winner = masyarakatList.find((u) => u.id_user === p.id_user);
                  return (
                    <tr key={p.id_pembayaran} className="hover:bg-muted/40">
                      <td className="py-3 px-3 font-mono text-muted-foreground">INV-{p.id_pembayaran}</td>
                      <td className="py-3 px-3 font-mono">#{p.id_lelang}</td>
                      <td className="py-3 px-3 text-foreground font-semibold">{winner?.nama_lengkap || `User #${p.id_user}`}</td>
                      <td className="py-3 px-3 font-mono font-bold text-foreground">{formatRupiah(p.jumlah_pembayaran)}</td>
                      <td className="py-3 px-3 font-mono text-muted-foreground">-{formatRupiah(p.uang_jaminan_dipotong)}</td>
                      <td className="py-3 px-3 font-mono text-foreground font-bold">{formatRupiah(p.sisa_tagihan)}</td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            p.status === 'Sudah Dibayar'
                              ? 'bg-secondary text-secondary-foreground border-border'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {paymentStatus(p)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
