import React, { useMemo, useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { WithdrawalQueue } from './WithdrawalQueue';
import { AdminPaymentMonitor } from './AdminPaymentMonitor';
import { formatDateIndo } from '../../utils/formatters';
import { operationsTasks, type QueueKind } from '../../utils/operations';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Gavel,
  PackageCheck,
  ShieldAlert,
  WalletCards,
} from 'lucide-react';

interface OperationsCenterProps {
  onNavigate: (view: string, id?: number) => void;
}

export const OperationsCenter: React.FC<OperationsCenterProps> = ({ onNavigate }) => {
  const { barangList, lelangList, pembayaranList, fulfillmentList, historyList, currentOfficer, accountDataStatus, accountUpdatedAt, reloadAccountData } = useAuction();
  const [queue, setQueue] = useState<QueueKind | 'all'>('all');
  const [search, setSearch] = useState('');

  const pendingItems = barangList.filter((item) => item.status_verifikasi === 'pending');
  const activeAuctions = lelangList.filter((auction) => auction.status === 'dibuka');
  const watchedBids = historyList.filter((bid) => bid.created_at).length;

  const allTasks = useMemo(() => operationsTasks(barangList, lelangList, pembayaranList, fulfillmentList, Date.now()), [barangList, lelangList, pembayaranList, fulfillmentList]);
  const matches = allTasks.filter(task => `${task.title} ${task.detail} ${task.id}`.toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id')));
  const tasks = matches.filter(task => queue === 'all' || task.kind === queue);

  const queueTabs: { id: QueueKind | 'all'; label: string }[] = [
    { id: 'all', label: 'Semua tugas' }, { id: 'review', label: 'Kurasi' },
    { id: 'auction', label: 'Lelang live' }, { id: 'payment', label: 'Pembayaran' }, { id: 'delivery', label: 'Pengiriman' },
  ];

  return (
    <div className="admin-page space-y-8 pb-20">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="text-sm text-muted-foreground">Ruang kerja operasional</p>
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight mt-2">Pusat operasi</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">Halo, {currentOfficer?.nama_petugas || 'tim operasional'}. Mulai dari kasus yang bisa menghambat transaksi hari ini.</p>
        </div>
        <button type="button" onClick={() => onNavigate('admin-auctions')} className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 text-sm font-bold hover:opacity-90 focus-ring">
          <Gavel className="w-4 h-4" /> Buka lot baru
        </button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3 text-sm"><p className="text-muted-foreground">{accountDataStatus === 'loading' ? 'Memuat data operasional...' : accountDataStatus === 'error' ? 'Pembaruan gagal. Angka berikut berasal dari data terakhir.' : accountUpdatedAt ? `Data akun diperbarui ${formatDateIndo(accountUpdatedAt)}.` : 'Data operasional belum tersedia.'}</p><button type="button" className="button-secondary" disabled={accountDataStatus === 'loading'} onClick={reloadAccountData}>Muat ulang data operasional</button></div>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Ringkasan operasional">
        {[
          { label: 'Perlu keputusan', value: pendingItems.length, note: 'pengajuan C2C', icon: FileCheck2 },
          { label: 'Sedang live', value: activeAuctions.length, note: 'lot aktif', icon: Gavel },
          { label: 'Perlu cek pembayaran', value: allTasks.filter(task => task.kind === 'payment').length, note: 'termasuk arsip', icon: WalletCards },
          { label: 'Bid tercatat', value: watchedBids, note: 'riwayat tersimpan', icon: ShieldAlert },
        ].map((metric) => (
          <div key={metric.label} className="bg-card border border-border rounded-lg p-5 min-h-[132px] flex flex-col justify-between gap-5">
            <div className="flex items-start justify-between gap-3"><span className="text-sm text-muted-foreground">{metric.label}</span><metric.icon className="w-4 h-4 text-muted-foreground" /></div>
            <div><strong className="font-medium tabular-nums text-3xl">{metric.value}</strong><span className="text-sm text-muted-foreground ml-2">{metric.note}</span></div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] gap-6 items-start">
        <section className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-5 border-b border-border flex flex-col gap-4">
            <div><h2 className="font-bold text-lg">Antrean tindakan</h2><p className="text-sm text-muted-foreground mt-1">Masalah pembayaran dan jadwal yang lewat ditampilkan lebih awal. Arsip berada di urutan akhir.</p></div>
            <div><label htmlFor="operations-search" className="mb-2 block text-sm">Cari tugas atau nama barang</label><input id="operations-search" className="catalog-input w-full" value={search} onChange={event => setSearch(event.target.value)} /></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter antrean">
              {queueTabs.map((tab) => <button key={tab.id} type="button" aria-pressed={queue === tab.id} onClick={() => setQueue(tab.id)} className={`min-h-11 px-3 rounded text-sm border focus-ring ${queue === tab.id ? 'bg-foreground text-background border-foreground' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`}>{tab.label} <span className="ml-1 tabular-nums">{matches.filter(task => tab.id === 'all' || task.kind === tab.id).length}</span></button>)}
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
              <h3 className="font-medium text-lg mt-3">{accountDataStatus !== 'ready' ? 'Data antrean belum terkonfirmasi' : 'Tidak ada tugas yang sesuai'}</h3>
              <p className="text-sm text-muted-foreground mt-2">{accountDataStatus !== 'ready' ? 'Tunggu pembaruan atau muat ulang data operasional.' : 'Ubah pencarian atau pilih filter lain untuk melihat tugas.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <div key={task.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    {task.kind === 'review' ? <FileCheck2 className="w-5 h-5" /> : task.kind === 'auction' ? <Gavel className="w-5 h-5" /> : <Clock3 className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-sm">{task.title}</h3><span className="text-xs border border-border rounded px-2 py-1 text-muted-foreground">{task.meta}</span></div>
                    <p className="text-sm text-muted-foreground mt-2">{task.detail}</p>
                  </div>
                  <button type="button" onClick={() => onNavigate(task.view, task.recordId)} aria-label={`Buka ${task.title}`} className="min-h-11 shrink-0 inline-flex items-center justify-center gap-2 rounded border border-border px-3 text-sm font-medium hover:bg-muted focus-ring">Buka <ArrowRight className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5"><div className="flex items-center gap-2 text-lg font-medium"><AlertTriangle className="w-4 h-4 text-muted-foreground" /> Penanganan kasus</div><p className="text-sm text-muted-foreground mt-3 leading-relaxed">Periksa bukti, catat alasan keputusan, lalu teruskan ke administrator jika kasus menyangkut dana, sengketa, atau dugaan manipulasi tawaran.</p><button type="button" onClick={() => onNavigate('admin-reports')} className="mt-4 min-h-11 w-full rounded border border-border text-sm font-medium hover:bg-muted focus-ring">Buka laporan</button></div>
          <div className="bg-card border border-border rounded-lg p-5"><div className="flex items-center gap-2"><PackageCheck className="w-4 h-4 text-muted-foreground" /><h2 className="font-medium text-lg">Sebelum sesi dibuka</h2></div><ul className="mt-4 space-y-3 text-sm text-muted-foreground"><li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />Foto dan deskripsi sudah jelas</li><li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />Dokumen sesuai kategori</li><li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />Jadwal dan uang jaminan terlihat</li></ul></div>
        </aside>
      </div>
      <AdminPaymentMonitor onUpdated={reloadAccountData} />
      <WithdrawalQueue />
    </div>
  );
};
