import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuctionDetailItem } from '@/types';
import { AuctionCard } from '@/components/common/AuctionCard';

export type RecommendationTab = 'trending' | 'ending_soon' | 'new' | 'no_bids';

export interface CuratedRecommendationsProps {
  auctions: AuctionDetailItem[];
  onSelectAuction: (id: number) => void;
  title?: string;
  subtitle?: string;
  className?: string;
}

export const CuratedRecommendationsCarousel = React.forwardRef<HTMLDivElement, CuratedRecommendationsProps>(({
  auctions,
  onSelectAuction,
  title = 'Sedang dilelang',
  className,
}, ref) => {
  const [activeTab, setActiveTab] = React.useState<RecommendationTab>('ending_soon');
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const headingId = React.useId();
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const activeAuctions = React.useMemo(() => {
    const now = Date.now();
    return auctions.filter(({ lelang }) => (
      lelang.status === 'dibuka'
      && new Date(lelang.tgl_mulai).getTime() <= now
      && new Date(lelang.tgl_selesai).getTime() > now
    ));
  }, [auctions]);

  const groups = React.useMemo(() => ({
    ending_soon: [...activeAuctions].sort((a, b) => Date.parse(a.lelang.tgl_selesai) - Date.parse(b.lelang.tgl_selesai)),
    trending: activeAuctions.filter((item) => item.totalBids > 0).sort((a, b) => b.totalBids - a.totalBids),
    new: [...activeAuctions].sort((a, b) => Date.parse(b.lelang.tgl_mulai) - Date.parse(a.lelang.tgl_mulai)),
    no_bids: activeAuctions.filter((item) => item.totalBids === 0),
  }), [activeAuctions]);
  const displayedAuctions = groups[activeTab];

  const checkScrollability = React.useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    el.scrollLeft = 0;
    checkScrollability();
    const observer = new ResizeObserver(checkScrollability);
    observer.observe(el);
    el.addEventListener('scroll', checkScrollability, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', checkScrollability);
    };
  }, [activeTab, displayedAuctions, checkScrollability]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({
      left: el.clientWidth * (direction === 'left' ? -0.85 : 0.85),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  if (activeAuctions.length === 0) return null;

  const tabs: { key: RecommendationTab; label: string }[] = [
    { key: 'ending_soon', label: 'Segera berakhir' },
    { key: 'trending', label: 'Paling banyak ditawar' },
    { key: 'new', label: 'Baru dimulai' },
    { key: 'no_bids', label: 'Belum ditawar' },
  ];

  return (
    <section ref={ref} className={cn('w-full', className)} aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
        <h2 id={headingId} className="section-title">{title}</h2>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => scroll('left')} disabled={!canScrollLeft} aria-label="Lot sebelumnya" className="button-secondary flex h-11 w-11 items-center justify-center p-0 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => scroll('right')} disabled={!canScrollRight} aria-label="Lot berikutnya" className="button-secondary flex h-11 w-11 items-center justify-center p-0 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-6 overflow-x-auto border-b border-border" role="group" aria-label="Urutan lot">
        {tabs.map(({ key, label }) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} aria-pressed={activeTab === key} className={cn(
            'min-h-12 shrink-0 border-b-2 py-3 text-sm transition-colors',
            activeTab === key ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}>
            {label}<span className="ml-2 text-xs tabular-nums text-muted-foreground">{groups[key].length}</span>
          </button>
        ))}
      </div>

      {displayedAuctions.length > 0 ? (
        <div ref={scrollContainerRef} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 sm:gap-6" aria-label="Daftar rekomendasi lot">
          {displayedAuctions.map((item) => (
            <div key={item.lelang.id_lelang} className="w-[min(72vw,250px)] shrink-0 snap-start sm:w-[255px] lg:w-[calc((100%_-_72px)/4)]">
              <AuctionCard auction={item} onSelect={onSelectAuction} imageAspectRatio="square" />
            </div>
          ))}
        </div>
      ) : (
        <p className="border-b border-border py-12 text-sm text-muted-foreground" role="status">Belum ada lot untuk pilihan ini. Pilih urutan lain untuk melihat lelang yang sedang dibuka.</p>
      )}

      <div className="mt-4 flex justify-end">
        <button type="button" className="text-link min-h-11" onClick={() => document.getElementById('catalog-content')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>Lihat semua lot</button>
      </div>
    </section>
  );
});

CuratedRecommendationsCarousel.displayName = 'CuratedRecommendationsCarousel';

export const AuctionEndingSoonCarousel = CuratedRecommendationsCarousel;
export type AuctionEndingSoonCarouselProps = CuratedRecommendationsProps;
