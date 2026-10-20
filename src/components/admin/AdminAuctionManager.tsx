import React, { useEffect, useRef, useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { CategoryType } from '../../types';
import { AdminDialog } from '../common/AdminDialog';
import { LotPhotoInput } from '../common/LotPhotoInput';
import { formatRupiah, formatDateIndo } from '../../utils/formatters';
import {
  Plus,
  Layers,
  Gavel,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';

const CATEGORIES: CategoryType[] = [
  'Kendaraan',
  'Elektronik & Gadget',
  'Barang Mewah & Jam',
  'Koleksi & Seni',
  'Properti',
  'Lainnya',
];

interface AdminAuctionManagerProps {
  onNavigate: (view: string, id?: number) => void;
}

export const AdminAuctionManager: React.FC<AdminAuctionManagerProps> = ({ onNavigate }) => {
  const {
    currentRole,
    allJoinedAuctions,
    createOfficerAuction,
    updateAuctionStatus,
    bukaLelangSerentakHariIni,
  } = useAuction();

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [formError, setFormError] = useState('');
  const formErrorElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (formError) {
      formErrorElement.current?.focus();
      formErrorElement.current?.scrollIntoView({ block: 'center' });
    }
  }, [formError]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isOpeningSerentak, setIsOpeningSerentak] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleBukaSerentak = async () => {
    try {
      setIsOpeningSerentak(true);
      const res = await bukaLelangSerentakHariIni();
      if (res.success) {
        setToast({ type: 'success', message: res.message || 'Lelang serentak hari ini berhasil dibuka!' });
      } else {
        setToast({ type: 'error', message: res.message || 'Gagal membuka lelang serentak.' });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err?.message || 'Terjadi kesalahan sistem.' });
    } finally {
      setIsOpeningSerentak(false);
    }
  };

  // Create form states
  const [namaBarang, setNamaBarang] = useState('');
  const [kategori, setKategori] = useState<CategoryType>('Kendaraan');
  const [hargaAwal, setHargaAwal] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [deskripsi, setDeskripsi] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [kelipatan, setKelipatan] = useState('1000000');
  const [uangJaminan, setUangJaminan] = useState('5000000');

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploadingPhoto) return;
    setFormError('');

    const priceNum = Number(hargaAwal);
    const kelipatanNum = Number(kelipatan);
    const jaminanNum = Number(uangJaminan);
    const reserveNum = reservePrice ? Number(reservePrice) : undefined;

    if (!namaBarang.trim()) {
      setFormError('Nama barang tidak boleh kosong.');
      return;
    }

    if (!Number.isSafeInteger(priceNum) || priceNum < 100000) {
      setFormError('Harga awal minimal Rp100.000, dalam rupiah utuh.');
      return;
    }

    if (reserveNum !== undefined && (!Number.isSafeInteger(reserveNum) || reserveNum < priceNum)) {
      setFormError('Harga cadangan harus dalam rupiah utuh dan tidak lebih rendah dari harga awal.');
      return;
    }
    if (!Number.isSafeInteger(kelipatanNum) || kelipatanNum < 10000 || !Number.isSafeInteger(jaminanNum) || jaminanNum < 100000) {
      setFormError('Kelipatan penawaran minimal Rp10.000 dan jaminan minimal Rp100.000, dalam rupiah utuh.');
      return;
    }
    if (!photoUrls.length) { setFormError('Tambahkan setidaknya satu foto barang sebelum menyimpan draft.'); return; }

    setIsSaving(true);
    try {
      const res = await createOfficerAuction(
        {
          nama_barang: namaBarang.trim(),
          harga_awal: priceNum,
          deskripsi_barang: deskripsi.trim(),
          kategori,
          foto_barang: photoUrls,
          dokumen_pendukung: [],
          reserve_price: reserveNum,
        },
        {
          tgl_mulai: '',
          tgl_selesai: '',
          kelipatan_minimal: kelipatanNum,
          uang_jaminan: jaminanNum,
        }
      );

      if (res.success) {
        setToast({ type: 'success', message: res.message });
        setShowCreateModal(false);
        setNamaBarang('');
        setHargaAwal('');
        setDeskripsi('');
        setReservePrice('');
        setPhotoUrls([]);
      } else {
        setFormError(res.message);
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Draft belum tersimpan. Coba simpan kembali.');
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = allJoinedAuctions.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.barang.nama_barang.toLowerCase().includes(q) ||
      a.barang.kategori.toLowerCase().includes(q) ||
      String(a.lelang.id_lelang).includes(q)
    );
  });

  if (currentRole === 'masyarakat') {
    return (
      <div className="text-center py-20 bg-card rounded-lg border border-border p-8 space-y-4 max-w-lg mx-auto">
        <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
        <h1 className="text-xl font-medium text-foreground">Akses khusus petugas</h1>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Halaman manajemen lelang balai ini hanya dapat diakses oleh akun petugas lelang resmi atau administrator sistem.
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
            <Layers className="w-7 h-7 text-primary" />
            <span>Manajemen lot</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Siapkan lot sebagai draft, jadwalkan melalui Sesi Lelang, lalu pantau penawaran dan penutupannya.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleBukaSerentak}
            disabled={isOpeningSerentak}
            className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center gap-2 transition cursor-pointer"
          >
            <Gavel className="w-4 h-4" />
            <span>{isOpeningSerentak ? 'Membuka...' : 'Buka Lelang Serentak Hari Ini'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs border border-border shadow-sm flex items-center gap-2 transition hover:opacity-90 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah lot</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4 rounded-lg bg-card border border-border flex items-center gap-3">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Cari lelang berdasarkan nama barang atau ID lelang..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none text-xs text-foreground flex-1"
        />
      </div>

      {/* Table of all auctions */}
      <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <span className="text-sm font-bold text-foreground">Daftar Seluruh Lelang ({filtered.length})</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-3 px-3">ID & Foto</th>
                <th className="py-3 px-3">Nama Barang</th>
                <th className="py-3 px-3">Kategori & Asal</th>
                <th className="py-3 px-3">Penawaran Tertinggi</th>
                <th className="py-3 px-3">Jadwal Selesai</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-right">Kontrol Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr key={item.lelang.id_lelang} className="hover:bg-muted/40 transition">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-muted-foreground text-[11px]">#{item.lelang.id_lelang}</span>
                      <img
                        src={item.barang.foto_barang[0]}
                        alt={item.barang.nama_barang}
                        className="w-10 h-10 rounded-lg object-cover border border-border"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-foreground line-clamp-1 max-w-[200px]">{item.barang.nama_barang}</div>
                    <div className="text-[10px] text-muted-foreground">{item.totalBids} Penawaran Masuk</div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded bg-muted text-foreground text-[10px] font-semibold block w-max mb-1 border border-border">
                      {item.barang.kategori}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.barang.id_user ? 'C2C User' : 'Balai Lelang'}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-foreground">
                    {formatRupiah(item.lelang.harga_akhir)}
                  </td>
                  <td className="py-3 px-3 font-mono text-muted-foreground text-[11px]">
                    {formatDateIndo(item.lelang.tgl_selesai)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {item.lelang.status === 'draft' && (
                      <span className="px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-[10px] font-bold border border-border">
                        LOT POOL
                      </span>
                    )}
                    {item.lelang.status === 'terjadwal' && (
                      <span className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-bold border border-blue-500/20">
                        TERJADWAL
                      </span>
                    )}
                    {item.lelang.status === 'dibuka' && (
                      <span className="px-2.5 py-1 rounded-full bg-primary/20 text-foreground text-[10px] font-bold border border-primary/40">
                        DIBUKA
                      </span>
                    )}
                    {item.lelang.status === 'ditutup' && (
                      <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold border border-border">
                        DITUTUP
                      </span>
                    )}
                    {item.lelang.status === 'dibatalkan' && (
                      <span className="px-2.5 py-1 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold border border-destructive/30">
                        DIBATALKAN
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {item.lelang.status === 'dibuka' && (
                        <button
                          type="button"
                          onClick={async () => {
                            setIsSaving(true);
                            const result = await updateAuctionStatus(item.lelang.id_lelang, 'ditutup');
                            setIsSaving(false);
                            setToast({ type: result.success ? 'success' : 'error', message: result.message });
                          }} disabled={isSaving}
                          className="px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 text-[11px] font-bold transition cursor-pointer"
                          title="Tutup lelang sekarang & tetapkan pemenang"
                        >
                          Tutup
                        </button>
                      )}
                      {item.lelang.status !== 'ditutup' && item.lelang.status !== 'dibatalkan' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.confirm(`Yakin ingin membatalkan Lelang #${item.lelang.id_lelang}? Peserta akan menerima pembaruan status dan proses pengembalian mengikuti status transaksi.`)) {
                              setIsSaving(true);
                              const result = await updateAuctionStatus(item.lelang.id_lelang, 'dibatalkan');
                              setIsSaving(false);
                              setToast({ type: result.success ? 'success' : 'error', message: result.message });
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 text-[11px] font-bold transition cursor-pointer"
                          title="Batalkan lelang dan kembalikan deposit peserta"
                        >
                          Batal
                        </button>
                      )}
                      {item.lelang.status === 'ditutup' && (
                        <button
                          type="button"
                          disabled
                          className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border text-[11px] font-medium opacity-60 cursor-not-allowed"
                          title={item.lelang.legacy_historical ? 'Arsip SQL. Status transaksi lama perlu dicocokkan dengan bukti.' : 'Lelang telah ditutup oleh server'}
                        >
                          {item.lelang.legacy_historical ? 'Arsip' : 'Selesai'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigate('auction-detail', item.lelang.id_lelang)}
                        className="px-2.5 py-1 rounded-lg bg-muted text-foreground hover:bg-card border border-border text-[11px] font-bold transition cursor-pointer"
                      >
                        Lihat
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE AUCTION MODAL */}
      {showCreateModal && (
        <AdminDialog title="Buat lot draft" busy={isSaving || isUploadingPhoto} onClose={() => setShowCreateModal(false)}>
          <form
            onSubmit={handleCreateSubmit}
            className="relative w-full bg-card border border-border rounded-lg px-5 sm:px-7 space-y-5"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card py-3">
              <div><h3 className="text-lg font-semibold text-foreground">Buat lot draft</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Lengkapi barang dan foto. Jadwal lelang diatur setelah draft tersimpan.</p></div>
              <button type="button" disabled={isSaving || isUploadingPhoto} aria-label="Tutup formulir lot" onClick={() => setShowCreateModal(false)} className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-ring disabled:opacity-50">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {formError && <p ref={formErrorElement} tabIndex={-1} role="alert" className="focus-ring rounded border border-destructive/30 bg-card p-3 text-sm text-destructive">{formError} Isian dan foto tetap tersedia untuk diperbaiki.</p>}
            <fieldset disabled={isSaving} className="min-w-0 space-y-5 text-sm">
              <div>
                <label htmlFor="lot-name" className="text-foreground font-bold block mb-1">Nama Barang</label>
                <input
                  id="lot-name"
                  maxLength={200}
                  type="text"
                  required
                  placeholder="Nama, model, dan tahun barang"
                  value={namaBarang}
                  onChange={(e) => setNamaBarang(e.target.value)}
                  className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lot-category" className="text-foreground font-bold block mb-1">Kategori</label>
                  <select
                    id="lot-category"
                    value={kategori}
                    onChange={(e) => setKategori(e.target.value as CategoryType)}
                    className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="lot-price" className="text-foreground font-bold block mb-1">Harga Limit Awal (Rp)</label>
                  <input
                    id="lot-price"
                    min={100000}
                    step={1}
                    type="number"
                    required
                    placeholder="Minimal 100000"
                    value={hargaAwal}
                    onChange={(e) => setHargaAwal(e.target.value)}
                    className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground tabular-nums"
                  />
                </div>
              </div>

              <LotPhotoInput photos={photoUrls} onChange={photos => { setPhotoUrls(photos); setFormError(''); }} onBusyChange={setIsUploadingPhoto} disabled={isSaving} />

              <div>
                <label htmlFor="lot-description" className="text-foreground font-bold block mb-1">Deskripsi Kondisi</label>
                <textarea
                  id="lot-description"
                  maxLength={20000}
                  rows={3}
                  required
                  value={deskripsi}
                  onChange={(e) => setDeskripsi(e.target.value)}
                  className="focus-ring w-full bg-card border border-input rounded p-3 text-foreground"
                  placeholder="Keterangan kelengkapan dan kondisi fisik..."
                ></textarea>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lot-increment" className="text-foreground font-bold block mb-1">Kelipatan Bid Minimal (Rp)</label>
                  <input
                    id="lot-increment"
                    type="number"
                    required
                    min={10000}
                    step={1}
                    value={kelipatan}
                    onChange={(e) => setKelipatan(e.target.value)}
                    className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground tabular-nums"
                  />
                </div>

                <div>
                  <label htmlFor="lot-deposit" className="text-foreground font-bold block mb-1">Uang Jaminan Wajib (Rp)</label>
                  <input
                    id="lot-deposit"
                    type="number"
                    required
                    min={100000}
                    step={1}
                    value={uangJaminan}
                    onChange={(e) => setUangJaminan(e.target.value)}
                    className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground tabular-nums"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="lot-reserve" className="text-foreground font-bold">Reserve Price (Opsional Rp)</label>
                  <span className="text-[10px] text-muted-foreground">Harga batas rahasia</span>
                </div>
                <input
                  id="lot-reserve"
                  type="number"
                  min={Number(hargaAwal) || 100000}
                  step={1}
                  placeholder="Kosongkan jika tanpa reserve price"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  className="focus-ring min-h-11 w-full bg-card border border-input rounded px-3 py-2 text-foreground tabular-nums"
                />
              </div>

              <div className="text-xs text-muted-foreground leading-5">
                Menyimpan draft belum membuka penawaran. Setelah tersimpan, masukkan lot ke sesi melalui menu Sesi Lelang.
              </div>
            </fieldset>

            <div className="sticky bottom-0 z-10 border-t border-border bg-card py-4 flex gap-3">
              <button
                type="button"
                disabled={isSaving || isUploadingPhoto}
                onClick={() => setShowCreateModal(false)}
                className="focus-ring min-h-11 w-1/3 px-3 py-2 bg-card text-foreground rounded text-sm font-semibold border border-input disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit" disabled={isSaving || isUploadingPhoto}
                className="focus-ring min-h-11 w-2/3 px-3 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold hover:opacity-90 flex items-center justify-center disabled:opacity-50"
              >
                <span>{isUploadingPhoto ? 'Menunggu unggahan…' : isSaving ? 'Menyimpan draft…' : 'Simpan draft lot'}</span>
              </button>
            </div>
          </form>
        </AdminDialog>
      )}
    </div>
  );
};
