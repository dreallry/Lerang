import React, { useMemo, useState } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatDateIndo } from '../../utils/formatters';
import { AuctionCard } from '../common/AuctionCard';

interface SesiDetailPageProps {
  sesiId: number;
  onBack: () => void;
  onSelectAuction: (lelangId: number) => void;
  onNavigate: (view: string, id?: number) => void;
}

export const SesiDetailPage: React.FC<SesiDetailPageProps> = ({ sesiId, onBack, onSelectAuction }) => {
  const { sesiLelangList, allJoinedAuctions, catalogStatus, reloadCatalog } = useAuction();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Semua');
  const session = sesiLelangList.find((item) => item.id_sesi === sesiId);
  const lots = useMemo(() => allJoinedAuctions.filter(item => item.lelang.status !== 'draft' && item.barang.status_verifikasi === 'approved').filter((item) => item.lelang.id_sesi === sesiId), [allJoinedAuctions, sesiId]);
  const categories = ['Semua', ...new Set(lots.map((item) => item.barang.kategori))];
  const filtered = lots.filter(({ barang }) => (category === 'Semua' || barang.kategori === category)
    && `${barang.nama_barang} ${barang.deskripsi_barang} ${barang.kategori}`.toLowerCase().includes(query.trim().toLowerCase()));

  if (!session) return (
    <div className="py-16 text-center" role="status">
      <h1 className="section-title">{catalogStatus === 'loading' ? 'Memuat sesi lelang...' : catalogStatus === 'error' ? 'Sesi belum dapat dimuat' : 'Sesi tidak ditemukan'}</h1>
      {catalogStatus !== 'loading' && <button type="button" onClick={catalogStatus === 'error' ? reloadCatalog : onBack} className="button-secondary mt-6">{catalogStatus === 'error' ? 'Muat ulang' : 'Kembali ke katalog'}</button>}
    </div>
  );

  return (
    <article className="space-y-9">
      <button type="button" onClick={onBack} className="text-link min-h-11 text-sm text-muted-foreground">Kembali ke katalog</button>
      <header className={`grid gap-8 border-b border-border pb-9 ${session.gambar_banner ? 'md:grid-cols-2 md:items-center' : ''}`}>
        <div>
          <p className="mb-3 text-sm text-primary">{session.status === 'live' ? 'Sedang berlangsung' : session.status === 'upcoming' ? 'Sesi mendatang' : 'Sesi selesai'}</p>
          <h1 className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">{session.judul}</h1>
          <p className="mt-5 max-w-xl whitespace-pre-line text-sm leading-7 text-muted-foreground">{session.deskripsi}</p>
          <dl className="mt-6 grid grid-cols-2 gap-5 text-sm">
            <div><dt className="text-muted-foreground">Mulai</dt><dd className="mt-1 font-medium">{formatDateIndo(session.tgl_mulai)}</dd></div>
            <div><dt className="text-muted-foreground">Jumlah lot</dt><dd className="mt-1 font-medium">{lots.length} lot</dd></div>
            {session.kurator && <div className="col-span-2"><dt className="text-muted-foreground">Penyelenggara</dt><dd className="mt-1 font-medium">{session.kurator}</dd></div>}
          </dl>
        </div>
        {session.gambar_banner && <img src={session.gambar_banner} alt={session.judul} className="aspect-[16/10] w-full bg-muted object-cover" />}
      </header>
      <section aria-labelledby="session-lots-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><h2 id="session-lots-title" className="section-title">Lot dalam sesi ini</h2><p aria-live="polite" className="mt-2 text-sm text-muted-foreground">{filtered.length} lot ditampilkan</p></div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <div><label htmlFor="session-search" className="mb-2 block text-xs font-medium">Cari lot</label><input id="session-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nama atau deskripsi barang" className="catalog-input" /></div>
            <div><label htmlFor="session-category" className="mb-2 block text-xs font-medium">Kategori</label><select id="session-category" value={category} onChange={(event) => setCategory(event.target.value)} className="catalog-input">{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
          </div>
        </div>
        {filtered.length ? <div className="lot-grid">{filtered.map((auction) => <AuctionCard key={auction.lelang.id_lelang} auction={auction} onSelect={onSelectAuction} />)}</div> : (
          <div className="border-y border-border py-14 text-center"><h3 className="text-lg font-medium">Belum ada lot yang sesuai</h3><p className="mt-2 text-sm text-muted-foreground">{lots.length ? 'Coba kata kunci atau kategori lain.' : 'Lot untuk sesi ini belum diterbitkan.'}</p>{lots.length > 0 && <button type="button" onClick={() => { setQuery(''); setCategory('Semua'); }} className="button-secondary mt-5">Hapus filter</button>}</div>
        )}
      </section>
    </article>
  );
};
