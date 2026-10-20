import React, { useEffect, useRef } from 'react';

interface ParallaxComponentProps {
  title?: string;
  subtitle?: string;
  onExplore?: () => void;
  onSelectCategory?: (category: string) => void;
  onNavigate?: (view: string, id?: number) => void;
}

export function ParallaxComponent({
  title = 'Koleksi dan barang lelang',
  subtitle = 'Lihat barang, baca kondisinya, lalu ikuti penawaran. Temukan lot dan jadwalnya di katalog.',
  onExplore,
  onNavigate,
}: ParallaxComponentProps) {
  const heroRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!heroRef.current || !imageRef.current) return;
        const top = heroRef.current.getBoundingClientRect().top;
        const offset = motion.matches ? 0 : Math.max(-24, Math.min(24, -top * 0.07));
        imageRef.current.style.transform = `translateY(${offset}px)`;
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    motion.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      motion.removeEventListener('change', update);
    };
  }, []);

  return (
    <section ref={heroRef} className="grid overflow-hidden bg-[#eeeae1] md:grid-cols-[0.9fr_1.1fr]" aria-label="Jelajahi lelang Lerang">
      <div className="flex flex-col items-start justify-center px-6 py-8 sm:p-8 lg:py-10">
        <p className="mb-5 text-sm font-medium text-primary">Lelang online di Lerang</p>
        <h1 className="max-w-lg font-serif text-[2.6rem] font-medium leading-[1.08] tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">{subtitle}</p>
        <button type="button" onClick={onExplore} className="button-primary mt-7">Lihat katalog lelang</button>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate('c2c-submit')} className="text-link mt-4 min-h-11 text-sm text-primary">
            Ingin menjual barang? Titip di Lerang
          </button>
        )}
      </div>
      <figure className="relative min-h-[240px] overflow-hidden md:min-h-[420px]">
        <img ref={imageRef} src="/auction-hero.jpg" alt="Foto ilustrasi suasana lelang" className="absolute -top-6 h-[calc(100%+48px)] w-full object-cover" loading="eager" />
        <figcaption className="absolute bottom-4 right-4 bg-white px-3 py-2 text-xs text-foreground">Ilustrasi ruang lelang</figcaption>
      </figure>
    </section>
  );
}

export default ParallaxComponent;
