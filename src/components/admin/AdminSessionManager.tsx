import React, { useState, useEffect } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { SesiType, TbSesiLelang } from '../../types';
import { AdminDialog } from '../common/AdminDialog';
import { useFormFeedback } from '../common/FormFeedback';
import { formatRupiah, formatDateIndo, calculateTimeLeft, toDateTimeLocal } from '../../utils/formatters';
import {
  CalendarDays,
  Plus,
  Inbox,
  Clock,
  Radio,
  CheckCircle2,
  Trash2,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  AlertTriangle,
  MoveRight,
  Layers,
  X,
} from 'lucide-react';

interface AdminSessionManagerProps {
  onNavigate: (view: string, id?: number) => void;
}

const PRESET_BANNERS = [
  {
    label: 'Klasik & Heritage',
    url: 'https://images.unsplash.com/photo-1582561424760-0321d75e81fa?auto=format&fit=crop&q=80&w=1200',
  },
  {
    label: 'Horologi & Optik',
    url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&q=80&w=1200',
  },
  {
    label: 'Koleksi Seni & Lukisan',
    url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=1200',
  },
  {
    label: 'Kendaraan & Motorsport',
    url: 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&q=80&w=1200',
  },
];

export const AdminSessionManager: React.FC<AdminSessionManagerProps> = ({ onNavigate }) => {
  const {
    currentRole,
    sesiLelangList,
    lelangList,
    barangList,
    allJoinedAuctions,
    createSession,
    assignToSession,
    removeFromSession,
    cancelSession,
  } = useAuction();

  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'pool' | 'upcoming' | 'live' | 'closed'>('pool');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { showError, clearFeedback } = useFormFeedback();
  const [toast, setToastState] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const setToast = (notice: typeof toast) => {
    setToastState(notice);
    if (notice?.type === 'error') showError(notice.message);
    else if (notice) clearFeedback();
  };

  // Selected lots from Lot Pool for bulk assignment
  const [selectedPoolLotIds, setSelectedPoolLotIds] = useState<number[]>([]);
  const [targetSessionId, setTargetSessionId] = useState<number | ''>('');

  // Move lot modal state
  const [movingLotId, setMovingLotId] = useState<number | null>(null);
  const [moveTargetSessionId, setMoveTargetSessionId] = useState<number | ''>('');

  // Create Session form state
  const now = new Date();
  const defaultStartTime = toDateTimeLocal(new Date(now.getTime() + 12 * 60 * 60 * 1000));
  const [judul, setJudul] = useState('');
  const [deskripsi, setDeskripsi] = useState('');
  const [tipe, setTipe] = useState<SesiType>('reguler');
  const [tglMulai, setTglMulai] = useState(defaultStartTime);
  const [durasiJam, setDurasiJam] = useState('24');
  const [bannerUrl, setBannerUrl] = useState(PRESET_BANNERS[0].url);
  const [kurator, setKurator] = useState('');

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (currentRole === 'masyarakat') {
    return (
      <div className="text-center py-20 bg-card rounded-lg border border-border p-8 space-y-4 max-w-lg mx-auto">
        <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
        <h1 className="text-xl font-medium text-foreground">Akses khusus petugas</h1>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Halaman manajemen sesi dan kurasi lelang ini hanya dapat diakses oleh petugas lelang resmi.
        </p>
        <button
          onClick={() => onNavigate('catalog')}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold cursor-pointer"
        >
          Kembali ke Katalog
        </button>
      </div>
    );
  }

  // Filter sessions by status
  const upcomingSessions = sesiLelangList.filter((s) => s.status === 'upcoming');
  const liveSessions = sesiLelangList.filter((s) => s.status === 'live');
  const closedSessions = sesiLelangList.filter((s) => s.status === 'closed');

  // Lot Pool: Lots that have status 'draft'
  const poolLots = allJoinedAuctions.filter((a) => a.lelang.status === 'draft');

  // Handle lot checkbox toggle in Lot Pool
  const toggleSelectLot = (id: number) => {
    setSelectedPoolLotIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllPool = () => {
    if (selectedPoolLotIds.length === poolLots.length) {
      setSelectedPoolLotIds([]);
    } else {
      setSelectedPoolLotIds(poolLots.map((p) => p.lelang.id_lelang));
    }
  };

  // Bulk assign selected lots to a session
  const handleAssignSelectedToSession = async () => {
    if (isSaving) return;
    if (!targetSessionId) {
      setToast({ type: 'error', message: 'Pilih sesi tujuan terlebih dahulu.' });
      return;
    }
    if (selectedPoolLotIds.length === 0) {
      setToast({ type: 'error', message: 'Pilih minimal satu lot dari Lot Pool untuk dijadwalkan.' });
      return;
    }

    setIsSaving(true);
    let successCount = 0;
    let failureMessage = '';
    const failedIDs: number[] = [];
    for (const lotId of selectedPoolLotIds) {
      const result = await assignToSession(lotId, Number(targetSessionId));
      if (result.success) successCount++;
      else { failedIDs.push(lotId); failureMessage = result.message; }
    }
    setIsSaving(false);
    setToast({ type: failedIDs.length ? 'error' : 'success', message: `${successCount} lot berhasil dijadwalkan.${failedIDs.length ? ` ${failedIDs.length} lot belum tersimpan: ${failureMessage}` : ''}` });
    setSelectedPoolLotIds(failedIDs);
    if (!failedIDs.length) setTargetSessionId('');
  };

  // Move a lot to another upcoming session
  const handleExecuteMoveLot = async () => {
    if (isSaving) return;
    if (!movingLotId || !moveTargetSessionId) return;
    setIsSaving(true);
    const res = await assignToSession(movingLotId, Number(moveTargetSessionId));
    setIsSaving(false);
    if (res.success) {
      setToast({ type: 'success', message: res.message });
      setMovingLotId(null);
      setMoveTargetSessionId('');
    } else {
      setToast({ type: 'error', message: res.message });
    }
  };

  // Create session submit
  const handleCreateSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!judul.trim()) {
      setToast({ type: 'error', message: 'Judul sesi lelang wajib diisi.' });
      return;
    }
    const startMs = new Date(tglMulai).getTime();
    if (isNaN(startMs) || startMs <= Date.now()) {
      setToast({ type: 'error', message: 'Waktu mulai sesi harus di masa depan.' });
      return;
    }

    setIsSaving(true);
    const res = await createSession({
      judul: judul.trim(),
      deskripsi: deskripsi.trim(),
      tipe,
      tgl_mulai: new Date(tglMulai).toISOString(),
      durasi_default_jam: Number(durasiJam),
      gambar_banner: bannerUrl,
      kurator: kurator.trim(),
    });

    setIsSaving(false);
    if (res.success) {
      setToast({ type: 'success', message: res.message });
      setShowCreateModal(false);
      setJudul('');
      setDeskripsi('');
      setActiveTab('upcoming');
    } else {
      setToast({ type: 'error', message: res.message });
    }
  };

  return (
    <div className="admin-page space-y-8 pb-20">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`p-4 rounded-lg border text-sm flex items-center justify-between gap-4 ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-destructive/10 border-destructive/20 text-destructive'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-xs opacity-70 hover:opacity-100 px-2 py-0.5 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground flex items-center gap-2.5">
            <CalendarDays className="w-7 h-7 text-primary" />
            <span>Manajemen Sesi Lelang & Lot Pool</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Kelola pengelompokan batch lot lelang, jadwal go-live otomatis, dan pemindahan lot antar sesi.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded font-medium text-sm border border-primary flex items-center justify-center gap-2 hover:opacity-90 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Buat Sesi Baru</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border text-xs font-semibold gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('pool')}
          className={`pb-3 px-4 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'pool'
              ? 'border-primary text-foreground font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Inbox className="w-4 h-4 text-primary" />
          <span>Lot Pool (Draft)</span>
          <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[11px] font-mono">
            {poolLots.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('upcoming')}
          className={`pb-3 px-4 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'upcoming'
              ? 'border-primary text-foreground font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="w-4 h-4 text-blue-500" />
          <span>Sesi Mendatang</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[11px] font-mono">
            {upcomingSessions.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('live')}
          className={`pb-3 px-4 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'live'
              ? 'border-primary text-foreground font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
          <span>Sesi Live</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[11px] font-mono">
            {liveSessions.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('closed')}
          className={`pb-3 px-4 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'closed'
              ? 'border-primary text-foreground font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
          <span>Riwayat Selesai</span>
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-mono">
            {closedSessions.length}
          </span>
        </button>
      </div>

      {/* TAB 1: LOT POOL (DRAFT) */}
      {activeTab === 'pool' && (
        <div className="space-y-6">
          {/* Action Bar for scheduling selected lots */}
          {poolLots.length > 0 && (
            <div className="p-4 rounded-lg bg-card border border-border flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedPoolLotIds.length > 0 && selectedPoolLotIds.length === poolLots.length}
                  onChange={handleSelectAllPool}
                  className="rounded border-border text-primary cursor-pointer w-4 h-4"
                  id="selectAllPool"
                />
                <label htmlFor="selectAllPool" className="text-xs font-semibold cursor-pointer">
                  Pilih Semua ({selectedPoolLotIds.length} dipilih)
                </label>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={targetSessionId}
                  onChange={(e) => setTargetSessionId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 sm:w-64 bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:border-primary outline-none"
                >
                  <option value="">-- Pilih Sesi Tujuan --</option>
                  {upcomingSessions.map((s) => (
                    <option key={s.id_sesi} value={s.id_sesi}>
                      {s.judul} ({formatDateIndo(s.tgl_mulai)})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={isSaving || !targetSessionId || selectedPoolLotIds.length === 0}
                  onClick={handleAssignSelectedToSession}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold border border-border disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <span>Jadwalkan ({selectedPoolLotIds.length})</span>
                  <MoveRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {poolLots.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-lg border border-border p-8 space-y-3">
              <Inbox className="w-12 h-12 text-muted-foreground mx-auto" />
              <h2 className="text-lg font-medium text-foreground">Belum ada lot siap dijadwalkan</h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Semua lot lelang telah dijadwalkan ke sesi lelang. Barang baru yang disetujui kurator atau dibuat oleh petugas akan otomatis masuk ke sini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {poolLots.map((item) => {
                const isSelected = selectedPoolLotIds.includes(item.lelang.id_lelang);

                return (
                  <div
                    key={item.lelang.id_lelang}
                    onClick={() => toggleSelectLot(item.lelang.id_lelang)}
                    className={`p-5 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between space-y-4 ${
                      isSelected
                        ? 'bg-primary/5 border-primary shadow-sm'
                        : 'bg-card border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-border text-primary cursor-pointer w-4 h-4"
                          />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Lot #{item.lelang.id_lelang}
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-muted text-foreground border border-border">
                          {item.barang.kategori}
                        </span>
                      </div>

                      <div className="flex gap-3">
                        <img
                          src={item.barang.foto_barang[0] || 'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400'}
                          alt={item.barang.nama_barang}
                          className="w-16 h-16 rounded-xl object-cover border border-border shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400';
                          }}
                        />
                        <div className="min-w-0 space-y-1">
                          <h4 className="font-bold text-foreground text-xs line-clamp-2">
                            {item.barang.nama_barang}
                          </h4>
                          <div className="font-mono font-bold text-xs text-foreground">
                            {formatRupiah(item.lelang.harga_akhir)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Jaminan: {formatRupiah(item.lelang.uang_jaminan)}
                          </div>
                        </div>
                      </div>

                      {item.barang.reserve_price ? (
                        <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 p-2 rounded-lg border border-border flex justify-between">
                          <span>Reserve Price:</span>
                          <span className="font-semibold text-foreground">
                            {formatRupiah(item.barang.reserve_price)}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="pt-2 border-t border-border flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {item.barang.id_user ? 'Barang C2C' : 'Balai Lelang'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-semibold">
                        Menunggu Sesi
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: UPCOMING SESSIONS */}
      {activeTab === 'upcoming' && (
        <div className="space-y-6">
          {upcomingSessions.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-lg border border-border p-8 space-y-3">
              <CalendarDays className="w-12 h-12 text-muted-foreground mx-auto" />
              <h2 className="text-lg font-medium text-foreground">Belum ada sesi mendatang</h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Buat sesi lelang baru untuk mulai menjadwalkan batch lot lelang dan membuka early preview bagi pengguna.
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer"
              >
                + Buat Sesi Baru
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {upcomingSessions.map((sesi) => {
                const sessionLots = allJoinedAuctions.filter((a) =>
                  sesi.id_lelang_list.includes(a.lelang.id_lelang)
                );

                return (
                  <div
                    key={sesi.id_sesi}
                    className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5"
                  >
                    {/* Session Header Card */}
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between pb-4 border-b border-border">
                      <div className="flex gap-4 items-center">
                        <img
                          src={sesi.gambar_banner}
                          alt={sesi.judul}
                          className="w-20 h-16 rounded-xl object-cover border border-border shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://images.unsplash.com/photo-1582561424760-0321d75e81fa?auto=format&fit=crop&q=80&w=1200';
                          }}
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/10 text-blue-500 border border-blue-500/20">
                              {sesi.tipe}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              Buka: {formatDateIndo(sesi.tgl_mulai)}
                            </span>
                          </div>
                          <h3 className="font-bold text-foreground text-base">{sesi.judul}</h3>
                          <p className="text-xs text-muted-foreground">{sesi.deskripsi}</p>
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-2 self-end md:self-center">
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              window.confirm(
                                `Yakin ingin membatalkan sesi "${sesi.judul}"? Semua lot di dalamnya akan otomatis dikembalikan ke Lot Pool.`
                              )
                            ) {
                              setIsSaving(true);
                              const res = await cancelSession(sesi.id_sesi);
                              setIsSaving(false);
                                    setToast({ type: res.success ? 'success' : 'error', message: res.message });
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Batalkan Sesi</span>
                        </button>
                      </div>
                    </div>

                    {/* Lots Inside This Session */}
                    <div>
                      <div className="flex items-center justify-between mb-3 text-xs">
                        <strong className="text-foreground">
                          Daftar Lot Terdaftar ({sessionLots.length} lot)
                        </strong>
                        <span className="text-muted-foreground font-light">
                          Durasi lelang lot: {sesi.durasi_default_jam} jam sejak sesi live
                        </span>
                      </div>

                      {sessionLots.length === 0 ? (
                        <div className="p-6 border border-border rounded-lg text-center text-sm text-muted-foreground">
                          Belum ada lot di sesi ini. Buka tab <strong>Lot Pool</strong> untuk menambahkan lot ke sesi ini.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {sessionLots.map((item) => (
                            <div
                              key={item.lelang.id_lelang}
                              className="p-3.5 rounded-xl border border-border bg-muted/20 flex flex-col justify-between space-y-3"
                            >
                              <div className="flex gap-3">
                                <img
                                  src={item.barang.foto_barang[0] || 'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400'}
                                  alt={item.barang.nama_barang}
                                  className="w-14 h-14 rounded-lg object-cover border border-border shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src =
                                      'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400';
                                  }}
                                />
                                <div className="min-w-0 space-y-0.5">
                                  <h5 className="font-bold text-xs text-foreground line-clamp-1">
                                    {item.barang.nama_barang}
                                  </h5>
                                  <div className="text-[11px] font-mono font-bold text-foreground">
                                    {formatRupiah(item.lelang.harga_akhir)}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    Deposit: {formatRupiah(item.lelang.uang_jaminan)}
                                  </div>
                                </div>
                              </div>

                              <div className="pt-2 border-t border-border flex items-center justify-between gap-1 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => setMovingLotId(item.lelang.id_lelang)}
                                  className="text-primary hover:underline font-semibold cursor-pointer"
                                >
                                  Pindah Sesi
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setIsSaving(true);
                                    const res = await removeFromSession(item.lelang.id_lelang);
                                    setIsSaving(false);
                                    setToast({ type: res.success ? 'success' : 'error', message: res.message });
                                  }}
                                  className="text-destructive hover:underline cursor-pointer"
                                >
                                  Tarik ke Pool
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LIVE SESSIONS */}
      {activeTab === 'live' && (
        <div className="space-y-6">
          {liveSessions.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-lg border border-border p-8 space-y-3">
              <Radio className="w-12 h-12 text-muted-foreground mx-auto" />
              <h2 className="text-lg font-medium text-foreground">Tidak ada sesi berlangsung</h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Sesi lelang mendatang akan otomatis berpindah ke status Live dan membuka penawaran lot ketika waktu mulai sesi tiba.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {liveSessions.map((sesi) => {
                const sessionLots = allJoinedAuctions.filter((a) =>
                  sesi.id_lelang_list.includes(a.lelang.id_lelang)
                );

                return (
                  <div
                    key={sesi.id_sesi}
                    className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5"
                  >
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between pb-4 border-b border-border">
                      <div className="flex gap-4 items-center">
                        <img
                          src={sesi.gambar_banner}
                          alt={sesi.judul}
                          className="w-20 h-16 rounded-xl object-cover border border-border shrink-0"
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                              LIVE BIDDING
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              Dibuka sejak: {formatDateIndo(sesi.tgl_mulai)}
                            </span>
                          </div>
                          <h3 className="font-bold text-foreground text-base">{sesi.judul}</h3>
                          <p className="text-xs text-muted-foreground">{sesi.deskripsi}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            window.confirm(
                              `PERINGATAN: Sesi ini sedang aktif berlangsung! Hentikan sesi darurat "${sesi.judul}"? Semua lot aktif akan dibatalkan dan uang jaminan peserta dikembalikan.`
                            )
                          ) {
                            setIsSaving(true);
                              const res = await cancelSession(sesi.id_sesi);
                              setIsSaving(false);
                                    setToast({ type: res.success ? 'success' : 'error', message: res.message });
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Hentikan Sesi Darurat</span>
                      </button>
                    </div>

                    {/* Lot Cards in Live Session */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sessionLots.map((item) => (
                        <div
                          key={item.lelang.id_lelang}
                          className="p-4 rounded-xl border border-border bg-muted/20 space-y-3"
                        >
                          <div className="flex gap-3">
                            <img
                              src={item.barang.foto_barang[0]}
                              alt={item.barang.nama_barang}
                              className="w-16 h-16 rounded-lg object-cover border border-border shrink-0"
                            />
                            <div className="min-w-0 space-y-1">
                              <h5 className="font-bold text-xs text-foreground line-clamp-1">
                                {item.barang.nama_barang}
                              </h5>
                              <div className="text-xs font-mono font-bold text-primary">
                                {formatRupiah(item.lelang.harga_akhir)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {item.totalBids} Tawaran Masuk
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => onNavigate('auction-detail', item.lelang.id_lelang)}
                            className="w-full py-2 bg-card hover:bg-muted border border-border text-foreground rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>Pantau Auction Room</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CLOSED SESSIONS */}
      {activeTab === 'closed' && (
        <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
          <h3 className="text-sm font-bold text-foreground">Riwayat Sesi Lelang Yang Telah Selesai</h3>

          {closedSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Belum ada riwayat sesi yang selesai.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-3 px-3">Judul Sesi</th>
                    <th className="py-3 px-3">Tipe</th>
                    <th className="py-3 px-3">Waktu Mulai</th>
                    <th className="py-3 px-3">Jumlah Lot</th>
                    <th className="py-3 px-3">Kurator</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {closedSessions.map((s) => (
                    <tr key={s.id_sesi} className="hover:bg-muted/40">
                      <td className="py-3 px-3 font-semibold text-foreground">{s.judul}</td>
                      <td className="py-3 px-3 uppercase text-[10px] font-bold">{s.tipe}</td>
                      <td className="py-3 px-3 font-mono text-muted-foreground">{formatDateIndo(s.tgl_mulai)}</td>
                      <td className="py-3 px-3 font-mono">{s.id_lelang_list.length} Lot</td>
                      <td className="py-3 px-3 text-muted-foreground">{s.kurator}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold border border-border">
                          SELESAI
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: CREATE NEW SESSION MODAL */}
      {showCreateModal && (
        <AdminDialog title="Buat sesi lelang" busy={isSaving} onClose={() => setShowCreateModal(false)}>
          <form
            onSubmit={handleCreateSessionSubmit}
            className="relative w-full max-w-lg bg-card border border-border rounded-lg p-6 sm:p-7 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Buat Sesi Lelang Baru</h3>
                <p className="text-xs text-muted-foreground">Jadwalkan batch lelang tematik atau reguler</p>
              </div>
              <button
                type="button"
                disabled={isSaving}
                aria-label="Tutup formulir sesi"
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="session-title" className="text-foreground font-bold block mb-1">Judul Sesi</label>
                <input
                  id="session-title"
                  maxLength={200}
                  type="text"
                  required
                  placeholder="Contoh: Lelang kendaraan Oktober"
                  value={judul}
                  onChange={(e) => setJudul(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </div>

              <div>
                <label htmlFor="session-description" className="text-foreground font-bold block mb-1">Deskripsi Sesi</label>
                <textarea
                  id="session-description"
                  maxLength={5000}
                  rows={2}
                  placeholder="Deskripsi singkat kurasi atau highlight sesi lelang..."
                  value={deskripsi}
                  onChange={(e) => setDeskripsi(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl p-2.5 text-foreground outline-none focus:border-primary"
                ></textarea>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="session-type" className="text-foreground font-bold block mb-1">Tipe Sesi</label>
                  <select
                    id="session-type"
                    value={tipe}
                    onChange={(e) => setTipe(e.target.value as SesiType)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary"
                  >
                    <option value="reguler">Reguler (Palu Mingguan)</option>
                    <option value="tematik">Tematik (Koleksi Spesial)</option>
                    <option value="flash">Flash Auction (Cepat 24 Jam)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="session-duration" className="text-foreground font-bold block">Durasi Default Lot (Jam)</label>
                    <div className="flex gap-1">
                      {['5', '8', '12'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDurasiJam(d)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition ${
                            durasiJam === d
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-card'
                          }`}
                        >
                          {d}j
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    id="session-duration"
                    type="number"
                    min={1}
                    max={168}
                    required
                    value={durasiJam}
                    onChange={(e) => setDurasiJam(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="session-start" className="text-foreground font-bold block mb-1">Waktu Mulai Go-Live</label>
                  <input
                    id="session-start"
                    type="datetime-local"
                    required
                    value={tglMulai}
                    onChange={(e) => setTglMulai(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label htmlFor="session-curator" className="text-foreground font-bold block mb-1">Kurator / Balai Lelang</label>
                  <input
                    id="session-curator"
                    maxLength={200}
                    type="text"
                    required
                    value={kurator}
                    onChange={(e) => setKurator(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-foreground font-bold block mb-1">Pilih Gambar Banner Sesi</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {PRESET_BANNERS.map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setBannerUrl(preset.url)}
                      className={`p-2 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition ${
                        bannerUrl === preset.url
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-muted/20 hover:bg-muted/40'
                      }`}
                    >
                      <img src={preset.url} alt="" className="w-10 h-7 rounded object-cover shrink-0" />
                      <span className="text-[11px] truncate font-medium text-foreground">{preset.label}</span>
                    </button>
                  ))}
                </div>
                <input
                  type="url"
                  placeholder="Atau masukkan custom URL gambar banner..."
                  value={bannerUrl}
                  onChange={(e) => setBannerUrl(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground outline-none focus:border-primary font-mono text-[11px]"
                />
              </div>
            </div>

            <div className="pt-3 flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setShowCreateModal(false)}
                className="w-1/3 py-2.5 bg-muted text-muted-foreground rounded-xl text-xs font-bold border border-border cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit" disabled={isSaving}
                className="w-2/3 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold border border-border shadow-sm hover:opacity-90 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CalendarDays className="w-4 h-4" />
                <span>Simpan & Jadwalkan Sesi</span>
              </button>
            </div>
          </form>
        </AdminDialog>
      )}

      {/* MODAL 2: MOVE LOT TO ANOTHER SESSION */}
      {movingLotId !== null && (
        <AdminDialog title="Pindahkan lot" busy={isSaving} onClose={() => setMovingLotId(null)}>
          <div className="relative w-full max-w-md bg-card border border-border rounded-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Pindahkan Lot ke Sesi Lain</h3>
                <p className="text-xs text-muted-foreground">Lot #{movingLotId}</p>
              </div>
              <button
                type="button"
                disabled={isSaving}
                aria-label="Tutup pemindahan lot"
                onClick={() => setMovingLotId(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="text-foreground font-bold block mb-1">Pilih Sesi Mendatang Tujuan</label>
              <select
                value={moveTargetSessionId}
                onChange={(e) => setMoveTargetSessionId(e.target.value ? Number(e.target.value) : '')}
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2.5 text-foreground outline-none focus:border-primary"
              >
                <option value="">-- Pilih Sesi Tujuan --</option>
                {upcomingSessions.map((s) => (
                  <option key={s.id_sesi} value={s.id_sesi}>
                    {s.judul} ({formatDateIndo(s.tgl_mulai)})
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setMovingLotId(null)}
                className="w-1/3 py-2.5 bg-muted text-muted-foreground rounded-xl text-xs font-bold border border-border cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSaving || !moveTargetSessionId}
                onClick={handleExecuteMoveLot}
                className="w-2/3 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold border border-border disabled:opacity-50 hover:opacity-90 cursor-pointer"
              >
                Pindahkan Sekarang
              </button>
            </div>
          </div>
        </AdminDialog>
      )}
    </div>
  );
};
