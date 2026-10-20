import React, { useState, useEffect, useRef } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah, formatDateIndo } from '../../utils/formatters';
import {
  Receipt,
  Clock,
  CreditCard,
  Download,
  ShieldCheck,
  ArrowRight,
  FileText,
  Truck,
  AlertTriangle,
  Timer,
  X,
} from 'lucide-react';
import { GuestGuardView } from '../common/GuestGuardView';

interface UserInvoicesProps {
  onNavigate: (view: string, id?: number) => void;
}

// Realtime countdown timer subcomponent
const InvoiceCountdownTimer: React.FC<{ batasPembayaran: string }> = ({ batasPembayaran }) => {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
    isUrgent: boolean;
    isExpired: boolean;
  }>({ hours: 0, minutes: 0, seconds: 0, isUrgent: false, isExpired: false });

  useEffect(() => {
    const calculateTime = () => {
      const target = new Date(batasPembayaran).getTime();
      const diff = target - Date.now();

      if (!Number.isFinite(target) || diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, isUrgent: false, isExpired: true });
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      const isUrgent = diff < 2 * 60 * 60 * 1000; // < 2 hours

      setTimeLeft({ hours, minutes, seconds, isUrgent, isExpired: false });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [batasPembayaran]);

  if (timeLeft.isExpired) {
    return (
      <div className="flex items-center gap-1.5 text-destructive font-mono font-semibold text-xs">
        <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
        <span>Batas Waktu Berakhir</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-lg border font-semibold ${
        timeLeft.isUrgent
          ? 'bg-destructive/10 text-destructive border-destructive/30 animate-pulse'
          : 'bg-muted/60 text-foreground border-border'
      }`}
    >
      <Timer className="w-3.5 h-3.5" />
      <span>
        {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:
        {String(timeLeft.seconds).padStart(2, '0')}
      </span>
      {timeLeft.isUrgent && <span className="text-[10px] uppercase font-bold text-destructive">Segera Lunasi</span>}
    </div>
  );
};

export const UserInvoices: React.FC<UserInvoicesProps> = ({ onNavigate }) => {
  const { currentUser, currentOfficer, pembayaranList, barangList, openMidtransModal } = useAuction();
  const isStaff = Boolean(currentOfficer);
  const [selectedReceipt, setSelectedReceipt] = useState<number | null>(null);
  const receiptDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = receiptDialog.current;
    if (selectedReceipt) element?.showModal();
    return () => element?.close();
  }, [selectedReceipt]);

  if (!currentUser && !isStaff) {
    return (
      <GuestGuardView
        title="Tagihan & Lot Dimenangkan"
        description="Masuk untuk melihat tagihan lot yang Anda menangkan, melanjutkan pembayaran, dan memeriksa bukti transaksi."
        icon={<Receipt className="w-8 h-8 text-primary" />}
        onNavigate={onNavigate}
      />
    );
  }

  const myInvoices = isStaff ? pembayaranList : pembayaranList.filter((p) => p.id_user === currentUser?.id_user);

  const handlePayInvoice = (invoiceId: number, sisaTagihan: number, itemName: string) => {
    const invoice = myInvoices.find(item => item.id_pembayaran === invoiceId);
    if (isStaff || !invoice || invoice.legacy_historical || invoice.payment_review_required) return;
    openMidtransModal({
      type: 'payment',
      amount: sisaTagihan,
      title: `Pelunasan Lelang: ${itemName}`,
      refId: String(invoiceId),
    });
  };

  const receiptData = myInvoices.find((p) => p.id_pembayaran === selectedReceipt);
  const receiptBarang = receiptData ? barangList.find((b) => b.id_barang === receiptData.id_barang) : null;

  return (
    <div className="space-y-12 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <div className="space-y-2 pb-6 border-b border-border">
        <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
          {isStaff ? 'Tagihan peserta' : 'Tagihan lelang'}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground font-normal max-w-xl leading-relaxed">
          {isStaff ? 'Pantau status pembayaran dari server. Pelunasan hanya dapat dilakukan peserta pemilik tagihan.' : 'Periksa rincian dan batas pembayaran setiap tagihan sebelum melanjutkan ke Midtrans.'}
        </p>
      </div>

      {/* Invoices List */}
      <div>
        {myInvoices.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-lg border border-border p-8 space-y-3">
            <h2 className="text-lg font-medium text-foreground">Belum ada tagihan</h2>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Tagihan akan muncul di sini setelah Anda memenangkan lelang.
            </p>
            <button
              onClick={() => onNavigate('catalog')}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:opacity-90 transition cursor-pointer"
            >
              Cari Barang Lelang
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {myInvoices.map((inv) => {
              const item = barangList.find((b) => b.id_barang === inv.id_barang);
              const isPaid = inv.status === 'Sudah Dibayar';
              const isExpired = inv.status === 'Kadaluarsa';
              const needsReview = inv.legacy_historical || inv.payment_review_required;

              return (
                <div
                  key={inv.id_pembayaran}
                  className="p-5 sm:p-6 rounded-lg border border-border bg-card space-y-5 flex flex-col justify-between"
                >
                  <div className="space-y-4">
                    {/* Invoice Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-muted-foreground">Invoice #{inv.id_pembayaran}</span>
                        {isStaff && <span className="text-muted-foreground">Peserta #{inv.id_user}</span>}
                      </div>
                      <span
                        className={`font-semibold px-2.5 py-0.5 rounded-full text-[11px] ${
                          isPaid
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : isExpired
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {needsReview ? 'Arsip · perlu pemeriksaan' : isPaid ? 'Sudah lunas' : isExpired ? 'Batas waktu terlewat' : 'Menunggu pembayaran'}
                      </span>
                    </div>

                    {/* Item Info */}
                    <div className="flex gap-4 items-center">
                      <img
                        src={item?.foto_barang[0] || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&q=80&w=200'}
                        alt={item?.nama_barang || 'Barang'}
                        className="w-16 h-16 rounded-xl object-cover border border-border flex-shrink-0"
                      />
                      <div>
                        <span className="text-[11px] text-muted-foreground">{item?.kategori}</span>
                        <h2 className="font-medium text-foreground text-lg line-clamp-2">
                          {item?.nama_barang}
                        </h2>
                        <p className="text-xs text-muted-foreground">Lelang #{inv.id_lelang}</p>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-2 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Harga Ketuk Palu (Hammer):</span>
                        <span className="font-mono tabular-nums text-foreground font-semibold">{formatRupiah(inv.jumlah_pembayaran)}</span>
                      </div>
                      {inv.premi_pembeli !== undefined && inv.premi_pembeli > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Premi Pembeli ({inv.premi_persen || 8}%):</span>
                          <span className="font-mono tabular-nums text-foreground font-medium">
                            +{formatRupiah(inv.premi_pembeli)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between text-muted-foreground">
                        <span>Potongan Uang Jaminan:</span>
                        <span className="font-mono tabular-nums text-foreground font-medium text-green-600 dark:text-green-400">
                          -{formatRupiah(inv.uang_jaminan_dipotong)}
                        </span>
                      </div>
                      <div className="pt-2 border-t border-border flex justify-between font-bold text-sm">
                        <span>Sisa Tagihan Pelunasan:</span>
                        <span className="font-mono tabular-nums text-foreground">
                          {isPaid ? 'Rp 0 (Lunas)' : formatRupiah(inv.sisa_tagihan)}
                        </span>
                      </div>
                    </div>

                    {needsReview ? (
                      <p className="border border-border p-3 text-xs text-muted-foreground">Tagihan hasil migrasi sedang diperiksa petugas. Pembayaran dan pemotongan jaminan tidak dilakukan otomatis.</p>
                    ) : isExpired ? (
                      <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                          Batas pembayaran telah lewat. Periksa riwayat dompet untuk melihat pemrosesan jaminan dan status hak pemenang dari server.
                        </div>
                      </div>
                    ) : !isPaid ? (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> Batas Pelunasan:
                          </span>
                          <span className="font-mono text-muted-foreground text-[11px]">{formatDateIndo(inv.batas_pembayaran)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Hitung Mundur:</span>
                          <InvoiceCountdownTimer batasPembayaran={inv.batas_pembayaran} />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div className="space-y-2 pt-2">
                    {needsReview ? (
                      <div className="border border-border px-4 py-3 text-xs text-muted-foreground">Hubungi petugas untuk pemeriksaan tagihan arsip.</div>
                    ) : isExpired ? (
                      <div className="w-full py-2.5 px-4 rounded-xl bg-muted/60 text-muted-foreground text-center text-xs font-medium border border-border">
                        Batas Waktu Pembayaran Terlewat
                      </div>
                    ) : !isPaid && isStaff ? (
                      <p className="border border-border p-3 text-sm text-muted-foreground">Menunggu pembayaran peserta. Status diperbarui dari Midtrans oleh server.</p>
                    ) : !isPaid ? (
                      <button
                        type="button"
                        onClick={() =>
                          handlePayInvoice(inv.id_pembayaran, inv.sisa_tagihan, item?.nama_barang || 'Barang Lelang')
                        }
                        className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border flex items-center justify-center gap-2 hover:opacity-90 transition shadow-xs cursor-pointer"
                      >
                        <CreditCard className="w-4 h-4" />
                        <span>Bayar Sisa Tagihan Sekarang</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => onNavigate('fulfillment', inv.id_pembayaran)}
                          className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground hover:opacity-90 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
                        >
                          <Truck className="w-4 h-4" />
                          <span>Pengiriman & Pelacakan Paket</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedReceipt(inv.id_pembayaran)}
                          className="w-full py-2 px-4 rounded-xl bg-muted text-foreground hover:bg-card border border-border text-xs font-medium transition flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          <span>Lihat bukti transaksi</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Official Certificate / Receipt Modal */}
      {selectedReceipt && receiptData && receiptBarang && (
        <dialog ref={receiptDialog} aria-label="Bukti transaksi lelang" onCancel={event => { event.preventDefault(); setSelectedReceipt(null); }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg border-0 bg-transparent p-0 text-foreground backdrop:bg-foreground/40">
          <div className="bg-card border border-border rounded-lg max-w-lg w-full p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-primary" />
                <div>
                  <h2 className="font-medium text-foreground text-lg">Bukti transaksi lelang</h2>
                  <p className="text-xs text-muted-foreground">Rincian pembayaran yang tercatat di server</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup bukti transaksi"
                onClick={() => setSelectedReceipt(null)}
                className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Nomor Invoice:</span>
                <span className="font-mono text-foreground font-bold">INV-{receiptData.id_pembayaran}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Pemenang:</span>
                <span className="text-foreground font-bold">{isStaff ? `Peserta #${receiptData.id_user}` : currentUser?.nama_lengkap}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Barang Lelang:</span>
                <span className="text-foreground font-semibold">{receiptBarang.nama_barang}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Harga Akhir:</span>
                <span className="font-mono text-foreground font-bold">{formatRupiah(receiptData.jumlah_pembayaran)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Metode Pembayaran:</span>
                <span className="text-foreground font-semibold">{receiptData.metode_pembayaran || 'Midtrans Snap'}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="w-1/2 py-2.5 bg-muted hover:bg-card border border-border text-foreground rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Cetak Dokumen</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="w-1/2 py-2.5 bg-primary text-primary-foreground border border-border rounded-xl text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};
