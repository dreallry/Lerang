import React, { useState, useEffect, useMemo } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { CountdownTimer } from '../common/CountdownTimer';
import { AuctionCard } from '../common/AuctionCard';
import { formatRupiah, formatCompactRupiah, formatDateIndo, calculateBuyersPremium, getDynamicIncrement } from '../../utils/formatters';
import {
  Gavel,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Clock,
  FileText,
  FileCheck,
  ChevronLeft,
  Bot,
  TrendingUp,
  Receipt,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  X,
  Zap,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { soundFX } from '../../utils/soundEffects';
import type { AuctionDetailItem } from '../../types';

interface LiveAuctionRoomProps {
  lelangId: number;
  onBack: () => void;
  onNavigate: (view: string) => void;
  onSelectAuction?: (lelangId: number) => void;
}

export const LiveAuctionRoom: React.FC<LiveAuctionRoomProps> = (props) => {
  const { getAuctionDetail, catalogStatus, reloadCatalog } = useAuction();
  const auctionData = getAuctionDetail(props.lelangId);
  if (!auctionData) {
    return (
      <div className="border-y border-border px-6 py-20 text-center" role={catalogStatus === 'error' ? 'alert' : 'status'}>
        <h1 className="section-title">{catalogStatus === 'loading' ? 'Memuat detail lot...' : catalogStatus === 'error' ? 'Detail lot belum dapat dimuat' : 'Lot tidak ditemukan'}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{catalogStatus === 'error' ? 'Koneksi ke layanan lelang terputus. Coba muat kembali.' : catalogStatus === 'ready' ? 'Periksa nomor lot atau kembali ke katalog.' : 'Foto dan informasi lelang sedang dimuat.'}</p>
        {catalogStatus !== 'loading' && <button type="button" onClick={catalogStatus === 'error' ? reloadCatalog : props.onBack} className="button-secondary mt-6">{catalogStatus === 'error' ? 'Muat ulang detail' : 'Kembali ke katalog'}</button>}
      </div>
    );
  }
  return <AuctionRoomContent key={props.lelangId} {...props} auctionData={auctionData} />;
};

const AuctionRoomContent: React.FC<LiveAuctionRoomProps & { auctionData: AuctionDetailItem }> = ({
  lelangId,
  auctionData,
  onBack,
  onNavigate,
  onSelectAuction,
}) => {
  const {
    allJoinedAuctions,
    currentRole,
    currentUser,
    hasDepositLocked,
    lockDepositForAuction,
    placeBid,
    setupAutoBid,
    cancelAutoBid,
    getUserAutoBid,
    openMidtransModal,
  } = useAuction();

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customBidAmount, setCustomBidAmount] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedDocModal, setSelectedDocModal] = useState<string | null>(null);

  // Bidding & Auto-Bid UX states
  const [biddingMode, setBiddingMode] = useState<'manual' | 'autobid'>('manual');
  const [autoBidMaxInput, setAutoBidMaxInput] = useState<string>('');
  const [autoBidStatusMessage, setAutoBidStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Confirmation Modal state
  const [isBidConfirmOpen, setIsBidConfirmOpen] = useState(false);
  const [pendingBidAmount, setPendingBidAmount] = useState<number | null>(null);

  useEffect(() => {
    if (auctionData) {
      const minNext = auctionData.lelang.minimum_bid ?? auctionData.lelang.harga_akhir + (auctionData.lelang.bid_increment ?? auctionData.lelang.kelipatan_minimal);
      setCustomBidAmount(String(minNext));
      if (!autoBidMaxInput) {
        setAutoBidMaxInput(String(minNext + (auctionData.lelang.bid_increment ?? auctionData.lelang.kelipatan_minimal) * 5));
      }
    }
  }, [auctionData?.lelang.harga_akhir, auctionData?.lelang.bid_increment, auctionData?.lelang.minimum_bid, auctionData?.lelang.kelipatan_minimal]);

  // Sound FX state
  const [isSoundMuted, setIsSoundMuted] = useState(() => soundFX.getMuted());
  const toggleSound = () => {
    const next = !isSoundMuted;
    soundFX.setMuted(next);
    setIsSoundMuted(next);
  };

  const { lelang, barang, penawarTertinggi, penjual, petugas, history } = auctionData;
  const isLocked = currentUser ? hasDepositLocked(lelang.id_lelang, currentUser.id_user) : false;
  const isWinning = currentUser && lelang.id_user === currentUser.id_user;
  const isAuctionClosed = lelang.status === 'ditutup' || lelang.status === 'dibatalkan';
  const bidderLabel = penawarTertinggi?.nama_lengkap || (lelang.id_user ? `Peserta #${lelang.id_user}` : 'Tidak ada penawaran');
  const isOwner = Boolean(currentUser && barang.id_user && barang.id_user === currentUser.id_user);
  const isNotStarted = lelang.status === 'terjadwal' || new Date(lelang.tgl_mulai).getTime() > Date.now();
  const bidIncrement = lelang.bid_increment ?? lelang.kelipatan_minimal;
  const minNextBid = lelang.minimum_bid ?? lelang.harga_akhir + bidIncrement;

  const hasUserBid = Boolean(currentUser && history.some((h) => h.id_user === currentUser.id_user));
  const isOutbid = hasUserBid && !isWinning && !isAuctionClosed;

  // Sound cue on outbid
  const prevIsWinningRef = React.useRef(isWinning);
  useEffect(() => {
    if (prevIsWinningRef.current && !isWinning && hasUserBid && !isAuctionClosed) {
      soundFX.playOutbid();
    }
    prevIsWinningRef.current = isWinning;
  }, [isWinning, hasUserBid, isAuctionClosed]);

  const relatedAuctions = useMemo(() => {
    if (!allJoinedAuctions) return [];
    const published = allJoinedAuctions.filter(item => item.lelang.status !== 'draft' && item.barang.status_verifikasi === 'approved');
    const sameCategory = published.filter(
      (a) =>
        a.barang.kategori === barang.kategori &&
        a.lelang.id_lelang !== lelang.id_lelang &&
        a.lelang.status === 'dibuka'
    );
    const otherActive = published.filter(
      (a) =>
        a.barang.kategori !== barang.kategori &&
        a.lelang.id_lelang !== lelang.id_lelang &&
        a.lelang.status === 'dibuka'
    );
    const combined = [...sameCategory, ...otherActive];
    if (combined.length < 5) {
      const rest = published.filter(
        (a) =>
          a.lelang.id_lelang !== lelang.id_lelang &&
          !combined.some((c) => c.lelang.id_lelang === a.lelang.id_lelang)
      );
      return [...combined, ...rest];
    }
    return combined;
  }, [allJoinedAuctions, barang.kategori, lelang.id_lelang]);

  const handleLockDeposit = async () => {
    if (isSubmitting) return;
    if (!currentUser) {
      onNavigate('login');
      return;
    }

    // Inline Deposit Replenish Check (Sprint 2)
    if (currentUser.saldo_wallet < lelang.uang_jaminan) {
      const shortage = lelang.uang_jaminan - currentUser.saldo_wallet;
      const topUpAmount = Math.max(100000, shortage);
      openMidtransModal({
        type: 'topup',
        amount: topUpAmount,
        title: `Top-Up & Kunci Jaminan Lot #${lelang.id_lelang}`,
        refId: `AUTO-LOCK-${lelang.id_lelang}`,
        onSuccess: () => {
          setStatusMessage({
            type: 'success',
            text: 'Top-up telah diverifikasi. Klik Kunci Jaminan kembali untuk mengunci saldo pada lot ini.',
          });
        },
      });
      return;
    }

    setIsSubmitting(true);
    const res = await lockDepositForAuction(lelang.id_lelang);
    setIsSubmitting(false);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.message });
      soundFX.playGavel();
    } else {
      setStatusMessage({ type: 'error', text: res.message });
    }
  };

  const activeAutoBid = currentUser ? getUserAutoBid(lelang.id_lelang, currentUser.id_user) : null;

  const handleInitiateBid = (amount?: number) => {
    setStatusMessage(null);
    const targetAmount = amount !== undefined ? amount : Number(customBidAmount);
    if (!Number.isSafeInteger(targetAmount) || targetAmount < minNextBid) {
      setStatusMessage({
        type: 'error',
        text: `Tawaran minimal adalah Rp ${minNextBid.toLocaleString('id-ID')} (kelipatan Rp ${bidIncrement.toLocaleString('id-ID')}).`,
      });
      return;
    }

    setPendingBidAmount(targetAmount);
    setIsBidConfirmOpen(true);
  };

  const handleConfirmBidAction = async () => {
    if (isSubmitting) return;
    if (!pendingBidAmount) return;
    setIsSubmitting(true);
    const res = await placeBid(lelang.id_lelang, pendingBidAmount);
    setIsSubmitting(false);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.message });
      setIsBidConfirmOpen(false);
      soundFX.playGavel();
    } else {
      setStatusMessage({ type: 'error', text: res.message });
      setIsBidConfirmOpen(false);
    }
  };

  const handleQuickIncrement = (multiplier: number) => {
    const target = minNextBid + bidIncrement * (multiplier - 1);
    handleInitiateBid(target);
  };

  const handleSetupAutoBid = async () => {
    if (isSubmitting) return;
    setAutoBidStatusMessage(null);
    const maxVal = Number(autoBidMaxInput);
    if (!Number.isSafeInteger(maxVal) || maxVal < minNextBid) {
      setAutoBidStatusMessage({
        type: 'error',
        text: `Batas maksimal Auto-Bid minimal harus Rp ${minNextBid.toLocaleString('id-ID')}.`,
      });
      return;
    }

    setIsSubmitting(true);
    const res = await setupAutoBid(lelang.id_lelang, maxVal);
    setIsSubmitting(false);
    if (res.success) {
      setAutoBidStatusMessage({ type: 'success', text: res.message });
    } else {
      setAutoBidStatusMessage({ type: 'error', text: res.message });
    }
  };

  const handleCancelAutoBidAction = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const res = await cancelAutoBid(lelang.id_lelang);
    setIsSubmitting(false);
    if (res.success) {
      setAutoBidStatusMessage({ type: 'success', text: res.message });
    } else {
      setAutoBidStatusMessage({ type: 'error', text: res.message });
    }
  };

  return (
    <div className="space-y-8 pb-24 max-w-6xl mx-auto">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/80">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Kembali ke Daftar Barang</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Status lelang */}
          <span className="text-sm font-medium text-primary">{lelang.status === 'dibatalkan' ? 'Lelang dibatalkan' : isAuctionClosed ? 'Lelang selesai' : isNotStarted ? 'Lelang akan datang' : 'Sedang berlangsung'}</span>

          {/* Minimalist icon-only sound toggle */}
          <button
            type="button"
            onClick={toggleSound}
            className="flex h-11 w-11 items-center justify-center border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            title={isSoundMuted ? 'Nyalakan efek suara palu lelang' : 'Senyapkan efek suara'}
            aria-label={isSoundMuted ? 'Nyalakan efek suara palu lelang' : 'Senyapkan efek suara'}
          >
            {isSoundMuted ? (
              <VolumeX className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Volume2 className="w-4 h-4 text-primary" />
            )}
          </button>
        </div>
      </div>

      {/* Outbid Fast Recovery Banner */}
      {isOutbid && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-foreground">
                Tawaranmu Terlewati!
              </div>
              <div className="text-[11px] text-muted-foreground">
                Saat ini tawaran tertinggi ada di angka <strong className="text-foreground font-mono">{formatRupiah(lelang.harga_akhir)}</strong> oleh <strong className="text-foreground">{penawarTertinggi?.nama_lengkap || 'peserta lain'}</strong>. Mau ajukan tawaran baru?
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleInitiateBid(minNextBid)}
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl shadow-xs hover:opacity-90 transition cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
          >
            <Gavel className="w-3.5 h-3.5" />
            <span>Tawar Balik {formatCompactRupiah(minNextBid)}</span>
          </button>
        </div>
      )}

      {/* 1. CLOSED AUCTION RECOMMENDATION SECTION (Auctionet Style - media_1789546294412.png) */}
      {isAuctionClosed && (
        <section className="bg-card border border-border rounded-lg p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-border/80">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium mb-3">
                <span className="w-2 h-2 rounded-full bg-neutral-400"></span>
                <span>Lelang selesai · {history.length ? 'Tawaran akhir' : 'Harga pembukaan'} {formatRupiah(history.length ? lelang.harga_akhir : barang.harga_awal)}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-normal tracking-tight text-foreground font-sans">
                Lelang ini telah berakhir. Temukan lot serupa pilihan lainnya:
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Lot ini sudah ditutup. Anda dapat melihat lot lain yang masih aktif.
              </p>
            </div>

            <button
              type="button"
              onClick={onBack}
              className="text-xs font-semibold text-primary hover:underline self-start sm:self-center shrink-0 flex items-center gap-1 cursor-pointer"
            >
              <span>Lihat Semua Katalog</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Cards Row (5 columns matching screenshot) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
            {relatedAuctions.slice(0, 5).map((rel) => (
              <AuctionCard
                key={rel.lelang.id_lelang}
                auction={rel}
                onSelect={(id) => {
                  if (onSelectAuction) onSelectAuction(id);
                  else onNavigate('auction-detail');
                }}
                imageAspectRatio="portrait"
              />
            ))}
          </div>
        </section>
      )}

      {/* Main 2-Column Grid with Generous White Space */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        {/* LEFT COLUMN: Gallery, Specifications, Documents */}
        <div className="lg:col-span-7 space-y-8">
          {/* Photo Showcase */}
          <div className="space-y-3">
            <div className="aspect-[4/3] w-full overflow-hidden bg-muted flex items-center justify-center">
              {barang.foto_barang.length ? <img
                src={barang.foto_barang[activePhotoIndex] || barang.foto_barang[0]}
                alt={barang.nama_barang}
                className="w-full h-full object-contain"
              /> : <span className="text-sm text-muted-foreground">Foto belum tersedia</span>}
            </div>

            {barang.foto_barang.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {barang.foto_barang.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActivePhotoIndex(idx)}
                    aria-label={`Tampilkan foto ${idx + 1}`}
                    aria-pressed={activePhotoIndex === idx}
                    className={`w-20 h-16 rounded overflow-hidden border-2 flex-shrink-0 transition-colors ${
                      activePhotoIndex === idx
                        ? 'border-primary'
                        : 'border-border opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt={`Sudut ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div className="space-y-3">
            <span className="text-xs text-muted-foreground font-medium">{barang.kategori}</span>
            <h1 className="text-3xl sm:text-4xl font-medium text-foreground leading-tight tracking-tight">
              {barang.nama_barang}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line pt-2">
              {barang.deskripsi_barang}
            </p>
          </div>

          {/* Specifications (Clean Simple Table) */}
          {barang.spesifikasi && Object.keys(barang.spesifikasi).length > 0 && (
            <div className="pt-6 border-t border-border space-y-3">
              <h2 className="text-lg font-medium text-foreground">
                Spesifikasi
              </h2>
              <div className="divide-y divide-border border-y border-border text-sm">
                {Object.entries(barang.spesifikasi).map(([k, v]) => (
                  <div key={k} className="py-3 grid grid-cols-2 gap-4">
                    <span className="text-muted-foreground break-words">{k}</span>
                    <span className="text-foreground break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legal Documents */}
          {barang.dokumen_pendukung && barang.dokumen_pendukung.length > 0 && (
            <div className="pt-6 border-t border-border space-y-3">
              <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-primary" />
                <span>Dokumen pendukung</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {barang.dokumen_pendukung.map((doc, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedDocModal(doc)}
                    className="p-3 rounded border border-border hover:bg-muted text-left flex items-center justify-between gap-3 text-sm transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground break-all">{doc}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">Lihat</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Verification & Seller Information Card */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              <span>
                Petugas: <strong className="text-foreground">{petugas?.nama_petugas || 'Belum dicantumkan'}</strong>
              </span>
            </div>
            <div className="text-[11.5px] border-t sm:border-t-0 pt-2 sm:pt-0 sm:border-l sm:pl-3 border-border">
              <span>Pemilik Barang: </span>
              <strong className="text-foreground">{barang.id_user ? penjual?.nama_lengkap || 'Peserta terdaftar' : 'Lerang'}</strong>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Focused Bidding Box */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-28">
          {/* Price & Timer Card */}
          <div className="p-5 sm:p-6 rounded-lg border border-border bg-card space-y-5">
            <div>
              <span className="text-xs text-muted-foreground block">
                {history.length ? isAuctionClosed ? 'Tawaran akhir' : 'Penawaran tertinggi' : 'Harga pembukaan'}
              </span>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground mt-2 break-words">
                {formatRupiah(history.length ? lelang.harga_akhir : barang.harga_awal)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {isAuctionClosed ? (
                  <>{lelang.legacy_historical ? 'Penawar tercatat: ' : 'Pemenang akhir: '}<strong className="text-foreground">{bidderLabel}</strong></>
                ) : (
                  <>Penawar teratas: <strong className="text-foreground">{bidderLabel}</strong></>
                )}
              </div>
            </div>

            {/* Countdown or Closed Status Tag */}
            {isAuctionClosed ? (
              <div className="py-2.5 px-3.5 rounded-xl bg-muted/60 border border-border flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Status Lelang:</span>
                <span className="font-semibold text-foreground px-2 py-0.5 rounded bg-muted-foreground/15">
                  Telah Berakhir
                </span>
              </div>
            ) : (
              <CountdownTimer
                startDate={lelang.tgl_mulai}
                endDate={lelang.tgl_selesai}
                status={lelang.status}
              />
            )}

            {/* Reserve Price Status Notice */}
            {lelang.reserve_price && (
              <div
                className={`py-2 px-3 rounded-xl border text-xs flex items-center justify-between ${
                  lelang.is_reserve_met || lelang.harga_akhir >= lelang.reserve_price
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <span>
                    {lelang.is_reserve_met || lelang.harga_akhir >= lelang.reserve_price
                      ? 'Harga cadangan terpenuhi'
                      : 'Harga cadangan belum tercapai'}
                  </span>
                </div>
                {(isOwner || currentRole !== 'masyarakat') && (
                  <span className="font-mono font-bold text-[11px]">
                    Min: {formatCompactRupiah(lelang.reserve_price)}
                  </span>
                )}
              </div>
            )}

            {/* Anti-Snipe Extension Badge */}
            {lelang.is_extended && !isAuctionClosed && (
              <div className="py-2 px-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs flex items-center gap-1.5 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>Waktu lelang diperpanjang (+3 Menit) karena penawaran di menit akhir (Anti-Snipe)</span>
              </div>
            )}

            {/* Winner notice if closed */}
            {isAuctionClosed && isWinning && !lelang.legacy_historical && (
              <div className="p-4 rounded-xl bg-secondary border border-border space-y-2">
                <div className="font-semibold text-sm text-foreground">
                  Selamat! Anda Memenangkan Lelang Ini
                </div>
                <p className="text-xs text-muted-foreground">
                  Silakan selesaikan pelunasan sisa tagihan Anda melalui integrasi Midtrans.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('invoices')}
                  className="w-full py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-lg border border-border flex items-center justify-center gap-2"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Buka Halaman Tagihan</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {isAuctionClosed && (!isWinning || lelang.legacy_historical) && (
              <div className="p-4 rounded-xl bg-muted text-xs text-muted-foreground text-center">
                {lelang.legacy_historical ? 'Riwayat lelang lama. Hubungi petugas untuk memeriksa pembayaran atau jaminan dari lelang ini.' : 'Lelang telah selesai. Periksa dompet untuk melihat status jaminan sesuai hasil lelang.'}
              </div>
            )}
          </div>

          {/* Bidding Actions Card */}
          {!isAuctionClosed && (
            <div className="p-5 sm:p-6 rounded-lg border border-border bg-card space-y-5">
              {isOwner ? (
                /* Anti-Shill Bidding Guard */
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2 text-xs">
                  <div className="font-semibold text-amber-500 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Kepemilikan Barang Lot Ini</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Anda adalah pemilik sah dari barang konsinyasi ini. Berdasarkan regulasi lelang dan sistem anti-manipulasi harga, pemilik dilarang mengajukan penawaran terhadap barang sendiri.
                  </p>
                </div>
              ) : isNotStarted ? (
                /* Upcoming Auction Guard */
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-3 text-xs">
                  <div className="font-semibold text-blue-500 flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>Lelang Belum Dimulai</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Sesi penawaran resmi baru akan dibuka pada <strong className="text-foreground">{new Date(lelang.tgl_mulai).toLocaleString('id-ID')}</strong>. Anda dapat mengunci jaminan sekarang agar siap menawar saat waktu mulai tiba.
                  </p>
                  {!isLocked && currentUser && (
                    <button
                      type="button"
                      onClick={handleLockDeposit}
                      disabled={isSubmitting}
                      className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border flex items-center justify-center gap-2 transition hover:opacity-90 cursor-pointer shadow-xs"
                    >
                      <Unlock className="w-4 h-4" />
                      <span>Kunci Jaminan Awal ({formatCompactRupiah(lelang.uang_jaminan)})</span>
                    </button>
                  )}
                  {isLocked && (
                    <div className="p-2.5 rounded-lg bg-secondary text-xs text-foreground font-medium flex items-center justify-between border border-border">
                      <span>Uang jaminan sudah terkunci</span>
                      <span className="font-mono text-muted-foreground">{formatCompactRupiah(lelang.uang_jaminan)}</span>
                    </div>
                  )}
                </div>
              ) : !currentUser ? (
                /* Guest State */
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3 text-xs">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-primary" />
                    <span>Ikuti Penawaran Lot Ini</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Anda sedang menjelajah sebagai Tamu. Silakan masuk ke akun Anda untuk mengunci uang jaminan (NPL) dan mulai mengajukan penawaran.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onNavigate('login')}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition cursor-pointer text-center"
                    >
                      Masuk ke Akun
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('register')}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-secondary hover:bg-muted text-foreground font-medium text-xs border border-border transition cursor-pointer text-center"
                    >
                      Daftar Baru
                    </button>
                  </div>
                </div>
              ) : !isLocked ? (
                /* Step 2: Lock Deposit */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-xs">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-primary" />
                      <span>Kunci Jaminan untuk Mulai Menawar</span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Untuk menjaga keamanan dan ketertiban lelang, kamu perlu mengunci jaminan sebesar <strong className="text-foreground font-mono tabular-nums">{formatRupiah(lelang.uang_jaminan)}</strong> dari saldo dompetmu.
                    </p>
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11.5px] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>Jaminan mengikuti status lelang dan akan diproses sesuai hasil lelang.</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleLockDeposit}
                      disabled={isSubmitting}
                    className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border flex items-center justify-center gap-2 transition hover:opacity-90 cursor-pointer shadow-xs"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>
                      {currentUser && currentUser.saldo_wallet < lelang.uang_jaminan
                        ? `Isi Saldo & Kunci Jaminan (${formatCompactRupiah(lelang.uang_jaminan)})`
                        : `Kunci Jaminan (${formatCompactRupiah(lelang.uang_jaminan)}) & Mulai Tawar`}
                    </span>
                  </button>
                </div>
              ) : (
                /* Step 3: Place Bid */
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 font-medium flex items-center justify-between border border-emerald-500/20">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Jaminan Aktif · Siap Menawar</span>
                    </span>
                    <span className="font-mono font-semibold">{formatCompactRupiah(lelang.uang_jaminan)}</span>
                  </div>

                  {/* Mode Switcher */}
                  <div className="flex p-1 bg-muted rounded-xl border border-border text-xs">
                    <button
                      type="button"
                      onClick={() => setBiddingMode('manual')}
                      className={`flex-1 py-1.5 font-semibold rounded-lg transition ${
                        biddingMode === 'manual'
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Tawaran Manual
                    </button>
                    <button
                      type="button"
                      onClick={() => setBiddingMode('autobid')}
                      className={`flex-1 py-1.5 font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
                        biddingMode === 'autobid'
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 text-primary" />
                      <span>Auto-Bid (Proxy)</span>
                      {activeAutoBid && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                    </button>
                  </div>

                  {biddingMode === 'manual' ? (
                    <div className="space-y-4">
                      {/* Quick Increment Buttons */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">
                          Pilihan Kelipatan Cepat:
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => handleQuickIncrement(1)}
                            className="py-2.5 rounded-lg border border-border bg-card hover:bg-muted font-mono font-semibold text-xs text-foreground transition cursor-pointer"
                          >
                            +{formatCompactRupiah(bidIncrement)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickIncrement(2)}
                            className="py-2.5 rounded-lg border border-border bg-card hover:bg-muted font-mono font-semibold text-xs text-foreground transition cursor-pointer"
                          >
                            +{formatCompactRupiah(bidIncrement * 2)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickIncrement(5)}
                            className="py-2.5 rounded-lg border border-border bg-card hover:bg-muted font-mono font-semibold text-xs text-foreground transition cursor-pointer"
                          >
                            +{formatCompactRupiah(bidIncrement * 5)}
                          </button>
                        </div>
                      </div>

                      {/* Custom Bid Input */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Nominal Penawaran</span>
                          <span className="font-mono">Min: {formatRupiah(minNextBid)}</span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-xs font-bold text-muted-foreground font-mono">Rp</span>
                          <input
                            type="number"
                            step={bidIncrement}
                            min={minNextBid}
                            value={customBidAmount}
                            onChange={(e) => setCustomBidAmount(e.target.value)}
                            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2 text-sm font-mono font-bold text-foreground focus:border-primary outline-none"
                          />
                        </div>

                        {/* Buyer's Premium Transparent Preview */}
                        {(() => {
                          const targetAmount = customBidAmount ? Number(customBidAmount) : minNextBid;
                          if (!isNaN(targetAmount) && targetAmount > 0) {
                            const premium = calculateBuyersPremium(targetAmount);
                            return (
                              <div className="p-2.5 rounded-lg bg-muted/40 border border-border space-y-1 text-[11px] text-muted-foreground">
                                <div className="flex justify-between">
                                  <span>Tawaran Hammer:</span>
                                  <span className="font-mono text-foreground">{formatRupiah(targetAmount)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Premi Pembeli ({premium.percent}%):</span>
                                  <span className="font-mono text-foreground">+{formatRupiah(premium.premium)}</span>
                                </div>
                                <div className="flex justify-between pt-1 border-t border-border font-semibold text-foreground">
                                  <span>Estimasi Total Pelunasan:</span>
                                  <span className="font-mono text-primary">{formatRupiah(premium.total)}</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Anti-Snipe & Anti-Bot Protection Badge */}
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 pt-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span>Dilindungi Anti-Snipe (Maks 5x) & jeda minimal 5 detik antar bid.</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleInitiateBid()}
                        className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs border border-border flex items-center justify-center gap-2 transition hover:opacity-90 shadow-sm cursor-pointer"
                      >
                        <Gavel className="w-4 h-4" />
                        <span>{isSubmitting ? 'Mengirim...' : 'Kirim Penawaran'}</span>
                      </button>
                    </div>
                  ) : (
                    /* Auto-Bid (Proxy Bidding) Panel */
                    <div className="space-y-4">
                      {activeAutoBid ? (
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                              <Zap className="w-4 h-4 text-emerald-500" />
                              Auto-Bid Sedang Aktif
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white font-mono text-[10px] font-bold">
                              AKTIF
                            </span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-card border border-border space-y-1 font-mono">
                            <div className="flex justify-between text-muted-foreground">
                              <span>Batas Anggaran Maksimal:</span>
                              <strong className="text-foreground text-sm">{formatRupiah(activeAutoBid)}</strong>
                            </div>
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                              <span>Kenaikan Otomatis:</span>
                              <span>+{formatCompactRupiah(bidIncrement)} tiap tawaran rival</span>
                            </div>
                          </div>

                          <p className="text-muted-foreground leading-relaxed text-[11px]">
                            Sistem secara otomatis menaikkan tawaran atas nama Anda setiap kali penawar lain masuk, sampai batas maksimal anggaran Anda.
                          </p>

                          <button
                            type="button"
                            onClick={handleCancelAutoBidAction}
                      disabled={isSubmitting}
                            className="w-full py-2 px-3 rounded-lg border border-destructive/40 bg-destructive/10 hover:bg-destructive/20 text-destructive font-semibold transition cursor-pointer"
                          >
                            Batalkan Auto-Bid
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3.5 text-xs">
                          <div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1.5">
                            <strong className="text-foreground flex items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-primary" /> Cara Kerja Auto-Bid (Proxy)
                            </strong>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              Tentukan batas maksimal yang bersedia Anda bayar. Sistem hanya akan menaikkan tawaran sebesar 1 kelipatan ({formatCompactRupiah(bidIncrement)}) saat ada tawaran lawan, menjaga harga tetap serendah mungkin untuk Anda.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex justify-between text-muted-foreground">
                              <span>Batas Maksimal Anggaran Anda (Rp)</span>
                              <span className="font-mono">Min: {formatRupiah(minNextBid)}</span>
                            </div>
                            <input
                              type="number"
                              step={bidIncrement}
                              min={minNextBid}
                              placeholder="Masukkan batas maksimal Anda"
                              value={autoBidMaxInput}
                              onChange={(e) => setAutoBidMaxInput(e.target.value)}
                              className="w-full bg-card border border-border rounded-xl px-4 py-2 text-sm font-mono font-bold text-foreground focus:border-primary outline-none"
                            />
                          </div>

                          {/* Quick Auto-Bid Presets */}
                          <div className="grid grid-cols-3 gap-2">
                            {[3, 5, 10].map((mul) => {
                              const presetVal = minNextBid + bidIncrement * mul;
                              return (
                                <button
                                  key={mul}
                                  type="button"
                                  onClick={() => setAutoBidMaxInput(String(presetVal))}
                                  className="py-1.5 px-2 rounded-lg border border-border bg-card hover:bg-muted font-mono text-[11px] text-foreground text-center transition cursor-pointer"
                                >
                                  {formatCompactRupiah(presetVal)}
                                </button>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            onClick={handleSetupAutoBid}
                      disabled={isSubmitting}
                            className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs border border-border flex items-center justify-center gap-2 transition hover:opacity-90 shadow-sm cursor-pointer"
                          >
                            <Zap className="w-4 h-4" />
                            <span>Aktifkan Auto-Bid</span>
                          </button>
                        </div>
                      )}

                      {autoBidStatusMessage && (
                        <div
                          className={`p-3 rounded-xl text-xs font-medium border ${
                            autoBidStatusMessage.type === 'success'
                              ? 'bg-secondary text-foreground border-border'
                              : 'bg-destructive/10 text-destructive border-destructive/20'
                          }`}
                        >
                          {autoBidStatusMessage.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {statusMessage && (
                <div
                  className={`p-3 rounded-xl text-xs font-medium border ${
                    statusMessage.type === 'success'
                      ? 'bg-secondary text-foreground border-border'
                      : 'bg-destructive/10 text-destructive border-destructive/20'
                  }`}
                >
                  {statusMessage.text}
                </div>
              )}

            </div>
          )}

          {/* Bidding History Feed */}
          <div className="p-5 sm:p-6 rounded-lg border border-border bg-card space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-primary" /> Riwayat Penawaran
              </span>
              <span className="text-muted-foreground font-mono">{history.length} tawaran</span>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {history.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  {isAuctionClosed ? 'Tidak ada penawaran yang tercatat pada lelang ini.' : 'Belum ada penawaran. Jadilah penawar pertama!'}
                </div>
              ) : (
                history.map((h, index) => {
                  const isTop = index === 0;
                  const isMine = currentUser && h.id_user === currentUser.id_user;

                  return (
                    <div
                      key={h.id_history}
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                        isTop ? 'bg-secondary border-border font-semibold' : 'bg-card border-border/70'
                      }`}
                    >
                      <div>
                        <div className="text-foreground">
                          {h.nama_user} {isMine && <span className="text-[10px] text-primary font-bold">(Anda)</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">{formatDateIndo(h.created_at)}</div>
                      </div>
                      <div className="text-right font-mono font-bold text-foreground">
                        {formatRupiah(h.penawaran_harga)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Document View Modal */}
      {selectedDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-medium text-foreground break-all">{selectedDocModal}</h2>
              <button
                onClick={() => setSelectedDocModal(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 rounded-xl bg-muted/40 text-center space-y-2 text-xs">
              <ShieldCheck className="w-8 h-8 text-primary mx-auto" />
              <div className="font-semibold text-foreground">Dokumen Resmi Terverifikasi</div>
              <p className="text-muted-foreground">
                Keaslian dokumen telah diperiksa dan disahkan oleh Petugas Balai Lelang ({petugas?.nama_petugas}).
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedDocModal(null)}
              className="w-full py-2 bg-muted text-foreground rounded-lg text-xs font-semibold"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Bid Confirmation Modal */}
      {isBidConfirmOpen && pendingBidAmount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Gavel className="w-4 h-4 text-primary" />
                <span>Konfirmasi Pengajuan Penawaran</span>
              </div>
              <button
                type="button"
                onClick={() => setIsBidConfirmOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Abnormal Bid Warning */}
            {pendingBidAmount > lelang.harga_akhir * 2 && (
              <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 space-y-1 text-destructive text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Peringatan: Penawaran Lebih Dari 2x Lipat!</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Tawaran Anda ({formatRupiah(pendingBidAmount)}) lebih dari dua kali lipat penawaran saat ini ({formatRupiah(lelang.harga_akhir)}). Mohon periksa kembali agar tidak salah memasukkan nominal.
                </p>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <img
                  src={barang.foto_barang?.[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=200'}
                  alt={barang.nama_barang}
                  className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="font-semibold text-foreground truncate">{barang.nama_barang}</h4>
                  <span className="text-[11px] text-muted-foreground font-mono">Lot #{lelang.id_lelang}</span>
                </div>
              </div>

              {/* Breakdown */}
              {(() => {
                const premium = calculateBuyersPremium(pendingBidAmount);
                const sisaPelunasan = Math.max(0, premium.total - lelang.uang_jaminan);

                return (
                  <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-2 font-mono text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Harga Penawaran (Hammer):</span>
                      <strong className="text-foreground">{formatRupiah(pendingBidAmount)}</strong>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Premi Pembeli ({premium.percent}%):</span>
                      <span className="text-foreground">+{formatRupiah(premium.premium)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Total Keseluruhan:</span>
                      <span className="text-foreground font-semibold">{formatRupiah(premium.total)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Uang Jaminan (Kredit Dipotong):</span>
                      <span className="text-emerald-600 font-semibold">-{formatRupiah(lelang.uang_jaminan)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border font-bold">
                      <span className="text-foreground">Estimasi Sisa Pelunasan:</span>
                      <span className="text-primary text-sm">{formatRupiah(sisaPelunasan)}</span>
                    </div>
                  </div>
                );
              })()}

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Penawaran lelang bersifat mengikat secara hukum. Jika palu lelang diketuk atas nama Anda, Anda berkewajiban melakukan pelunasan sisa tagihan dalam waktu 24 jam.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsBidConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmBidAction}
                      disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition shadow-xs flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Konfirmasi & Pasang Tawaran</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Mobile Bidding Dock (Sprint 1) */}
      {!isAuctionClosed && !isOwner && !isNotStarted && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border px-4 py-3 shadow-2xl lg:hidden flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider truncate flex items-center gap-1.5">
              {isWinning ? (
                <span className="text-emerald-500 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Anda Memimpin
                </span>
              ) : isOutbid ? (
                <span className="text-destructive font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Terlampaui
                </span>
              ) : (
                'Tawaran Tertinggi'
              )}
            </div>
            <div className="font-mono font-bold text-foreground text-sm truncate">
              {formatRupiah(lelang.harga_akhir)}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!currentUser ? (
              <button
                type="button"
                onClick={() => onNavigate('login')}
                className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-xs hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Masuk Akun</span>
              </button>
            ) : !isLocked ? (
              <button
                type="button"
                onClick={handleLockDeposit}
                      disabled={isSubmitting}
                className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-xs hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Kunci Jaminan</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleInitiateBid(minNextBid)}
                className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-xs hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Gavel className="w-3.5 h-3.5" />
                <span>Tawar {formatCompactRupiah(minNextBid)}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
