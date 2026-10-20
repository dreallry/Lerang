import React, { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAuction } from '../../context/AuctionContext';
import { formatDateIndo } from '../../utils/formatters';

interface UpcomingSessionBannerProps {
  onSelectSession: (sesiId: number) => void;
}

export const UpcomingSessionBanner: React.FC<UpcomingSessionBannerProps> = ({ onSelectSession }) => {
  const { sesiLelangList, lelangList } = useAuction();
  const headingId = useId();
  const activeSessions = sesiLelangList
    .filter((session) => session.status === 'live' || session.status === 'upcoming')
    .sort((a, b) => Date.parse(a.tgl_mulai) - Date.parse(b.tgl_mulai));

  if (activeSessions.length === 0) return null;

  const typeLabels: Record<string, string> = { reguler: 'Reguler', tematik: 'Tematik', flash: 'Lelang kilat' };

  return (
    <section className="w-full" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <h2 id={headingId} className="section-title">Jadwal lelang</h2>
        <span className="text-sm text-muted-foreground">{activeSessions.length} sesi</span>
      </div>
      <div className="divide-y divide-border">
        {activeSessions.map((session) => {
          const isLive = session.status === 'live';
          const lotCount = lelangList.filter((auction) => auction.id_sesi === session.id_sesi).length;
          return (
            <button key={session.id_sesi} type="button" onClick={() => onSelectSession(session.id_sesi)} className="group grid w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-4 py-6 text-left sm:grid-cols-[108px_minmax(0,1fr)_auto_24px] sm:gap-6" aria-label={`${isLive ? 'Masuk ke' : 'Lihat'} sesi ${session.judul}`}>
              {session.gambar_banner ? <img src={session.gambar_banner} alt="" className="hidden aspect-[4/3] w-full object-cover sm:block" loading="lazy" /> : <div className="hidden aspect-[4/3] bg-secondary sm:flex sm:items-center sm:justify-center"><span className="text-sm font-semibold text-primary">Lerang</span></div>}
              <div className="min-w-0">
                <p className="mb-2 text-xs text-muted-foreground">{typeLabels[session.tipe] || 'Sesi lelang'}</p>
                <h3 className="text-base font-semibold leading-snug text-foreground group-hover:text-primary sm:text-lg">{session.judul}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{formatDateIndo(session.tgl_mulai)}<span className="mx-2" aria-hidden="true">·</span>{lotCount} lot</p>
                <p className="mt-3 text-xs font-semibold text-primary sm:hidden">{isLive ? 'Sedang berlangsung' : 'Akan datang'}</p>
              </div>
              <span className="hidden text-sm font-medium text-primary sm:block">{isLive ? 'Sedang berlangsung' : 'Akan datang'}</span>
              <ChevronRight className="h-5 w-5 text-primary" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
};
