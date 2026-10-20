import React, { useMemo, useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { AuctionCard } from '../common/AuctionCard';

interface ThemeDetailPageProps {
  themeId: number;
  onBack: () => void;
  onSelectAuction: (lelangId: number) => void;
  onNavigate: (view: string) => void;
}

export const ThemeDetailPage: React.FC<ThemeDetailPageProps> = ({ themeId, onBack, onSelectAuction, onNavigate }) => {
  const { themesList, allJoinedAuctions, catalogStatus, reloadCatalog } = useAuction();
  const [category, setCategory] = useState('Semua');
  const [status, setStatus] = useState<'active' | 'ended'>('active');
  const [shareStatus, setShareStatus] = useState('');
  const theme = themesList.find((item) => item.id_theme === themeId);
  const lots = useMemo(() => theme ? allJoinedAuctions.filter(item => item.lelang.status !== 'draft' && item.barang.status_verifikasi === 'approved').filter((item) => theme.id_lelang_list.includes(item.lelang.id_lelang)) : [], [allJoinedAuctions, theme]);
  const categories = ['Semua', ...new Set(lots.map((item) => item.barang.kategori))];
  const visibleLots = lots.filter(({ barang, lelang }) => (category === 'Semua' || barang.kategori === category)
    && (status === 'active' ? ['dibuka', 'terjadwal'].includes(lelang.status) : ['ditutup', 'dibatalkan'].includes(lelang.status)));
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setShareStatus('Tautan disalin'); }
    catch { setShareStatus('Tautan belum dapat disalin. Salin alamat dari browser Anda.'); }
  };

  if (!theme) return (
    <div className="py-16 text-center" role="status"><h1 className="section-title">{catalogStatus === 'loading' ? 'Memuat koleksi...' : catalogStatus === 'error' ? 'Koleksi belum dapat dimuat' : 'Koleksi tidak ditemukan'}</h1>
      {catalogStatus !== 'loading' && <button type="button" onClick={catalogStatus === 'error' ? reloadCatalog : onBack} className="button-secondary mt-6">{catalogStatus === 'error' ? 'Muat ulang' : 'Kembali ke katalog'}</button>}
    </div>
  );

  return (
    <article>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <button type="button" onClick={onBack} className="text-link min-h-11 text-sm text-muted-foreground">Kembali ke katalog</button>
        <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-muted-foreground" role="status">{shareStatus}</span><button type="button" onClick={share} className="button-secondary">Salin tautan koleksi</button></div>
      </div>
      <div className="catalog-layout">
        <aside className="min-w-0 self-start lg:sticky lg:top-40">
          <h2 className="mb-3 text-base font-semibold">Kategori koleksi</h2>
          <nav className="category-list" aria-label="Kategori koleksi">{categories.map((item) => <button key={item} type="button" className="category-link" aria-pressed={category === item} onClick={() => setCategory(item)}>{item === 'Semua' ? 'Semua kategori' : item}</button>)}</nav>
          <div className="mt-6 border-t border-border pt-5"><p className="text-sm text-muted-foreground">Punya barang untuk dilelang?</p><button type="button" onClick={() => onNavigate('c2c-submit')} className="text-link min-h-11 text-sm text-primary">Ajukan barang</button></div>
        </aside>
        <div className="min-w-0">
          {theme.gambar_cover && <img src={theme.gambar_cover} alt={theme.nama_theme} className="mb-7 aspect-[16/7] w-full bg-muted object-cover" />}
          <header className="border-b border-border pb-7">
            <p className="mb-3 text-sm text-primary">{theme.tipe === 'hammer' ? 'Lelang palu' : 'Koleksi tematik'}</p>
            <h1 className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">{theme.nama_theme}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{[theme.subjudul_jadwal, theme.nama_kurator].filter(Boolean).join(' · ')}</p>
            {theme.deskripsi && <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">{theme.deskripsi}</p>}
          </header>
          <div className="mb-7 flex items-center gap-6 border-b border-border" aria-label="Status lot koleksi">
            {(['active', 'ended'] as const).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className={`min-h-12 border-b-2 text-sm ${status === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`}>{value === 'active' ? 'Aktif & mendatang' : 'Selesai'}</button>)}
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">{visibleLots.length} lot</span>
          </div>
          {visibleLots.length ? <div className="lot-grid">{visibleLots.map((auction) => <AuctionCard key={auction.lelang.id_lelang} auction={auction} onSelect={onSelectAuction} />)}</div> : (
            <div className="border-b border-border py-14 text-center"><h2 className="text-lg font-medium">Belum ada lot yang sesuai</h2><p className="mt-2 text-sm text-muted-foreground">Pilih kategori atau status lain untuk melihat isi koleksi.</p><button type="button" onClick={() => { setCategory('Semua'); setStatus('active'); }} className="button-secondary mt-5">Reset pilihan</button></div>
          )}
        </div>
      </div>
    </article>
  );
};
