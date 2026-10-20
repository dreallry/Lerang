import React, { useState } from 'react';
import { Heart } from 'lucide-react';
import { AuctionDetailItem } from '../../types';
import { formatRupiah, calculateTimeLeft } from '../../utils/formatters';

interface AuctionCardProps {
  auction: AuctionDetailItem;
  onSelect: (id: number) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: number) => void;
  className?: string;
  imageAspectRatio?: 'square' | 'portrait';
}

export function formatTimeSummary(startDateStr: string, endDateStr: string, status: string): string {
  if (status === 'ditutup') return 'Lelang selesai';
  if (status === 'dibatalkan') return 'Dibatalkan';
  const time = calculateTimeLeft(startDateStr, endDateStr);
  if (time.isExpired) return 'Waktu lelang berakhir';
  if (time.isUpcoming || status === 'terjadwal') {
    if (time.days > 0) return `Mulai ${time.days} hari lagi`;
    if (time.hours > 0) return `Mulai ${time.hours} jam lagi`;
    return 'Segera dimulai';
  }
  if (time.days > 0) return `${time.days} hari lagi`;
  if (time.hours > 0) return `${time.hours} jam ${time.minutes} menit`;
  if (time.minutes > 0) return `${time.minutes} menit lagi`;
  return 'Segera berakhir';
}

export const AuctionCard: React.FC<AuctionCardProps> = ({
  auction, onSelect, isFavorite: externalIsFavorite, onToggleFavorite, className = '', imageAspectRatio = 'square',
}) => {
  const { lelang, barang, totalBids } = auction;
  const [imageFailed, setImageFailed] = useState(false);
  const [localFavorite, setLocalFavorite] = useState(() => {
    try { return localStorage.getItem(`fav_${lelang.id_lelang}`) === 'true'; }
    catch { return false; }
  });
  const isFavorite = externalIsFavorite ?? localFavorite;
  const toggleFavorite = () => {
    if (onToggleFavorite) return onToggleFavorite(lelang.id_lelang);
    const next = !localFavorite;
    setLocalFavorite(next);
    try { localStorage.setItem(`fav_${lelang.id_lelang}`, String(next)); }
    catch { /* Favorites remain available for the current visit when storage is disabled. */ }
  };
  const photo = barang.foto_barang?.[0];
  const closingSoon = lelang.status === 'dibuka' && Date.parse(lelang.tgl_selesai) > Date.now()
    && Date.parse(lelang.tgl_selesai) - Date.now() < 3600000;

  return (
    <article className={`group relative min-w-0 ${className}`}>
      <div className={`relative flex w-full items-center justify-center overflow-hidden bg-muted ${imageAspectRatio === 'portrait' ? 'aspect-[4/5]' : 'aspect-square'}`}>
        {photo && !imageFailed ? (
          <img src={photo} alt={barang.nama_barang} loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-contain p-3 transition-transform duration-200 group-hover:scale-[1.025]" />
        ) : <span className="p-5 text-center text-xs text-muted-foreground">Foto belum tersedia</span>}
        {lelang.is_extended && <span className="absolute bottom-2 left-2 bg-white px-2 py-1 text-xs text-primary">Waktu tambahan</span>}
        <button type="button" onClick={toggleFavorite} aria-pressed={isFavorite}
          aria-label={`${isFavorite ? 'Hapus dari' : 'Simpan ke'} favorit: ${barang.nama_barang}`}
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-foreground hover:text-primary">
          <Heart aria-hidden="true" className={`h-[18px] w-[18px] ${isFavorite ? 'fill-primary text-primary' : ''}`} strokeWidth={1.75} />
        </button>
      </div>
      <div className="pt-3">
        <p className="mb-1 text-xs text-muted-foreground">Lot {lelang.id_lelang} · {barang.kategori}</p>
        <h3 className="min-h-[2.75rem] text-sm font-medium leading-[1.4]">
          <button type="button" onClick={() => onSelect(lelang.id_lelang)} className="text-left after:absolute after:inset-0 after:rounded-sm hover:underline focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-primary">
            <span className="line-clamp-2">{barang.nama_barang}</span>
          </button>
        </h3>
        <p className="mt-2 text-base font-semibold tabular-nums">{formatRupiah(totalBids > 0 ? lelang.harga_akhir : barang.harga_awal)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{totalBids > 0 ? `${totalBids} tawaran` : 'Harga pembukaan'}</p>
        <p className={`mt-2 text-xs ${closingSoon ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
          {formatTimeSummary(lelang.tgl_mulai, lelang.tgl_selesai, lelang.status)}
        </p>
      </div>
    </article>
  );
};
