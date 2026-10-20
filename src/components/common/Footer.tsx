import React from 'react';
import { useAuction } from '../../context/AuctionContext';

interface FooterProps {
  onNavigate?: (view: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { currentRole, currentUser } = useAuction();
  const isPublic = currentRole === 'masyarakat';
  const links = isPublic
    ? [
        ['catalog', 'Jelajahi katalog'],
        ['guide', 'Panduan lelang'],
        ['c2c-submit', 'Jual di Lerang'],
        ...(currentUser
          ? [['journey', 'Aktivitas saya'], ['invoices', 'Tagihan'], ['fulfillment', 'Pengiriman']]
          : [['register', 'Buat akun'], ['login', 'Masuk']]),
      ]
    : [['admin-dashboard', 'Ringkasan'], ['admin-auctions', 'Kelola lot'], ['admin-sessions', 'Sesi lelang'], ['admin-reports', 'Laporan']];

  return (
    <footer className="mt-auto border-t border-border bg-muted/40 text-foreground">
      <div className="site-container py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between sm:gap-12">
          <div className="max-w-sm">
            <a href="#catalog" onClick={(event) => { if (onNavigate) { event.preventDefault(); onNavigate('catalog'); } }} className="inline-flex min-h-11 items-center font-serif text-4xl font-semibold leading-none tracking-[-0.045em] text-primary" aria-label="Beranda Lerang">lerang<span className="text-foreground">.</span></a>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Jelajahi barang lelang, ikuti penawaran, dan kelola koleksi Anda.</p>
          </div>
          <nav aria-label="Navigasi footer" className="grid grid-cols-2 gap-x-8 gap-y-0 sm:gap-x-12">
            {links.map(([view, label]) => (
              <a key={view} href={`#${view}`} onClick={(event) => { if (onNavigate) { event.preventDefault(); onNavigate(view); } }} className="flex min-h-11 items-center py-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{label}</a>
            ))}
          </nav>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Lerang</p>
          <p>Bahasa Indonesia <span className="mx-2" aria-hidden="true">/</span> Rupiah (IDR)</p>
        </div>
      </div>
    </footer>
  );
};
