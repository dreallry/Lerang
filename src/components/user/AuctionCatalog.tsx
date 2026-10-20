import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAuction } from '../../context/AuctionContext';
import { CategoryType } from '../../types';
import { CuratedRecommendationsCarousel } from '../ui/carousel';
import { AuctionCard } from '../common/AuctionCard';
import { ThemeCarousel } from '../common/ThemeCarousel';
import { UpcomingSessionBanner } from '../common/UpcomingSessionBanner';
import { ParallaxComponent } from '../ui/parallax-scrolling';

interface AuctionCatalogProps {
  onSelectAuction: (lelangId: number) => void;
  onSelectTheme: (themeId: number) => void;
  onSelectSession?: (sesiId: number) => void;
  onNavigate: (view: string, id?: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

const CATEGORIES: ('Semua' | CategoryType)[] = [
  'Semua', 'Kendaraan', 'Elektronik & Gadget', 'Barang Mewah & Jam', 'Koleksi & Seni', 'Properti',
];
const STATUSES = [
  { value: 'all', label: 'Semua lot' },
  { value: 'dibuka', label: 'Sedang berlangsung' },
  { value: 'terjadwal', label: 'Akan datang' },
  { value: 'ditutup', label: 'Selesai' },
] as const;
type SortBy = 'ending_soon' | 'highest_bid' | 'lowest_bid' | 'most_bids';

export const AuctionCatalog: React.FC<AuctionCatalogProps> = ({
  onSelectAuction, onSelectTheme, onSelectSession, onNavigate, searchQuery, onSearchChange,
}) => {
  const { allJoinedAuctions: joinedAuctions, themesList, selectedThemeId, setSelectedThemeId, catalogStatus, reloadCatalog } = useAuction();
  const allJoinedAuctions = useMemo(() => joinedAuctions.filter(item => item.lelang.status !== 'draft' && item.barang.status_verifikasi === 'approved'), [joinedAuctions]);
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]['value']>('all');
  const [sortBy, setSortBy] = useState<SortBy>('ending_soon');
  const selectedTheme = themesList.find((theme) => theme.id_theme === selectedThemeId);
  const categoryCounts = useMemo(() => Object.fromEntries(CATEGORIES.map((category) => [
    category, category === 'Semua' ? allJoinedAuctions.length : allJoinedAuctions.filter((item) => item.barang.kategori === category).length,
  ])), [allJoinedAuctions]);
  const filteredAuctions = useMemo(() => allJoinedAuctions.filter((item) => {
    if (selectedTheme && !selectedTheme.id_lelang_list.includes(item.lelang.id_lelang)) return false;
    if (statusFilter !== 'all' && item.lelang.status !== statusFilter) return false;
    if (selectedCategory !== 'Semua' && item.barang.kategori !== selectedCategory) return false;
    const query = searchQuery.trim().toLocaleLowerCase('id-ID');
    return !query || [item.barang.nama_barang, item.barang.deskripsi_barang, item.barang.kategori]
      .some((value) => value.toLocaleLowerCase('id-ID').includes(query));
  }).sort((a, b) => {
    if (sortBy === 'highest_bid') return b.lelang.harga_akhir - a.lelang.harga_akhir;
    if (sortBy === 'lowest_bid') return a.barang.harga_awal - b.barang.harga_awal;
    if (sortBy === 'most_bids') return b.totalBids - a.totalBids;
    if (a.lelang.status === 'dibuka' && b.lelang.status !== 'dibuka') return -1;
    if (b.lelang.status === 'dibuka' && a.lelang.status !== 'dibuka') return 1;
    return Date.parse(a.lelang.tgl_selesai) - Date.parse(b.lelang.tgl_selesai);
  }), [allJoinedAuctions, searchQuery, selectedCategory, selectedTheme, statusFilter, sortBy]);
  const hasFilters = selectedCategory !== 'Semua' || !!searchQuery.trim() || statusFilter !== 'all' || selectedThemeId !== null;
  const scrollToCatalog = () => document.getElementById('catalog-content')?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  const resetFilters = () => {
    setSelectedCategory('Semua');
    onSearchChange('');
    setStatusFilter('all');
    setSelectedThemeId(null);
  };

  return (
    <div className="site-container py-6 pb-16 sm:py-9 sm:pb-20">
      <div className="catalog-layout">
        <aside className="min-w-0 self-start lg:sticky lg:top-40" aria-label="Kategori lelang">
          <h2 className="mb-3 text-base font-semibold">Jelajahi kategori</h2>
          <nav className="category-list" aria-label="Filter kategori">
            {CATEGORIES.map((category) => (
              <button key={category} type="button" className="category-link" aria-pressed={selectedCategory === category}
                onClick={() => { setSelectedCategory(category); scrollToCatalog(); }}>
                <span>{category === 'Semua' ? 'Semua kategori' : category}</span>
                {catalogStatus === 'ready' && <span className="text-xs font-normal tabular-nums text-muted-foreground">{categoryCounts[category]}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-7 hidden border-t border-border pt-5 lg:block">
            <p className="text-sm font-medium">Pertama kali ikut lelang?</p>
            <button type="button" onClick={() => onNavigate('guide')} className="text-link mt-1 min-h-11 text-sm text-primary">Baca panduan lelang</button>
          </div>
        </aside>

        <div className="min-w-0 space-y-10 sm:space-y-14">
          <ParallaxComponent onExplore={scrollToCatalog} onNavigate={onNavigate} />
          <ThemeCarousel themes={themesList} selectedThemeId={selectedThemeId}
            onSelectTheme={(id) => id === null ? setSelectedThemeId(null) : onSelectTheme(id)}
            onShowAll={() => setSelectedThemeId(null)} />
          <UpcomingSessionBanner onSelectSession={(id) => onSelectSession ? onSelectSession(id) : onNavigate('session-detail', id)} />
          <CuratedRecommendationsCarousel auctions={allJoinedAuctions} onSelectAuction={onSelectAuction} />

          <section id="catalog-content" aria-labelledby="catalog-title" aria-busy={catalogStatus === 'loading'}>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
              <div>
                <h2 id="catalog-title" className="section-title">{selectedTheme?.nama_theme || (selectedCategory === 'Semua' ? 'Katalog lelang' : selectedCategory)}</h2>
                {catalogStatus === 'ready' && <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{filteredAuctions.length} lot{searchQuery.trim() ? ` untuk “${searchQuery.trim()}”` : ' tersedia'}</p>}
              </div>
              {hasFilters && <button type="button" onClick={resetFilters} className="text-link min-h-11 text-sm text-primary">Hapus semua filter</button>}
            </div>
            <div className="flex gap-5 overflow-x-auto border-b border-border" aria-label="Status lelang">
              {STATUSES.map(({ value, label }) => (
                <button key={value} type="button" onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value}
                  className={`min-h-12 shrink-0 border-b-2 py-3 text-sm ${statusFilter === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
              ))}
            </div>
            <div className="my-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_210px]">
              <div>
                <label htmlFor="catalog-search" className="mb-2 block text-xs font-medium">Cari di katalog</label>
                <div className="relative">
                  <Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input id="catalog-search" type="search" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Nama barang, merek, atau kategori" className="catalog-input pl-10 pr-12" />
                  {searchQuery && <button type="button" onClick={() => onSearchChange('')} aria-label="Hapus pencarian katalog" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground"><X className="h-4 w-4" /></button>}
                </div>
              </div>
              <div>
                <label htmlFor="catalog-sort" className="mb-2 block text-xs font-medium">Urutkan</label>
                <select id="catalog-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)} className="catalog-input">
                  <option value="ending_soon">Segera berakhir</option>
                  <option value="highest_bid">Tawaran tertinggi</option>
                  <option value="lowest_bid">Harga buka terendah</option>
                  <option value="most_bids">Tawaran terbanyak</option>
                </select>
              </div>
            </div>
            {selectedTheme && <p className="mb-5 text-sm text-muted-foreground">Tema: {selectedTheme.nama_theme}. <button type="button" onClick={() => setSelectedThemeId(null)} className="text-link min-h-11 text-primary">Hapus filter tema</button></p>}

            {catalogStatus === 'loading' ? (
              <div role="status" className="border-y border-border py-14 text-center text-sm text-muted-foreground">Memuat katalog lelang...</div>
            ) : catalogStatus === 'error' ? (
              <div role="alert" className="border-y border-border bg-muted px-5 py-12 text-center">
                <h3 className="text-lg font-semibold">Katalog belum dapat dimuat</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Koneksi ke layanan lelang terputus. Coba muat kembali untuk melihat lot terbaru.</p>
                <button type="button" onClick={reloadCatalog} className="button-secondary mt-5">Muat ulang katalog</button>
              </div>
            ) : filteredAuctions.length === 0 ? (
              <div className="border-y border-border py-14 text-center">
                <h3 className="text-lg font-semibold">{hasFilters ? 'Belum ada lot yang cocok' : 'Belum ada lot tersedia'}</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{hasFilters ? 'Coba kata kunci lain atau hapus filter untuk melihat seluruh katalog.' : 'Lot akan tampil di sini setelah diterbitkan. Kamu bisa membaca panduan lelang sambil menunggu.'}</p>
                <button type="button" onClick={hasFilters ? resetFilters : () => onNavigate('guide')} className="button-secondary mt-5">{hasFilters ? 'Hapus filter' : 'Baca panduan lelang'}</button>
              </div>
            ) : (
              <div className="lot-grid">{filteredAuctions.map((item) => <AuctionCard key={item.lelang.id_lelang} auction={item} onSelect={onSelectAuction} imageAspectRatio="square" />)}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
