import React from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatCompactRupiah, formatDateIndo } from '../../utils/formatters';
import { ArrowRight, FilePlus2, Gavel, Receipt } from 'lucide-react';
import { GuestGuardView } from '../common/GuestGuardView';

interface UserJourneyProps { onNavigate: (view: string, id?: number) => void; }

export const UserJourney: React.FC<UserJourneyProps> = ({ onNavigate }) => {
  const { currentUser, barangList, lelangList, pembayaranList } = useAuction();
  if (!currentUser) return <GuestGuardView title="Perjalanan Saya" description="Masuk untuk melihat pengajuan barang, bid aktif, tagihan, dan proses pengiriman dalam satu tempat." icon={<Gavel className="w-8 h-8 text-primary" />} onNavigate={onNavigate} />;

  const myItems = barangList.filter((item) => item.id_user === currentUser.id_user);
  const myAuctions = lelangList.filter((auction) => auction.id_user === currentUser.id_user);
  const myInvoices = pembayaranList.filter((payment) => payment.id_user === currentUser.id_user);
  const steps = [
    { label: 'Ajukan barang', count: myItems.length, note: 'Pantau verifikasi dan jadwal lelang.', icon: FilePlus2, action: () => onNavigate('c2c-submit') },
    { label: 'Ikuti lelang', count: myAuctions.length, note: 'Lot yang sedang Anda pimpin.', icon: Gavel, action: () => onNavigate('catalog') },
    { label: 'Selesaikan pembayaran', count: myInvoices.filter((invoice) => invoice.status === 'Belum Dibayar').length, note: 'Invoice pemenang yang perlu dicek.', icon: Receipt, action: () => onNavigate('invoices') },
  ];

  return (
    <div className="space-y-8 pb-20">
      <header className="border-b border-border pb-6">
        <p className="text-sm text-muted-foreground">Akun saya</p>
        <h1 className="text-3xl sm:text-4xl font-medium tracking-tight mt-2">Aktivitas saya</h1>
        <p className="text-sm text-muted-foreground mt-3">Pantau pengajuan barang, tawaran, dan pembayaran.</p>
      </header>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Ringkasan aktivitas">
        {steps.map((step) => (
          <button key={step.label} type="button" onClick={step.action} className="text-left bg-card border border-border rounded-lg p-5 hover:border-primary transition-colors focus-ring">
            <div className="flex items-center justify-between gap-3">
              <step.icon className="w-5 h-5 text-muted-foreground" />
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
            <strong className="block mt-5 text-3xl font-medium tabular-nums">{step.count}</strong>
            <span className="block mt-2 text-sm font-medium">{step.label}</span>
            <span className="block mt-1 text-sm text-muted-foreground">{step.note}</span>
          </button>
        ))}
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] gap-6 items-start">
        <section className="bg-card border border-border rounded-lg p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
            <div><h2 className="font-medium text-xl">Pengajuan barang</h2><p className="text-sm text-muted-foreground mt-1">Hasil pemeriksaan dan catatan petugas.</p></div>
            <button type="button" onClick={() => onNavigate('c2c-submit')} className="min-h-11 px-4 rounded bg-primary text-primary-foreground text-sm font-medium focus-ring">Ajukan barang</button>
          </div>
          <div className="divide-y divide-border">
            {myItems.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada barang yang diajukan.</p> : myItems.map((item) => (
              <div key={item.id_barang} className="flex gap-4 py-5">
                {item.foto_barang[0] ? <img src={item.foto_barang[0]} alt="" className="w-16 h-16 rounded object-cover shrink-0 bg-muted" /> : <div className="w-16 h-16 rounded bg-muted shrink-0" />}
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium">{item.nama_barang}</strong>
                  <span className="inline-block mt-2 text-xs border border-border rounded px-2 py-1">{item.status_verifikasi === 'pending' ? 'Menunggu verifikasi' : item.status_verifikasi === 'approved' ? 'Disetujui' : 'Perlu perbaikan'}</span>
                  <p className="text-sm text-muted-foreground mt-2">{item.catatan_kurasi || 'Belum ada catatan petugas.'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="bg-card border border-border rounded-lg p-5 sm:p-6">
          <h2 className="font-medium text-xl">Setelah menang</h2>
          <ol className="mt-4 divide-y divide-border text-sm text-muted-foreground">
            <li className="py-3">Bayar harga palu dan biaya yang tercantum di tagihan.</li>
            <li className="py-3">Periksa batas pembayaran dan status jaminan.</li>
            <li className="py-3">Konfirmasi penerimaan setelah memeriksa barang.</li>
          </ol>
          {myInvoices[0] && <div className="mt-4 pt-4 border-t border-border"><span className="text-sm text-muted-foreground">Tagihan terbaru</span><strong className="block mt-1 text-2xl font-medium tabular-nums">{formatCompactRupiah(myInvoices[0].sisa_tagihan)}</strong><span className="block mt-2 text-sm text-muted-foreground">Jatuh tempo {formatDateIndo(myInvoices[0].batas_pembayaran)}</span></div>}
          <button type="button" onClick={() => onNavigate('invoices')} className="mt-5 min-h-11 w-full rounded border border-border text-sm font-medium hover:bg-muted focus-ring">Lihat tagihan</button>
        </section>
      </div>
    </div>
  );
};
