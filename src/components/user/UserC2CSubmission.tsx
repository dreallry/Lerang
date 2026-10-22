import React, { useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { LotPhotoInput } from '../common/LotPhotoInput';
import { useFormFeedback } from '../common/FormFeedback';
import { CategoryType } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import { itemRevision } from '../../utils/catalogData';
import { submissionDetails } from '../../utils/submissionDetails';
import {
  FilePlus2,
  CheckCircle2,
  AlertTriangle,
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
  const { showError, showSuccess, clearFeedback } = useFormFeedback();

  const [activeTab, setActiveTab] = useState<'submit' | 'my-items'>('submit');
  const [editingBarangId, setEditingBarangId] = useState<number | null>(null);
  const [editingRevision, setEditingRevision] = useState('');

  const [namaBarang, setNamaBarang] = useState('');
  const [kategori, setKategori] = useState<CategoryType | ''>('');
  const [hargaAwal, setHargaAwal] = useState<string>('');
  const [reservePrice, setReservePrice] = useState<string>('');
  const [deskripsi, setDeskripsi] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [documents, setDocuments] = useState<string[]>([]);
  const [specs, setSpecs] = useState<{ key: string; val: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const clearFieldError = (field: string) => setFieldErrors(previous => {
    const next = { ...previous };
    delete next[field];
    return next;
  });
  const reportError = (msg: string, field?: string) => {
    setFeedback({ type: 'error', msg });
    if (field) setFieldErrors(previous => ({ ...previous, [field]: msg }));
    showError(msg, { target: field ? document.getElementById(field) : null });
  };
  const errorFor = (field: string) => fieldErrors[field] && <p id={`${field}-error`} className="mt-2 text-sm text-destructive">{fieldErrors[field]}</p>;

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
    setFieldErrors({});
    setFeedback(null);
    clearFeedback();
    setActiveTab('submit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingBarangId(null);
    setEditingRevision('');
    setNamaBarang('');
    setKategori('');
    setHargaAwal('');
    setReservePrice('');
    setDeskripsi('');
    setPhotoUrls([]);
    setDocuments([]);
    setSpecs([]);
    setFieldErrors({});
    setFeedback(null);
    clearFeedback();
  };

  const handleCancelSubmission = async (id_barang: number, nama: string) => {
    if (isSaving) return;
    if (window.confirm(`Yakin ingin membatalkan pengajuan "${nama}"? Pengajuan ini akan dihapus dari antrean kurasi petugas.`)) {
      setIsSaving(true);
      try {
        const res = await cancelC2CSubmission(id_barang);
        if (res.success) {
          setFeedback({ type: 'success', msg: res.message });
          showSuccess(res.message);
        } else reportError(res.message);
      } catch { reportError('Pembatalan belum dapat dipastikan. Muat ulang daftar sebelum mencoba kembali.'); }
      finally { setIsSaving(false); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploadingPhoto) return;
    clearFeedback();
    setFeedback(null);
    setFieldErrors({});
    if (editingChanged) { reportError('Data barang telah berubah. Muat versi terbaru sebelum mengajukan perbaikan.', 'submission-version'); return; }
    if (!namaBarang.trim()) {
      reportError('Isi nama barang yang ingin diajukan.', 'submission-name');
      return;
    }
    if (!kategori) { reportError('Pilih kategori barang.', 'submission-category'); return; }

    const priceNum = Number(hargaAwal);
    if (!hargaAwal || !Number.isSafeInteger(priceNum) || priceNum < 100000) {
      reportError('Harga mulai lelang minimal Rp 100.000 dan harus berupa rupiah bulat.', 'submission-price');
      return;
    }

    if (reservePrice) {
      const reserveNum = Number(reservePrice);
      if (!Number.isSafeInteger(reserveNum) || reserveNum < priceNum) {
        reportError('Harga minimal lepas harus sama dengan atau lebih tinggi dari harga mulai lelang.', 'submission-reserve');
        return;
      }
    }

    if (deskripsi.trim().length < 50) {
      reportError(`Deskripsi minimal 50 karakter; baru ${deskripsi.trim().length} karakter. Jelaskan kondisi dan kelengkapan barang.`, 'submission-description');
      return;
    }
    if (photoUrls.length < 3) {
      reportError(`Tambahkan minimal 3 foto: tampak depan, samping, dan detail kondisi. Baru ${photoUrls.length} foto terlampir.`, 'submission-photos');
      return;
    }
    const details = submissionDetails(documents, specs);
    if (details.error) { reportError(details.error.message, details.error.field); return; }

    const submission = {
      nama_barang: namaBarang.trim(),
      kategori,
      harga_awal: priceNum,
      deskripsi_barang: deskripsi.trim(),
      foto_barang: photoUrls,
      dokumen_pendukung: details.documents,
      spesifikasi: details.specifications,
      reserve_price: reservePrice ? Number(reservePrice) : editingBarangId ? 0 : undefined,
    };
    setIsSaving(true);
    try {
      const res = editingBarangId
        ? await resubmitC2CItem(editingBarangId, { ...submission, expected_updated_at: editingRevision })
        : await submitC2CItem(submission);
      if (res.success) {
        setFeedback({ type: 'success', msg: res.message });
        showSuccess(`${res.message} Pantau statusnya di Barang Titipan Saya.`);
        setNamaBarang('');
        setKategori('');
        setHargaAwal('');
        setReservePrice('');
        setDeskripsi('');
        setPhotoUrls([]);
        setDocuments([]);
        setSpecs([]);
        setEditingBarangId(null);
        setEditingRevision('');
        setActiveTab('my-items');
      } else reportError(`${res.message} Isian dan foto tetap tersedia.`);
    } catch { reportError('Pengajuan belum dapat dipastikan. Isian dan foto tetap tersedia. Periksa Barang Titipan Saya sebelum mencoba mengirim ulang.'); }
    finally { setIsSaving(false); }
  };

  const parsedPrice = Number(hargaAwal) || 0;
  const platformFee = Math.round(parsedPrice * 0.05);
  const estimatedSellerNet = parsedPrice - platformFee;

  return (
    <div className="space-y-7 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
            Titip jual barang
          </h1>
          <p className="text-sm leading-6 text-muted-foreground mt-2">
            Isi informasi barang dan unggah minimal 3 foto. Petugas akan memeriksa pengajuan sebelum barang dijadwalkan untuk lelang.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex rounded-xl border border-border overflow-hidden text-xs">
          <button
            type="button"
            disabled={isUploadingPhoto || isSaving}
            onClick={() => { setActiveTab('submit'); setFeedback(null); clearFeedback(); }}
            aria-pressed={activeTab === 'submit'}
            className={`min-h-11 px-4 py-2 font-medium ${activeTab === 'submit' ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Form Pengajuan
          </button>
          <button
            type="button"
            disabled={isUploadingPhoto || isSaving}
            onClick={() => { setActiveTab('my-items'); setFeedback(null); clearFeedback(); }}
            aria-pressed={activeTab === 'my-items'}
            className={`min-h-11 px-4 py-2 font-medium ${activeTab === 'my-items' ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Barang Titipan Saya ({myItems.length})
          </button>
        </div>
      </div>

      {feedback?.type === 'success' && (
        <div role="status" className="p-4 rounded border border-primary bg-secondary text-sm flex items-start gap-3"
        >
          <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-primary flex-shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Tab 1: Submit Form */}
      {activeTab === 'submit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form onSubmit={handleSubmit} className="lg:col-span-8 min-w-0 space-y-6" aria-label="Pengajuan barang">
            <fieldset disabled={isSaving} className="min-w-0 space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">Bagian 1 dan 2 wajib dilengkapi. Bagian 3 boleh dilewati. Isian bertanda <span className="text-destructive">*</span> wajib diisi.</p>
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
            {editingChanged && <div id="submission-version" tabIndex={-1} role="alert" className="space-y-2 border border-destructive p-4 text-sm text-destructive">
              <p>Data barang telah berubah sejak formulir dibuka. Periksa versi terbaru agar perubahan orang lain tidak tertimpa.</p>
              {latestEditingItem && <button type="button" disabled={isUploadingPhoto || isSaving} onClick={() => {
                if (window.confirm('Muat data terbaru? Perubahan yang belum disimpan di formulir ini akan diganti.')) handleStartEdit(latestEditingItem);
              }} className="focus-ring min-h-11 font-semibold underline">Muat data terbaru</button>}
            </div>}

            {/* 1. Info Dasar */}
            <section aria-labelledby="submission-info-title" className="p-5 sm:p-6 rounded border border-border bg-card space-y-5">
              <h2 id="submission-info-title" className="text-lg font-medium text-foreground">
                1. Informasi barang
              </h2>

              <div>
                <label htmlFor="submission-name" className="text-sm font-medium text-foreground block mb-2">Nama Barang <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  id="submission-name"
                  maxLength={200}
                  required
                  placeholder="Contoh: Honda PCX 160 ABS 2023 Merah Doff"
                  value={namaBarang}
                  onChange={(e) => { setNamaBarang(e.target.value); clearFieldError('submission-name'); }}
                  aria-invalid={!!fieldErrors['submission-name'] || undefined}
                  aria-describedby={fieldErrors['submission-name'] ? 'submission-name-error' : undefined}
                  className="catalog-input"
                />
                {errorFor('submission-name')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                  <label htmlFor="submission-category" className="text-sm font-medium text-foreground block mb-2">Kategori <span className="text-destructive">*</span></label>
                  <select
                    id="submission-category"
                    required
                    value={kategori}
                    onChange={(e) => { setKategori(e.target.value as CategoryType); clearFieldError('submission-category'); }}
                    aria-invalid={!!fieldErrors['submission-category'] || undefined}
                    aria-describedby={fieldErrors['submission-category'] ? 'submission-category-error' : undefined}
                    className="catalog-input"
                  >
                    <option value="" disabled>Pilih kategori barang</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  {errorFor('submission-category')}
                </div>

                <div>
                  <label htmlFor="submission-price" className="text-sm font-medium text-foreground block mb-2">
                    Harga Mulai Lelang (Rp) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    id="submission-price"
                    required
                    min={100000}
                    max={9999999999999}
                    step={1}
                    placeholder="Min. 100.000"
                    value={hargaAwal}
                    onChange={(e) => { setHargaAwal(e.target.value); clearFieldError('submission-price'); }}
                    aria-invalid={!!fieldErrors['submission-price'] || undefined}
                    aria-describedby={`submission-price-help${fieldErrors['submission-price'] ? ' submission-price-error' : ''}`}
                    className="catalog-input tabular-nums"
                  />
                  <p id="submission-price-help" className="mt-2 text-xs leading-5 text-muted-foreground">Penawaran dimulai dari harga ini. Minimal Rp 100.000.</p>
                  {errorFor('submission-price')}
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <label htmlFor="submission-reserve" className="text-sm font-medium text-foreground">
                      Harga Minimal Lepas (Rp)
                    </label>
                    <span className="text-xs text-muted-foreground">Opsional</span>
                  </div>
                  <input
                    type="number"
                    id="submission-reserve"
                    min={Number(hargaAwal) || 100000}
                    max={9999999999999}
                    step={1}
                    placeholder="Boleh dikosongkan"
                    value={reservePrice}
                    onChange={(e) => { setReservePrice(e.target.value); clearFieldError('submission-reserve'); }}
                    aria-invalid={!!fieldErrors['submission-reserve'] || undefined}
                    aria-describedby={`submission-reserve-help${fieldErrors['submission-reserve'] ? ' submission-reserve-error' : ''}`}
                    className="catalog-input tabular-nums"
                  />
                  <p id="submission-reserve-help" className="mt-2 text-xs leading-5 text-muted-foreground">Batas harga terendah yang kamu terima. Tidak ditampilkan kepada penawar dan tidak boleh di bawah harga mulai lelang.</p>
                  {errorFor('submission-reserve')}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                  <label htmlFor="submission-description" className="text-sm font-medium text-foreground">
                    Deskripsi & Kondisi <span className="text-destructive">*</span>
                  </label>
                  <span
                    className={`text-xs ${
                      deskripsi.trim().length >= 50 ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {deskripsi.trim().length < 50 ? `Kurang ${50 - deskripsi.trim().length} karakter` : `${deskripsi.trim().length} karakter, minimum terpenuhi`}
                  </span>
                </div>
                <textarea
                  rows={5}
                  id="submission-description"
                  maxLength={20000}
                  required
                  placeholder="Jelaskan kondisi fisik, riwayat servis, kelengkapan surat, minus/cacat jika ada (minimal 50 karakter)..."
                  value={deskripsi}
                  onChange={(e) => { setDeskripsi(e.target.value); clearFieldError('submission-description'); }}
                  aria-invalid={!!fieldErrors['submission-description'] || undefined}
                  aria-describedby={`submission-description-help${fieldErrors['submission-description'] ? ' submission-description-error' : ''}`}
                  className="catalog-input resize-y leading-6"
                ></textarea>
                <p id="submission-description-help" className="mt-2 text-xs leading-5 text-muted-foreground">Minimal 50 karakter. Sebutkan kondisi, kekurangan, riwayat penggunaan, dan kelengkapan yang ikut dijual.</p>
                {errorFor('submission-description')}
              </div>
            </section>

            {/* 2. Foto Barang */}
            <section id="submission-photos" tabIndex={-1} aria-labelledby="submission-photos-title" aria-describedby={fieldErrors['submission-photos'] ? 'submission-photos-error' : undefined} className={`p-5 sm:p-6 rounded bg-card border space-y-4 ${fieldErrors['submission-photos'] ? 'border-destructive' : 'border-border'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="submission-photos-title" className="text-lg font-medium text-foreground">
                  2. Foto barang <span className="text-destructive">*</span>
                </h2>
                <span
                  className={`text-sm font-medium ${
                    photoUrls.length >= 3
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  {photoUrls.length >= 3 ? `${photoUrls.length} foto terlampir` : `Tambahkan ${3 - photoUrls.length} foto lagi`}
                </span>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">Sertakan minimal 3 sudut: depan, samping, serta detail kondisi atau kelengkapan.</p>
              <LotPhotoInput photos={photoUrls} onChange={photos => { setPhotoUrls(photos); clearFieldError('submission-photos'); }} onBusyChange={setIsUploadingPhoto} disabled={isSaving} />
              {errorFor('submission-photos')}
            </section>

            {/* 3. Dokumen & Spesifikasi */}
            <section aria-labelledby="submission-details-title" className="p-5 sm:p-6 rounded border border-border bg-card space-y-6">
              <div>
                <h2 id="submission-details-title" className="text-lg font-medium">3. Detail tambahan <span className="text-sm font-normal text-muted-foreground">(opsional)</span></h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Boleh dilewati. Setiap baris yang kamu isi langsung ikut dikirim bersama pengajuan; tidak perlu menyimpan satu per satu.</p>
              </div>
              <div className="space-y-4">
                <div><h3 className="text-sm font-semibold">Dokumen pendukung</h3><p id="submission-documents-help" className="mt-2 text-xs leading-5 text-muted-foreground">Masukkan tautan HTTP/HTTPS, misalnya sertifikat atau bukti kelengkapan. Dokumen hanya untuk pemeriksaan petugas dan tidak tampil di katalog. Jangan taruh foto KTP di bagian foto barang.</p></div>
                {documents.map((value, index) => {
                  const field = `submission-document-${index}`;
                  return <div key={index}>
                    <label htmlFor={field} className="mb-2 block text-sm">Tautan dokumen {index + 1}</label>
                    <div className="flex items-start gap-2">
                      <input id={field} type="text" inputMode="url" maxLength={4096} placeholder="https://contoh.com/sertifikat.pdf" value={value}
                        aria-invalid={!!fieldErrors[field] || undefined} aria-describedby={`submission-documents-help${fieldErrors[field] ? ` ${field}-error` : ''}`}
                        onChange={event => { setDocuments(documents.map((doc, i) => i === index ? event.target.value : doc)); clearFieldError(field); }} className="catalog-input min-w-0 flex-1" />
                      <button type="button" className="focus-ring flex min-h-11 min-w-11 shrink-0 items-center justify-center text-destructive" aria-label={`Hapus dokumen ${index + 1}`} onClick={() => { setDocuments(documents.filter((_, i) => i !== index)); setFieldErrors({}); }}><X className="h-4 w-4" aria-hidden="true" /></button>
                    </div>
                    {errorFor(field)}
                  </div>;
                })}
                <button type="button" disabled={documents.length >= 12} className="button-secondary" onClick={() => setDocuments([...documents, ''])}><Plus className="h-4 w-4" aria-hidden="true" />Tambah tautan dokumen</button>
                <p className="text-xs text-muted-foreground">{documents.length ? `${documents.length} dari 12 baris. Baris kosong tidak akan dikirim.` : 'Belum ada dokumen. Tetap bisa mengajukan barang.'}</p>
              </div>
              <div className="space-y-4 border-t border-border pt-6">
                <div><h3 className="text-sm font-semibold">Spesifikasi barang</h3><p id="submission-specs-help" className="mt-2 text-xs leading-5 text-muted-foreground">Isi pasangan nama dan nilai, misalnya Tahun: 2023 atau Warna: Merah. Lengkapi kedua kolom atau hapus baris yang tidak diperlukan.</p></div>
                {specs.map((spec, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] gap-2 border-b border-border pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]">
                  <div className="min-w-0">
                    <label htmlFor={`submission-spec-key-${index}`} className="mb-2 block text-sm">Nama spesifikasi {index + 1}</label>
                    <input id={`submission-spec-key-${index}`} type="text" maxLength={100} placeholder="Contoh: Tahun" value={spec.key}
                      aria-invalid={!!fieldErrors[`submission-spec-key-${index}`] || undefined} aria-describedby={`submission-specs-help${fieldErrors[`submission-spec-key-${index}`] ? ` submission-spec-key-${index}-error` : ''}`}
                      onChange={event => { setSpecs(specs.map((row, i) => i === index ? { ...row, key: event.target.value } : row)); clearFieldError(`submission-spec-key-${index}`); }} className="catalog-input" />
                    {errorFor(`submission-spec-key-${index}`)}
                  </div>
                  <div className="col-start-1 min-w-0 sm:col-start-auto">
                    <label htmlFor={`submission-spec-value-${index}`} className="mb-2 block text-sm">Nilai spesifikasi {index + 1}</label>
                    <input id={`submission-spec-value-${index}`} type="text" maxLength={2000} placeholder="Contoh: 2023" value={spec.val}
                      aria-invalid={!!fieldErrors[`submission-spec-value-${index}`] || undefined} aria-describedby={`submission-specs-help${fieldErrors[`submission-spec-value-${index}`] ? ` submission-spec-value-${index}-error` : ''}`}
                      onChange={event => { setSpecs(specs.map((row, i) => i === index ? { ...row, val: event.target.value } : row)); clearFieldError(`submission-spec-value-${index}`); }} className="catalog-input" />
                    {errorFor(`submission-spec-value-${index}`)}
                  </div>
                  <button type="button" className="focus-ring col-start-2 row-start-1 flex min-h-11 min-w-11 items-center justify-center self-end text-destructive sm:col-start-3" aria-label={`Hapus spesifikasi ${index + 1}`} onClick={() => { setSpecs(specs.filter((_, i) => i !== index)); setFieldErrors({}); }}><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>)}
                <button type="button" disabled={specs.length >= 50} className="button-secondary" onClick={() => setSpecs([...specs, { key: '', val: '' }])}><Plus className="h-4 w-4" aria-hidden="true" />Tambah spesifikasi</button>
                <p className="text-xs text-muted-foreground">{specs.length ? `${specs.length} dari 50 baris. Baris kosong tidak akan dikirim.` : 'Belum ada spesifikasi tambahan. Bagian ini boleh dilewati.'}</p>
              </div>
            </section>

            <section aria-labelledby="submission-review-title" className="space-y-4 border-y border-border py-6">
              <h2 id="submission-review-title" className="text-lg font-medium">4. Periksa dan kirim</h2>
              <p className="text-sm leading-6 text-muted-foreground">Pastikan informasi dan foto sesuai kondisi barang. Baris dokumen atau spesifikasi yang kosong akan dilewati.</p>
              <dl className="space-y-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><dt>Harga mulai lelang</dt><dd className="font-semibold tabular-nums">{formatRupiah(parsedPrice)}</dd></div>
                <div className="flex flex-wrap justify-between gap-2"><dt>Biaya layanan jika terjual (5%)</dt><dd className="tabular-nums">{formatRupiah(platformFee)}</dd></div>
                <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3"><dt className="font-semibold">Perkiraan hasil bersih</dt><dd className="font-semibold tabular-nums">{formatRupiah(estimatedSellerNet)}</dd></div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">Perkiraan memakai harga mulai lelang. Hasil akhir mengikuti harga barang terjual. Biaya layanan dipotong setelah pemenang melunasi pembayaran.</p>
              {feedback?.type === 'error' && <p className="flex items-start gap-2 text-sm leading-6 text-destructive"><AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" /><span>{feedback.msg}</span></p>}
              <button
              type="submit"
              disabled={isSaving || isUploadingPhoto || editingChanged}
              className="button-primary w-full disabled:opacity-50"
            >
                      {isSaving ? 'Mengirim pengajuan...' : isUploadingPhoto ? 'Tunggu foto selesai diunggah...' : editingBarangId ? 'Simpan perbaikan & ajukan ulang' : 'Kirim pengajuan'}
            </button>
              <p className="text-xs leading-5 text-muted-foreground">Setelah terkirim, statusnya Menunggu Kurasi. Kamu bisa memantaunya di Barang Titipan Saya.</p>
            </section>
            </fieldset>
          </form>

          <aside aria-labelledby="submission-next-title" className="lg:col-span-4 lg:sticky lg:top-44 border border-border bg-muted/40 p-5 sm:p-6">
            <h2 id="submission-next-title" className="text-lg font-medium">Setelah pengajuan dikirim</h2>
            <ol className="mt-5 list-decimal space-y-5 pl-5 text-sm leading-6">
              <li><strong className="block font-semibold">Petugas memeriksa barang</strong><span className="text-muted-foreground">Informasi, foto, dan dokumen diperiksa sebelum barang bisa dilelang.</span></li>
              <li><strong className="block font-semibold">Pantau hasil pemeriksaan</strong><span className="text-muted-foreground">Buka Barang Titipan Saya. Jika ditolak, baca catatan petugas, perbaiki isian, lalu ajukan ulang.</span></li>
              <li><strong className="block font-semibold">Barang disiapkan untuk lelang</strong><span className="text-muted-foreground">Pengajuan yang disetujui akan dijadwalkan oleh petugas. Persetujuan belum berarti lelang langsung dimulai.</span></li>
            </ol>
          </aside>
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
