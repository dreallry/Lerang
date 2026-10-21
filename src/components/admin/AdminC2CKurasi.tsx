import React, { useState, useEffect } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { TbBarang, CategoryType } from '../../types';
import { AdminDialog } from '../common/AdminDialog';
import { formatRupiah } from '../../utils/formatters';
import { itemRevision } from '../../utils/catalogData';
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  User,
  FileText,
  Eye,
  ShieldAlert,
  Pencil,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Inbox,
  X,
} from 'lucide-react';

interface AdminC2CKurasiProps {
  onNavigate: (view: string, id?: number) => void;
}

const CATEGORIES: CategoryType[] = [
  'Kendaraan',
  'Elektronik & Gadget',
  'Barang Mewah & Jam',
  'Koleksi & Seni',
  'Properti',
  'Lainnya',
];

const ITEMS_PER_PAGE = 10;

export const AdminC2CKurasi: React.FC<AdminC2CKurasiProps> = ({ onNavigate }) => {
  const {
    currentRole,
    barangList,
    masyarakatList,
    approveC2CListing,
    rejectC2CListing,
    updateBarangInfo,
  } = useAuction();

  const [isSaving, setIsSaving] = useState(false);
  const [selectedBarang, setSelectedBarang] = useState<TbBarang | null>(null);
  const [modalMode, setModalMode] = useState<'inspect' | 'approve' | 'reject' | 'edit' | null>(null);

  // Approve config form states
  const [kelipatan, setKelipatan] = useState('500000');
  const [uangJaminan, setUangJaminan] = useState('2000000');
  const [reservePrice, setReservePrice] = useState('');

  // Reject reason
  const [rejectReason, setRejectReason] = useState('');

  // Edit minor states
  const [editNama, setEditNama] = useState('');
  const [editKategori, setEditKategori] = useState<CategoryType>('Kendaraan');
  const [editHargaAwal, setEditHargaAwal] = useState('');
  const [editReservePrice, setEditReservePrice] = useState('');
  const [editDeskripsi, setEditDeskripsi] = useState('');

  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Toast feedback state
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Pagination state for history table
  const [historyPage, setHistoryPage] = useState(1);

  // Auto-dismiss toast after 4s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Pending C2C items
  const pendingItems = barangList.filter((b) => b.status_verifikasi === 'pending' && b.id_user !== null);
  const allCuratedItems = barangList.filter((b) => b.id_user !== null);
  const latestSelected = selectedBarang && barangList.find((item) => item.id_barang === selectedBarang.id_barang);
  const selectedChanged = Boolean(selectedBarang && (!latestSelected || itemRevision(latestSelected) !== itemRevision(selectedBarang)));
  const staleNotice = selectedChanged ? (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      Barang ini telah diubah atau diproses. Tutup formulir lalu buka kembali untuk memeriksa versi terbaru.
    </p>
  ) : null;

  // Pagination calculation
  const totalPages = Math.ceil(allCuratedItems.length / ITEMS_PER_PAGE) || 1;
  const paginatedHistory = allCuratedItems.slice(
    (historyPage - 1) * ITEMS_PER_PAGE,
    historyPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setHistoryPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const handleOpenApproveModal = (b: TbBarang) => {
    setSelectedBarang(b);
    const suggestedDeposit = Math.max(1000000, Math.round(b.harga_awal * 0.1));
    const suggestedIncrement = b.harga_awal >= 100000000 ? '2500000' : '500000';
    setUangJaminan(String(suggestedDeposit));
    setKelipatan(suggestedIncrement);
    setReservePrice(b.reserve_price ? String(b.reserve_price) : '');
    setModalMode('approve');
  };

  const handleOpenRejectModal = (b: TbBarang) => {
    setSelectedBarang(b);
    setRejectReason('');
    setModalMode('reject');
  };

  const handleOpenInspect = (b: TbBarang) => {
    setSelectedBarang(b);
    setActivePhotoIdx(0);
    setModalMode('inspect');
  };

  const handleOpenEditMinor = (b: TbBarang) => {
    setSelectedBarang(b);
    setEditNama(b.nama_barang);
    setEditKategori(b.kategori);
    setEditHargaAwal(String(b.harga_awal));
    setEditReservePrice(b.reserve_price ? String(b.reserve_price) : '');
    setEditDeskripsi(b.deskripsi_barang);
    setModalMode('edit');
  };

  const handleExecuteApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBarang || isSaving || selectedChanged) return;

    const kelipatanNum = Number(kelipatan);
    const jaminanNum = Number(uangJaminan);
    const reserveNum = reservePrice ? Number(reservePrice) : undefined;

    if (isNaN(kelipatanNum) || kelipatanNum < 10000) {
      setToast({ type: 'error', message: 'Kelipatan minimal penawaran harus minimal Rp 10.000.' });
      return;
    }

    if (isNaN(jaminanNum) || jaminanNum < 100000) {
      setToast({ type: 'error', message: 'Uang jaminan deposit minimal Rp 100.000.' });
      return;
    }

    if (reserveNum && reserveNum < selectedBarang.harga_awal) {
      setToast({
        type: 'error',
        message: 'Reserve price tidak boleh lebih rendah dari harga limit pembuka barang.',
      });
      return;
    }

    setIsSaving(true);
    const res = await approveC2CListing(selectedBarang.id_barang, {
      expected_updated_at: itemRevision(selectedBarang),
      kelipatan_minimal: kelipatanNum,
      uang_jaminan: jaminanNum,
      reserve_price: reserveNum,
    });

    setIsSaving(false);
    if (res.success) {
      setToast({ type: 'success', message: res.message });
      setModalMode(null);
      setSelectedBarang(null);
    } else {
      setToast({ type: 'error', message: res.message });
    }
  };

  const handleExecuteReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBarang || isSaving || selectedChanged) return;

    if (!rejectReason.trim()) {
      setToast({ type: 'error', message: 'Mohon tuliskan alasan penolakan secara jelas.' });
      return;
    }

    setIsSaving(true);
    const res = await rejectC2CListing(selectedBarang.id_barang, rejectReason.trim(), itemRevision(selectedBarang));
    setIsSaving(false);
    if (res.success) {
      setToast({ type: 'success', message: res.message });
      setModalMode(null);
      setSelectedBarang(null);
    } else {
      setToast({ type: 'error', message: res.message });
    }
  };

  const handleExecuteEditMinor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBarang || isSaving || selectedChanged) return;

    if (!editNama.trim()) {
      setToast({ type: 'error', message: 'Nama barang tidak boleh kosong.' });
      return;
    }

    const hargaNum = Number(editHargaAwal);
    if (isNaN(hargaNum) || hargaNum < 100000) {
      setToast({ type: 'error', message: 'Harga limit awal minimal Rp 100.000.' });
      return;
    }

    setIsSaving(true);
    const res = await updateBarangInfo(selectedBarang.id_barang, {
      expected_updated_at: itemRevision(selectedBarang),
      nama_barang: editNama.trim(),
      kategori: editKategori,
      harga_awal: hargaNum,
      reserve_price: editReservePrice.trim() ? Number(editReservePrice) : 0,
      deskripsi_barang: editDeskripsi.trim(),
    });

    setIsSaving(false);
    if (res.success) {
      setToast({ type: 'success', message: res.message });
      // Update local state if inspecting
      setSelectedBarang((prev) =>
        prev
          ? {
              ...prev,
              nama_barang: editNama.trim(),
              kategori: editKategori,
              harga_awal: hargaNum,
              reserve_price: editReservePrice.trim() ? Number(editReservePrice) : 0,
              deskripsi_barang: editDeskripsi.trim(),
            }
          : null
      );
      setModalMode(null);
    } else {
      setToast({ type: 'error', message: res.message });
    }
  };

  if (currentRole === 'masyarakat') {
    return (
      <div className="text-center py-20 bg-card rounded-lg border border-border p-8 space-y-4 max-w-lg mx-auto">
        <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
        <h1 className="text-xl font-medium text-foreground">Akses khusus petugas</h1>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Halaman kurasi lelang masyarakat ini hanya dapat diakses oleh akun petugas lelang resmi atau administrator sistem.
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
            className="text-xs opacity-70 hover:opacity-100 px-2 py-0.5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground flex items-center gap-2.5">
          <FileCheck2 className="w-7 h-7 text-primary" />
          <span>Ruang Verifikasi & Kurasi Barang C2C</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Periksa keabsahan data fisik, keaslian dokumen kepemilikan, dan kelayakan nilai limit yang diajukan oleh masyarakat sebelum disetujui masuk Lot Pool.
        </p>
      </div>

      {/* Pending C2C Submissions Table / Cards */}
      <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Antrean Pengajuan Menunggu Kurasi</span>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs font-bold border border-border">
              {pendingItems.length} Menunggu
            </span>
          </div>
          <span className="text-xs text-muted-foreground">SOP Validasi & Kurasi: 3 Hari Kerja</span>
        </div>

        {pendingItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs space-y-2">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
            <p className="font-semibold text-foreground">Semua pengajuan barang masyarakat telah selesai diverifikasi.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingItems.map((b) => {
              const seller = masyarakatList.find((u) => u.id_user === b.id_user);

              return (
                <div
                  key={b.id_barang}
                  className="p-5 rounded-lg bg-card border border-border space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-card text-foreground border border-border">
                        {b.kategori}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Diajukan: {b.tanggal}</span>
                    </div>

                    <div className="flex gap-3">
                      <img
                        src={b.foto_barang[0] || 'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400'}
                        alt={b.nama_barang}
                        className="w-20 h-20 rounded-xl object-cover border border-border flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400';
                        }}
                      />
                      <div className="space-y-1 min-w-0">
                        <h4 className="font-bold text-foreground text-sm line-clamp-2">{b.nama_barang}</h4>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">Pemilik: <strong className="text-foreground">{seller?.nama_lengkap}</strong></span>
                        </div>
                        <div className="text-xs font-mono font-bold text-foreground">
                          Limit Awal: {formatRupiah(b.harga_awal)}
                        </div>
                        {b.reserve_price ? (
                          <div className="text-[11px] font-mono text-muted-foreground">
                            Reserve: {formatRupiah(b.reserve_price)}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {b.deskripsi_barang}
                    </p>

                    {/* Docs badge */}
                    {b.dokumen_pendukung && b.dokumen_pendukung.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-foreground bg-muted px-2.5 py-1 rounded-lg border border-border">
                        <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate">Lampiran: {b.dokumen_pendukung.join(', ')}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions row */}
                  <div className="pt-2 border-t border-border flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenInspect(b)}
                      className="flex-1 py-2 rounded-xl bg-card hover:bg-muted border border-border text-foreground text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span>Periksa</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEditMinor(b)}
                      className="px-3 py-2 rounded-xl bg-card hover:bg-muted border border-border text-foreground text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      title="Koreksi typo atau detail minor"
                    >
                      <Pencil className="w-3.5 h-3.5 text-amber-500" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenRejectModal(b)}
                      className="px-3 py-2 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Tolak</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenApproveModal(b)}
                      className="py-2 px-3.5 rounded-xl bg-primary text-primary-foreground border border-border text-xs font-bold shadow-sm transition hover:opacity-90 flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Setujui</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History of Curated Items with Pagination */}
      <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Riwayat Keputusan Kurasi Barang</h3>
          <span className="text-xs text-muted-foreground">
            Total {allCuratedItems.length} Pengajuan
          </span>
        </div>

        {allCuratedItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Belum ada riwayat kurasi.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-3 px-3">Nama Barang</th>
                    <th className="py-3 px-3">Pengaju (User)</th>
                    <th className="py-3 px-3">Harga Limit</th>
                    <th className="py-3 px-3">Reserve Price</th>
                    <th className="py-3 px-3">Status Kurasi</th>
                    <th className="py-3 px-3">Catatan Petugas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedHistory.map((b) => {
                    const seller = masyarakatList.find((u) => u.id_user === b.id_user);

                    return (
                      <tr key={b.id_barang} className="hover:bg-muted/40">
                        <td className="py-3 px-3 font-semibold text-foreground">{b.nama_barang}</td>
                        <td className="py-3 px-3 text-muted-foreground">{seller?.nama_lengkap || '-'}</td>
                        <td className="py-3 px-3 font-mono font-bold text-foreground">{formatRupiah(b.harga_awal)}</td>
                        <td className="py-3 px-3 font-mono text-muted-foreground">
                          {b.reserve_price ? formatRupiah(b.reserve_price) : '-'}
                        </td>
                        <td className="py-3 px-3">
                          {b.status_verifikasi === 'approved' && (
                            <span className="px-2 py-0.5 rounded bg-primary/20 text-foreground text-[10px] font-bold border border-primary/40">
                              DISETUJUI
                            </span>
                          )}
                          {b.status_verifikasi === 'rejected' && (
                            <span className="px-2 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-bold border border-destructive/20">
                              DITOLAK
                            </span>
                          )}
                          {b.status_verifikasi === 'pending' && (
                            <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-bold border border-border">
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-[11px]">{b.catatan_kurasi || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-border text-xs">
                <span className="text-muted-foreground">
                  Halaman {historyPage} dari {totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Halaman Sebelumnya"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setHistoryPage(idx + 1)}
                      className={`w-7 h-7 rounded-lg text-xs font-semibold ${
                        historyPage === idx + 1
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card border border-border hover:bg-muted text-foreground'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={historyPage >= totalPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                    className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Halaman Berikutnya"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL 1: INSPECTION MODAL */}
      {modalMode === 'inspect' && selectedBarang && (
        <AdminDialog title="Periksa barang" onClose={() => setModalMode(null)}>
          <div className="relative w-full max-w-2xl bg-card border border-border rounded-lg p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Inspeksi Lengkap Barang Lelang C2C</h3>
              <button type="button" aria-label="Tutup pemeriksaan barang" onClick={() => setModalMode(null)} className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Photo Preview */}
            {staleNotice}
            <div className="space-y-2">
              <div className="h-60 w-full rounded-lg overflow-hidden bg-muted border border-border">
                <img
                  src={selectedBarang.foto_barang[activePhotoIdx] || 'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=600'}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=600';
                  }}
                />
              </div>
              {selectedBarang.foto_barang.length > 1 && (
                <div className="flex gap-2">
                  {selectedBarang.foto_barang.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActivePhotoIdx(i)}
                      className={`w-16 h-12 rounded-lg overflow-hidden border-2 cursor-pointer ${
                        activePhotoIdx === i ? 'border-primary' : 'border-border'
                      }`}
                    >
                      <img src={img} alt="Thumb" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nama Barang:</span>
                <span className="text-foreground font-bold">{selectedBarang.nama_barang}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kategori:</span>
                <span className="text-foreground">{selectedBarang.kategori}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Harga Limit Yang Diajukan:</span>
                <span className="text-foreground font-mono font-bold">{formatRupiah(selectedBarang.harga_awal)}</span>
              </div>
              {selectedBarang.reserve_price ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reserve Price (Rahasia):</span>
                  <span className="text-foreground font-mono font-bold">{formatRupiah(selectedBarang.reserve_price)}</span>
                </div>
              ) : null}
              <div>
                <span className="text-muted-foreground block mb-1">Deskripsi & Riwayat:</span>
                <p className="text-foreground leading-relaxed bg-card p-2.5 rounded-xl border border-border">
                  {selectedBarang.deskripsi_barang}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={selectedChanged}
                onClick={() => handleOpenEditMinor(selectedBarang)}
                className="py-2.5 px-4 bg-muted hover:bg-card border border-border text-foreground rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5 text-amber-500" />
                <span>Koreksi Typo</span>
              </button>
              <button
                type="button"
                disabled={selectedChanged}
                onClick={() => setModalMode('reject')}
                className="flex-1 py-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 rounded-xl text-xs font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tolak Pengajuan
              </button>
              <button
                type="button"
                disabled={selectedChanged}
                onClick={() => setModalMode('approve')}
                className="flex-1 py-2.5 bg-primary text-primary-foreground border border-border rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Lanjut Setujui (Lot Pool)
              </button>
            </div>
          </div>
        </AdminDialog>
      )}

      {/* MODAL 2: APPROVE TO LOT POOL MODAL */}
      {modalMode === 'approve' && selectedBarang && (
        <AdminDialog title="Setujui barang" busy={isSaving} onClose={() => setModalMode(null)}>
          <form
            onSubmit={handleExecuteApprove}
            className="relative w-full max-w-md bg-card border border-border rounded-lg p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Setujui Masuk Lot Pool</h3>
                <p className="text-xs text-muted-foreground">{selectedBarang.nama_barang}</p>
              </div>
              <button type="button" disabled={isSaving} aria-label="Tutup persetujuan barang" onClick={() => setModalMode(null)} className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Explanatory callout for session scheduling */}
            {staleNotice}
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-foreground">
                <Inbox className="w-4 h-4 text-primary" />
                <span>Setujui barang sebelum menjadwalkan</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Persetujuan membuat lot berstatus draft di Lot Pool. Setelah itu, pilih lot di menu Sesi Lelang dan tentukan jadwalnya. Server membuka dan menutup lelang sesuai jadwal tersebut.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-foreground font-bold block mb-1">
                  Kelipatan Penawaran Minimal (Incremental Step)
                </label>
                <input
                  type="number"
                  required
                  min={10000}
                  value={kelipatan}
                  onChange={(e) => setKelipatan(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono"
                />
              </div>

              <div>
                <label className="text-foreground font-bold block mb-1">
                  Uang Jaminan/Deposit Wajib Peserta (IDR)
                </label>
                <input
                  type="number"
                  required
                  min={100000}
                  value={uangJaminan}
                  onChange={(e) => setUangJaminan(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-foreground font-bold">
                    Reserve Price (Harga Cadangan Minimal)
                  </label>
                  <span className="text-[10px] text-muted-foreground">Opsional</span>
                </div>
                <input
                  type="number"
                  placeholder="Kosongkan jika tanpa reserve price"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Batas minimal penjualan. Jika bid tertinggi di bawah angka ini, lot tidak akan terjual.
                </p>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setModalMode(null)}
                className="w-1/3 py-2.5 bg-muted text-muted-foreground rounded-xl text-xs font-bold border border-border cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit" disabled={isSaving || selectedChanged}
                className="w-2/3 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold border border-border shadow-sm hover:opacity-90 flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Setujui ke Lot Pool</span>
              </button>
            </div>
          </form>
        </AdminDialog>
      )}

      {/* MODAL 3: REJECT WITH REASON */}
      {modalMode === 'reject' && selectedBarang && (
        <AdminDialog title="Tolak barang" busy={isSaving} onClose={() => setModalMode(null)}>
          <form
            onSubmit={handleExecuteReject}
            className="relative w-full max-w-md bg-card border border-border rounded-lg p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Tolak Pengajuan Barang Lelang</h3>
                <p className="text-xs text-muted-foreground">{selectedBarang.nama_barang}</p>
              </div>
              <button type="button" disabled={isSaving} aria-label="Tutup penolakan barang" onClick={() => setModalMode(null)} className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {staleNotice}
            <div>
              <label className="text-xs font-bold text-foreground block mb-1">
                Alasan Penolakan (Akan Dikirim ke User)
              </label>
              <textarea
                rows={4}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-xl p-3 text-xs text-foreground outline-none"
              ></textarea>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setModalMode(null)}
                className="w-1/3 py-2.5 bg-muted text-muted-foreground rounded-xl text-xs font-bold border border-border cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit" disabled={isSaving || selectedChanged}
                className="w-2/3 py-2.5 bg-destructive text-destructive-foreground rounded-xl text-xs font-bold border border-border hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Kirim Penolakan
              </button>
            </div>
          </form>
        </AdminDialog>
      )}

      {/* MODAL 4: EDIT MINOR MODAL */}
      {modalMode === 'edit' && selectedBarang && (
        <AdminDialog title="Ubah barang" busy={isSaving} onClose={() => setModalMode(null)}>
          <form
            onSubmit={handleExecuteEditMinor}
            className="relative w-full max-w-lg bg-card border border-border rounded-lg p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-primary" />
                  <span>Koreksi Typo / Detail Minor</span>
                </h3>
                <p className="text-xs text-muted-foreground">Koreksi kesalahan pengetikan sebelum menyetujui barang</p>
              </div>
              <button type="button" disabled={isSaving} aria-label="Tutup perubahan barang" onClick={() => setModalMode(null)} className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {staleNotice}
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-foreground font-bold block mb-1">Nama Barang</label>
                <input
                  type="text"
                  required
                  value={editNama}
                  onChange={(e) => setEditNama(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-foreground font-bold block mb-1">Kategori</label>
                  <select
                    value={editKategori}
                    onChange={(e) => setEditKategori(e.target.value as CategoryType)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-foreground font-bold block mb-1">Harga Limit Awal (IDR)</label>
                  <input
                    type="number"
                    required
                    min={100000}
                    value={editHargaAwal}
                    onChange={(e) => setEditHargaAwal(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-foreground font-bold block mb-1">
                  Reserve Price (Opsional IDR)
                </label>
                <input
                  type="number"
                  placeholder="Kosongkan jika tanpa reserve price"
                  value={editReservePrice}
                  onChange={(e) => setEditReservePrice(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground font-mono"
                />
              </div>

              <div>
                <label className="text-foreground font-bold block mb-1">Deskripsi Barang</label>
                <textarea
                  rows={3}
                  required
                  value={editDeskripsi}
                  onChange={(e) => setEditDeskripsi(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-xl p-3 text-xs text-foreground outline-none"
                ></textarea>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setModalMode(null)}
                className="w-1/3 py-2.5 bg-muted text-muted-foreground rounded-xl text-xs font-bold border border-border cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit" disabled={isSaving || selectedChanged}
                className="w-2/3 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold border border-border shadow-sm hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </AdminDialog>
      )}
    </div>
  );
};
