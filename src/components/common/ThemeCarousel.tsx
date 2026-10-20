import React, { useRef, useState, useCallback, useEffect, useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TbTheme } from '../../types';

interface ThemeCarouselProps {
  themes: TbTheme[];
  selectedThemeId?: number | null;
  onSelectTheme: (themeId: number | null) => void;
  onShowAll?: () => void;
}

export const ThemeCarousel: React.FC<ThemeCarouselProps> = ({ themes, selectedThemeId, onSelectTheme, onShowAll }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollability = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScrollability();
    const observer = new ResizeObserver(checkScrollability);
    observer.observe(el);
    el.addEventListener('scroll', checkScrollability, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', checkScrollability);
    };
  }, [themes, checkScrollability]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: Math.min(el.clientWidth * 0.85, 420) * (direction === 'left' ? -1 : 1),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  if (themes.length === 0) return null;

  return (
    <section className="w-full" aria-labelledby={headingId}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <h2 id={headingId} className="section-title">Koleksi tematik</h2>
        <div className="flex items-center gap-2">
          {onShowAll && selectedThemeId != null && <button type="button" onClick={onShowAll} className="text-link mr-3 min-h-11">Hapus pilihan tema</button>}
          <button type="button" onClick={() => scroll('left')} disabled={!canScrollLeft} aria-label="Koleksi sebelumnya" className="button-secondary flex h-11 w-11 items-center justify-center p-0 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => scroll('right')} disabled={!canScrollRight} aria-label="Koleksi berikutnya" className="button-secondary flex h-11 w-11 items-center justify-center p-0 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 sm:gap-7">
        {themes.map((theme) => {
          const isSelected = selectedThemeId === theme.id_theme;
          return (
            <button key={theme.id_theme} type="button" onClick={() => onSelectTheme(isSelected ? null : theme.id_theme)} aria-pressed={isSelected} className="group w-[min(78vw,350px)] shrink-0 snap-start text-left sm:w-[320px] lg:w-[calc((100%_-_56px)/3)]">
              <div className="aspect-[4/3] overflow-hidden bg-secondary">
                <img src={theme.gambar_cover} alt="" className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]" loading="lazy" />
              </div>
              <div className="pt-4">
                <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{theme.id_lelang_list.length} lot</span>
                  {theme.subjudul_jadwal && <span>{theme.subjudul_jadwal}</span>}
                </p>
                <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary">{theme.nama_theme}</h3>
                {theme.nama_kurator && <p className="mt-1 text-sm text-muted-foreground">{theme.nama_kurator}</p>}
                {isSelected && <p className="mt-2 text-xs font-semibold text-primary">Tema dipilih</p>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
