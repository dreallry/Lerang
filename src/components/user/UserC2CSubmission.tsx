import React, { useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { LotPhotoInput } from '../common/LotPhotoInput';
import { CategoryType } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import { documentLinkError, itemRevision } from '../../utils/catalogData';
import {
  FilePlus2,
  FileCheck,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Layers,
  Plus,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import { GuestGuardView } from '../common/GuestGuardView';

const CATEGORIES: CategoryType[] = [
  'Kendaraan',
  'Elektronik & Gadget',
  'Barang Mewah & Jam',
  'Koleksi & Seni',
  'Properti',
  'Lainnya',
];

interface UserC2CSubmissionProps {
  onNavigate: (view: string, id?: number) => void;
}

export const UserC2CSubmission: React.FC<UserC2CSubmissionProps> = ({ onNavigate }) => {
  const { currentUser, submitC2CItem, resubmitC2CItem, cancelC2CSubmission, barangList, lelangList } = useAuction();

  const [activeTab, setActiveTab] = useState<'submit' | 'my-items'>('submit');
  const [editingBarangId, setEditingBarangId] = useState<number | null>(null);
  const [editingRevision, setEditingRevision] = useState('');

  const [namaBarang, setNamaBarang] = useState('');
  const [kategori, setKategori] = useState<CategoryType>('Kendaraan');
  const [hargaAwal, setHargaAwal] = useState<string>('');
  const [reservePrice, setReservePrice] = useState<string>('');
  const [deskripsi, setDeskripsi] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [documents, setDocuments] = useState<string[]>([]);
  const [newDocInput, setNewDocInput] = useState('');
  const [specs, setSpecs] = useState<{ key: string; val: string }[]>([]);
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecVal, setNewSpecVal] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  if (!currentUser) {
    return (
      <GuestGuardView
        title="Titip jual barang"
        description="Masuk untuk mengajukan barang dan memantau hasil pemeriksaan petugas."
        icon={<FilePlus2 className="w-8 h-8 text-primary" />}
        onNavigate={onNavigate}
      />
    );
  }

  const myItems = barangList.filter((b) => b.id_user === currentUser.id_user);
  const latestEditingItem = myItems.find(item => item.id_barang === editingBarangId);
  const editingChanged = Boolean(editingBarangId && (!latestEditingItem || itemRevision(latestEditingItem) !== editingRevision));

  const handleAddDoc = () => {
    const value = newDocInput.trim();
    const error = documentLinkError(value, documents);
    if (error) { setFeedback({ type: 'error', msg: error }); return; }
    setDocuments([...documents, value]);
    setNewDocInput('');
    setFeedback(null);
  };

  const handleRemoveDoc = (idx: number) => {
    setDocuments(documents.filter((_, i) => i !== idx));
  };

  const handleAddSpec = () => {
    if (newSpecKey.trim() && newSpecVal.trim()) {
      setSpecs([...specs, { key: newSpecKey.trim(), val: newSpecVal.trim() }]);
      setNewSpecKey('');
      setNewSpecVal('');
    }
  };

  const handleRemoveSpec = (idx: number) => {
    setSpecs(specs.filter((_, i) => i !== idx));
  };

  const handleStartEdit = (item: (typeof barangList)[0]) => {
    setEditingBarangId(item.id_barang);
    setEditingRevision(itemRevision(item));
    setNamaBarang(item.nama_barang);
    setKategori(item.kategori);
    setHargaAwal(String(item.harga_awal));
    setReservePrice(item.reserve_price ? String(item.reserve_price) : '');
    setDeskripsi(item.deskripsi_barang);
    setPhotoUrls(item.foto_barang.length > 0 ? item.foto_barang : []);
    setDocuments(item.dokumen_pendukung || []);
    setSpecs(Object.entries(item.spesifikasi || {}).map(([key, val]) => ({ key, val })));
    setNewDocInput(''); setNewSpecKey(''); setNewSpecVal('');
    setFeedback(null);
    setActiveTab('submit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingBarangId(null);
    setEditingRevision('');
    setNamaBarang('');
    setHargaAwal('');
    setReservePrice('');
    setDeskripsi('');
    setPhotoUrls([]);
    setDocuments([]);
    setSpecs([]);
    setFeedback(null);
  };

  const handleCancelSubmission = async (id_barang: number, nama: string) => {
    if (isSaving) return;
    if (window.confirm(`Yakin ingin membatalkan pengajuan "${nama}"? Pengajuan ini akan dihapus dari antrean kurasi petugas.`)) {
      setIsSaving(true);
      const res = await cancelC2CSubmission(id_barang);
      setIsSaving(false);
      if (res.success) {
        setFeedback({ type: 'success', msg: res.message });
      } else {
        setFeedback({ type: 'error', msg: res.message });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploadingPhoto) return;
    if (editingChanged) { setFeedback({ type: 'error', msg: 'Data barang telah berubah. Muat versi terbaru sebelum mengajukan perbaikan.' }); return; }
    if (!namaBarang.trim()) {
      setFeedback({ type: 'error', msg: 'Mohon isi nama barang yang diajukan.' });
      return;
    }

    const priceNum = Number(hargaAwal);
    if (!hargaAwal || !Number.isSafeInteger(priceNum) || priceNum < 100000) {
      setFeedback({ type: 'error', msg: 'Harga limit awal pembuka minimal Rp 100.000.' });
      return;
    }

    if (reservePrice) {
      const reserveNum = Number(reservePrice);
      if (!Number.isSafeInteger(reserveNum) || reserveNum < priceNum) {
        setFeedback({
          type: 'error',
          msg: 'Harga cadangan rahasia (reserve price) tidak boleh lebih rendah dari harga limit awal pembuka.',
        });
        return;
      }
    }

    if (photoUrls.length < 3) {
      setFeedback({
        type: 'error',
        msg: `Lampirkan minimal 3 foto barang dari berbagai sudut (saat ini ${photoUrls.length} foto) agar kurasi petugas dapat memverifikasi kondisi fisik secara detail.`,
      });
      return;
    }

    if (deskripsi.trim().length < 50) {
      setFeedback({
        type: 'error',
        msg: `Deskripsi barang minimal 50 karakter (saat ini ${deskripsi.trim().length} karakter). Berikan informasi jelas tentang riwayat, kondisi, dan kelengkapan.`,
      });
      return;
    }

    if (newDocInput.trim() || newSpecKey.trim() || newSpecVal.trim()) {
      setFeedback({ type: 'error', msg: 'Masih ada dokumen atau spesifikasi yang belum ditambahkan. Tambahkan ke daftar atau kosongkan kolomnya sebelum mengirim.' });
      return;
    }
    const invalidDocument = documents.find((document, index) => documentLinkError(document, documents.slice(0, index)));
    if (invalidDocument) { setFeedback({ type: 'error', msg: 'Tautan dokumen belum valid. Hapus nama dokumen lama lalu tambahkan tautan HTTP atau HTTPS yang sesuai.' }); return; }

    const specsObj: Record<string, string> = {};
    specs.forEach((s) => {
      specsObj[s.key] = s.val;
    });

    const reserveNum = reservePrice ? Number(reservePrice) : undefined;

    setIsSaving(true);
    let res;
    if (editingBarangId) {
      res = await resubmitC2CItem(editingBarangId, {
        expected_updated_at: editingRevision,
        nama_barang: namaBarang.trim(),
        kategori,
        harga_awal: priceNum,
        deskripsi_barang: deskripsi.trim(),
        foto_barang: photoUrls,
        dokumen_pendukung: documents,
        spesifikasi: specsObj,
        reserve_price: reserveNum ?? 0,
      });
    } else {
      res = await submitC2CItem({
        nama_barang: namaBarang.trim(),
        kategori,
        harga_awal: priceNum,
        deskripsi_barang: deskripsi.trim(),
        foto_barang: photoUrls,
        dokumen_pendukung: documents,
        spesifikasi: specsObj,
        reserve_price: reserveNum,
      });
    }

    setIsSaving(false);
    if (res.success) {
      setFeedback({ type: 'success', msg: res.message });
      setNamaBarang('');
      setHargaAwal('');
      setReservePrice('');
      setDeskripsi('');
      setPhotoUrls([]);
      setDocuments([]);
      setSpecs([]);
      setEditingBarangId(null);
      setEditingRevision('');
      setActiveTab('my-items');
    } else {
      setFeedback({ type: 'error', msg: res.message });
    }
  };

  const parsedPrice = Number(hargaAwal) || 0;
  const platformFee = Math.round(parsedPrice * 0.05);
  const estimatedSellerNet = parsedPrice - platformFee;

  return (
    <div className="space-y-12 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Titip Jual Barang Lelang
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground font-light mt-1">
            Lengkapi foto, kondisi, dan harga awal barang. Petugas akan memeriksa pengajuan sebelum menjadwalkan lelang.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex rounded-xl border border-border overflow-hidden text-xs">
          <button
            type="button"
            disabled={isUploadingPhoto || isSaving}
            onClick={() => setActiveTab('submit')}
            className={`px-4 py-2 font-medium ${activeTab === 'submit' ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Form Pengajuan
          </button>
          <button
            type="button"
            disabled={isUploadingPhoto || isSaving}
            onClick={() => setActiveTab('my-items')}
            className={`px-4 py-2 font-medium ${activeTab === 'my-items' ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Barang Titipan Saya ({myItems.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${
            feedback.type === 'success'
              ? 'bg-secondary text-foreground border-border'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Tab 1: Submit Form */}
      {activeTab === 'submit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form onSubmit={handleSubmit} className="lg:col-span-8 space-y-6">
            <fieldset disabled={isSaving} className="min-w-0 space-y-6">
            {editingBarangId && (
              <div className="p-4 rounded-lg bg-muted border border-border flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-semibold text-primary">
                    Mode Perbaikan: Anda sedang memperbaiki pengajuan barang #{editingBarangId}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isUploadingPhoto || isSaving}
                  onClick={handleCancelEdit}
                  className="px-3 py-1 bg-card hover:bg-muted border border-border text-foreground rounded-lg font-medium text-[11px] cursor-pointer"
                >
                  Batal
                </button>
              </div>
            )}
            {editingChanged && <div role="alert" className="space-y-2 border border-destructive p-4 text-sm text-destructive">
              <p>Data barang telah berubah sejak formulir dibuka. Periksa versi terbaru agar perubahan orang lain tidak tertimpa.</p>
              {latestEditingItem && <button type="button" disabled={isUploadingPhoto || isSaving} onClick={() => {
                if (window.confirm('Muat data terbaru? Perubahan yang belum disimpan di formulir ini akan diganti.')) handleStartEdit(latestEditingItem);
              }} className="focus-ring min-h-11 font-semibold underline">Muat data terbaru</button>}
            </div>}

            {/* 1. Info Dasar */}
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
              <h2 className="text-lg font-medium text-foreground">
                1. Informasi Barang
              </h2>

              <div>
                <label htmlFor="submission-name" className="text-xs font-medium text-foreground block mb-1">Nama Barang</label>
                <input
                  type="text"
                  id="submission-name"
                  maxLength={200}
                  required
                  placeholder="Contoh: Honda PCX 160 ABS 2023 Merah Doff"
                  value={namaBarang}
                  onChange={(e) => setNamaBarang(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs text-foreground focus:border-primary outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="submission-category" className="text-xs font-medium text-foreground block mb-1">Kategori</label>
                  <select
                    id="submission-category"
                    value={kategori}
                    onChange={(e) => setKategori(e.target.value as CategoryType)}
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:border-primary outline-none"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="submission-price" className="text-xs font-medium text-foreground block mb-1">
                    Harga Mulai Lelang (Rp) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    id="submission-price"
                    required
                    min={100000}
                    placeholder="Min. 100.000"
                    value={hargaAwal}
                    onChange={(e) => setHargaAwal(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs font-mono font-semibold text-foreground focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="submission-reserve" className="text-xs font-medium text-foreground">
                      Harga Minimal Lepas
                    </label>
                    <span className="text-[10px] text-muted-foreground">Opsional</span>
                  </div>
                  <input
                    type="number"
                    id="submission-reserve"
                    min={Number(hargaAwal) || 100000}
                    placeholder="Reserve price (rahasia)"
                    value={reservePrice}
                    onChange={(e) => setReservePrice(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs font-mono text-foreground focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="submission-description" className="text-xs font-medium text-foreground">
                    Deskripsi & Kondisi <span className="text-destructive">*</span>
                  </label>
                  <span
                    className={`text-[10px] font-mono ${
                      deskripsi.trim().length >= 50 ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {deskripsi.trim().length}/50 karakter minimal
                  </span>
                </div>
                <textarea
                  rows={3}
                  id="submission-description"
                  maxLength={20000}
                  required
                  placeholder="Jelaskan kondisi fisik, riwayat servis, kelengkapan surat, minus/cacat jika ada (minimal 50 karakter)..."
                  value={deskripsi}
                  onChange={(e) => setDeskripsi(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl p-3 text-xs text-foreground focus:border-primary outline-none"
                ></textarea>
              </div>
            </div>

            {/* 2. Foto Barang */}
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-foreground">
                  2. Foto Barang (Multi-Sudut)
                </h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    photoUrls.length >= 3
                      ? 'bg-secondary text-primary border border-border'
                      : 'bg-muted text-muted-foreground border border-border'
                  }`}
                >
                  {photoUrls.length}/3 Foto Wajib Terlampir
                </span>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">Sertakan minimal 3 sudut: depan, samping, serta detail kondisi atau kelengkapan.</p>
              <LotPhotoInput photos={photoUrls} onChange={setPhotoUrls} onBusyChange={setIsUploadingPhoto} disabled={isSaving} />
            </div>

            {/* 3. Dokumen & Spesifikasi */}
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
              <h2 className="text-lg font-medium text-foreground">
                3. Dokumen Legalitas & Spesifikasi
              </h2>

              {/* Dokumen */}
              <div className="space-y-2">
                <label htmlFor="submission-document" className="text-xs text-muted-foreground block">Tautan dokumen pendukung (opsional)</label>
                <p className="text-xs leading-5 text-muted-foreground">Tambahkan tautan dokumen yang dapat diperiksa petugas. Daftar ini tidak tampil di katalog. Jangan mengunggah dokumen identitas melalui kolom foto barang.</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="submission-document"
                    inputMode="url"
                    maxLength={4096}
                    placeholder="https://contoh.com/dokumen.pdf"
                    value={newDocInput}
                    onChange={(e) => setNewDocInput(e.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleAddDoc(); } }}
                    className="focus-ring min-w-0 flex-1 bg-card border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                  />
                  <button
                    type="button"
                    onClick={handleAddDoc}
                    disabled={!newDocInput.trim() || documents.length >= 12}
                    className="px-4 py-2 bg-muted text-foreground border border-border rounded-xl text-xs font-medium"
                  >
                    + Dokumen
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {documents.map((doc, idx) => (
                    <span key={idx} className="px-3 py-1 bg-muted rounded-lg text-xs flex items-center gap-1.5 border border-border">
                      <FileCheck className="w-3.5 h-3.5 text-primary" />
                      <span className="break-all">{doc}</span>
                      <button type="button" onClick={() => handleRemoveDoc(idx)} className="text-muted-foreground hover:text-destructive" aria-label="Hapus dokumen"><X className="h-4 w-4" aria-hidden="true" /></button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Spesifikasi */}
              <div className="space-y-2 pt-3 border-t border-border">
                <label className="text-xs text-muted-foreground block">Spesifikasi Detail</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <input
                    type="text"
                    aria-label="Nama spesifikasi"
                    placeholder="Label (misal: Tahun)"
                    value={newSpecKey}
                    onChange={(e) => setNewSpecKey(e.target.value)}
                    className="sm:col-span-2 bg-card border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                  />
                  <input
                    type="text"
                    aria-label="Nilai spesifikasi"
                    placeholder="Nilai (misal: 2023)"
                    value={newSpecVal}
                    onChange={(e) => setNewSpecVal(e.target.value)}
                    className="sm:col-span-2 bg-card border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                  />
                  <button
                    type="button"
                    onClick={handleAddSpec}
                    className="sm:col-span-1 bg-muted text-foreground border border-border rounded-xl text-xs font-medium py-2"
                  >
                    + Spek
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {specs.map((s, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-muted/40 border border-border flex justify-between text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">{s.key}</span>
                        <span className="font-semibold text-foreground">{s.val}</span>
                      </div>
                      <button type="button" onClick={() => handleRemoveSpec(idx)} className="text-muted-foreground hover:text-destructive" aria-label="Hapus spesifikasi"><X className="h-4 w-4" aria-hidden="true" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving || isUploadingPhoto || editingChanged}
              className="w-full py-3 px-6 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border hover:opacity-90 transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
                      {isSaving ? 'Menyimpan...' : editingBarangId ? 'Simpan Perbaikan & Ajukan Ulang' : 'Kirim Pengajuan ke Tim Kurasi'}
            </button>
            </fieldset>
          </form>

          {/* Right Column: Payout Simulation */}
          <div className="lg:col-span-4 space-y-4">
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
              <h2 className="text-lg font-medium text-foreground">
                Perkiraan Dana Bersih
              </h2>

              <div className="space-y-2 text-xs divide-y divide-border">
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Harga Mulai Lelang:</span>
                  <span className="font-mono font-semibold text-foreground">{formatRupiah(parsedPrice)}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Biaya Layanan (5%):</span>
                  <span className="font-mono text-destructive">-{formatRupiah(platformFee)}</span>
                </div>
                <div className="flex justify-between py-2 font-bold text-sm">
                  <span>Perkiraan Hasil Bersih:</span>
                  <span className="font-mono text-foreground">{formatRupiah(estimatedSellerNet)}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground font-light leading-relaxed">
                Biaya layanan hanya dipotong jika barangmu berhasil laku dan pemenang telah melunasi pembayaran. Jika lelang tidak laku, tidak ada biaya apapun.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: My Submitted Items */}
      {activeTab === 'my-items' && (
        <div className="space-y-4">
          <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
            <h2 className="text-lg font-medium text-foreground">Barang yang diajukan</h2>

            {myItems.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                Anda belum pernah mengajukan barang lelang.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myItems.map((item) => {
                  const relatedLelang = lelangList.find((l) => l.id_barang === item.id_barang);

                  return (
                    <div key={item.id_barang} className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">{item.kategori}</span>
                        <span className="font-semibold text-foreground">
                          {item.status_verifikasi === 'approved' && 'Disetujui'}
                          {item.status_verifikasi === 'pending' && 'Menunggu Kurasi'}
                          {item.status_verifikasi === 'rejected' && 'Ditolak'}
                        </span>
                      </div>

                      <div className="flex gap-3">
                        <img
                          src={item.foto_barang[0] || 'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400'}
                          alt={item.nama_barang}
                          className="w-16 h-16 rounded-lg object-cover border border-border"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?auto=format&fit=crop&q=80&w=400';
                          }}
                        />
                        <div>
                          <h4 className="font-semibold text-foreground text-sm line-clamp-1">{item.nama_barang}</h4>
                          <div className="text-xs font-mono font-bold mt-0.5">{formatRupiah(item.harga_awal)}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{item.tanggal}</div>
                        </div>
                      </div>

                      {item.status_verifikasi === 'pending' && (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleCancelSubmission(item.id_barang, item.nama_barang)}
                          className="w-full py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Batalkan Pengajuan</span>
                        </button>
                      )}

                      {item.status_verifikasi === 'rejected' && (
                        <div className="space-y-2">
                          {item.catatan_kurasi && (
                            <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs">
                              <strong>Catatan Petugas:</strong> {item.catatan_kurasi}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => handleStartEdit(item)}
                            className="w-full py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 hover:opacity-90 transition cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Perbaiki & Ajukan Ulang</span>
                          </button>
                        </div>
                      )}

                      {item.status_verifikasi === 'approved' && relatedLelang && (
                        <button
                          type="button"
                          onClick={() => onNavigate('auction-detail', relatedLelang.id_lelang)}
                          className="w-full py-2 bg-card hover:bg-muted border border-border text-foreground rounded-lg text-xs font-medium"
                        >
                          Lihat Bidding Lelang (#{relatedLelang.id_lelang})
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
