import { useEffect, useId, useRef, useState } from 'react';
import { ImageOff, Upload, X } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { MAX_LOT_PHOTOS, PHOTO_ACCEPT, photoBatchError, validPhotoUrl } from '../../utils/photos';

interface LotPhotoInputProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}

export function LotPhotoInput({ photos, onChange, onBusyChange, disabled = false }: LotPhotoInputProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [url, setUrl] = useState('');
  const busy = Boolean(progress);
  const locked = disabled || busy;
  const full = photos.length >= MAX_LOT_PHOTOS;

  useEffect(() => {
    let active = true;
    setAvailability('loading');
    void api.getUploadAvailability().then(response => {
      if (active) setAvailability(response.data.enabled ? 'ready' : 'unavailable');
    }).catch(() => { if (active) setAvailability('error'); });
    return () => { active = false; };
  }, [retry]);

  async function uploadFiles(files: File[]) {
    if (!files.length || disabled || uploading.current) return;
    setError('');
    setNotice('');
    const validation = photoBatchError(files, photos.length);
    if (validation) { setError(validation); return; }
    if (availability !== 'ready') { setError('Penyimpanan foto belum tersedia. Gunakan tautan foto atau periksa kembali.'); return; }

    uploading.current = true;
    const controller = new AbortController();
    uploadController.current = controller;
    onBusyChange(true);
    const nextPhotos = [...photos];
    const failed: string[] = [];
    let saved = 0;
    try {
      for (let index = 0; index < files.length; index++) {
        if (controller.signal.aborted) break;
        setProgress(`Mengunggah ${index + 1} dari ${files.length}: ${files[index].name}`);
        try {
          const uploadedUrl = await api.uploadFoto(files[index], controller.signal);
          nextPhotos.push(uploadedUrl);
          onChange([...nextPhotos]);
          saved++;
        } catch (reason) {
          if (controller.signal.aborted) break;
          failed.push(`${files[index].name}: ${reason instanceof ApiError ? reason.message : 'Koneksi unggah terputus. Periksa koneksi atau masuk kembali, lalu pilih ulang file.'}`);
        }
      }
      if (controller.signal.aborted) setNotice(`Unggahan dihentikan. ${saved} foto berhasil ditambahkan; foto lainnya bisa dipilih ulang.`);
      else if (saved) setNotice(`${saved} foto berhasil diunggah. Foto pertama menjadi sampul.`);
      if (failed.length) setError(`Belum berhasil diunggah: ${failed.join(' ')} Foto yang berhasil tetap tersimpan pada formulir.`);
    } finally {
      setProgress('');
      uploading.current = false;
      uploadController.current = null;
      onBusyChange(false);
    }
  }

  function addUrl() {
    if (locked) return;
    const value = url.trim();
    setError('');
    if (full) { setError(`Maksimal ${MAX_LOT_PHOTOS} foto per lot.`); return; }
    if (!validPhotoUrl(value)) { setError('Isi tautan langsung ke foto dengan alamat HTTP atau HTTPS yang valid.'); return; }
    if (photos.includes(value)) { setError('Foto dengan tautan ini sudah ditambahkan.'); return; }
    onChange([...photos, value]);
    setUrl('');
    setNotice('Tautan foto ditambahkan. Pastikan pratinjau menampilkan barang yang sesuai.');
  }

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3" aria-busy={busy}>
      <legend className="text-sm font-semibold text-foreground">Foto barang</legend>
      <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">
        {photos.length}/{MAX_LOT_PHOTOS} foto. Foto pertama menjadi sampul. JPG, PNG, WebP, atau GIF, maksimal 10 MB per file.
      </p>
      <div
        data-photo-dropzone
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = !locked && !full && availability === 'ready' ? 'copy' : 'none';
          if (!locked && !full && availability === 'ready') setDragging(true);
        }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
        className={`rounded-lg border border-dashed p-4 text-center ${dragging ? 'border-primary bg-secondary' : 'border-input bg-muted/30'}`}
      >
        <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{full ? 'Batas 12 foto sudah terpenuhi' : 'Tarik foto ke sini atau pilih dari perangkat'}</p>
        <button
          type="button"
          disabled={locked || full || availability !== 'ready'}
          onClick={() => input.current?.click()}
          aria-describedby={`${id}-help ${id}-availability`}
          className="focus-ring mt-3 min-h-11 rounded border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Sedang mengunggah…' : 'Pilih foto'}
        </button>
        <input ref={input} id={`${id}-files`} type="file" multiple accept={PHOTO_ACCEPT} disabled={locked || full || availability !== 'ready'} aria-label="Pilih file foto barang" className="sr-only" tabIndex={-1}
          onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; void uploadFiles(files); }} />
        <p id={`${id}-availability`} className="mt-2 text-xs leading-5 text-muted-foreground">
          {availability === 'loading' && 'Memeriksa penyimpanan foto…'}
          {availability === 'ready' && 'Bisa memilih beberapa foto sekaligus.'}
          {availability === 'unavailable' && 'Penyimpanan file belum aktif. Kamu tetap bisa menambahkan tautan foto di bawah.'}
          {availability === 'error' && 'Status penyimpanan belum dapat diperiksa. Coba periksa kembali.'}
        </p>
        {(availability === 'error' || availability === 'unavailable') && <button type="button" disabled={locked} onClick={() => setRetry(value => value + 1)} className="focus-ring min-h-11 px-3 text-xs font-semibold text-primary underline">Periksa kembali</button>}
      </div>
      <p role="status" aria-live="polite" className="break-words text-xs leading-5 text-muted-foreground">{progress || notice}</p>
      {busy && <button type="button" onClick={() => uploadController.current?.abort()} className="focus-ring min-h-11 text-xs font-semibold text-destructive underline">Hentikan unggahan</button>}
      {error && <p role="alert" className="break-words text-xs leading-5 text-destructive">{error}</p>}

      {photos.length > 0 && <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => <li key={photo} className="min-w-0 overflow-hidden rounded-lg border border-border">
          <PhotoPreview url={photo} index={index} />
          <div className="flex items-center justify-between gap-1 p-2">
            {index === 0 ? <span className="min-w-0 flex-1 text-xs font-semibold text-primary">Sampul</span> : <button type="button" disabled={locked} onClick={() => onChange([photo, ...photos.filter((_, i) => i !== index)])} className="focus-ring min-h-11 min-w-0 flex-1 text-xs text-primary underline disabled:opacity-50">Jadikan sampul</button>}
            <button type="button" disabled={locked} aria-label={`Hapus foto ${index + 1}`} onClick={() => { onChange(photos.filter((_, i) => i !== index)); setError(''); setNotice('Foto dilepas dari lot.'); }} className="focus-ring flex min-h-11 min-w-11 shrink-0 items-center justify-center text-destructive disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </li>)}
      </ol>}

      <details className="rounded-lg border border-border p-3">
        <summary className="focus-ring cursor-pointer py-2 text-xs font-medium text-foreground">Pakai tautan foto yang sudah tersedia</summary>
        <label htmlFor={`${id}-url`} className="mb-1 mt-3 block text-xs text-muted-foreground">Tautan langsung ke foto</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id={`${id}-url`} type="text" inputMode="url" maxLength={4096} placeholder="https://…" value={url} disabled={locked || full} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addUrl(); } }} className="focus-ring min-h-11 min-w-0 flex-1 rounded border border-input bg-card px-3 text-sm text-foreground" />
          <button type="button" disabled={locked || full || !url.trim()} onClick={addUrl} className="focus-ring min-h-11 rounded border border-input px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">Tambahkan tautan</button>
        </div>
      </details>
    </fieldset>
  );
}

function PhotoPreview({ url, index }: { url: string; index: number }) {
  const [broken, setBroken] = useState(false);
  return <div className="flex aspect-[4/3] items-center justify-center bg-muted">
    {broken ? <div className="px-2 text-center text-xs text-muted-foreground"><ImageOff className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />Foto {index + 1} tidak dapat dimuat. Periksa tautannya.</div> : <img src={url} alt={`Foto barang ${index + 1}`} onError={() => setBroken(true)} className="h-full w-full object-contain" />}
  </div>;
}
