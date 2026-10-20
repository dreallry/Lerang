import React, { useState, useEffect } from 'react';
import { calculateTimeLeft, TimeLeft } from '../../utils/formatters';
import { AuctionStatus } from '../../types';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  startDate: string;
  endDate: string;
  status: AuctionStatus;
  onExpire?: () => void;
  compact?: boolean;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  startDate,
  endDate,
  status,
  onExpire,
  compact = false,
}) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculateTimeLeft(startDate, endDate));

  useEffect(() => {
    if (status === 'ditutup' || status === 'dibatalkan') return;

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft(startDate, endDate);
      setTimeLeft(remaining);

      if (remaining.isExpired && onExpire) {
        onExpire();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startDate, endDate, status, onExpire]);

  if (status === 'ditutup') {
    return (
      <span className="text-xs text-muted-foreground font-medium">
        Lelang Selesai
      </span>
    );
  }

  if (status === 'dibatalkan') {
    return (
      <span className="text-xs text-destructive font-medium">
        Dibatalkan
      </span>
    );
  }

  if (timeLeft.isUpcoming) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        <Clock className="w-3.5 h-3.5" />
        <span>
          Mulai: {timeLeft.days > 0 ? `${timeLeft.days} hari ` : ''}
          {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:
          {String(timeLeft.seconds).padStart(2, '0')}
        </span>
      </div>
    );
  }

  if (timeLeft.isExpired) {
    return (
      <span className="text-xs text-muted-foreground font-medium">
        Waktu Habis
      </span>
    );
  }

  const isCritical = timeLeft.totalMs < 15 * 60 * 1000;

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs font-mono font-medium ${
          isCritical ? 'text-destructive font-bold' : 'text-foreground'
        }`}
      >
        <Clock className="w-3.5 h-3.5 opacity-70" />
        <span>
          {timeLeft.days > 0 ? `${timeLeft.days} hari ` : ''}
          {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:
          {String(timeLeft.seconds).padStart(2, '0')}
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="flex items-center gap-1.5 font-medium">
          <Clock className="w-3.5 h-3.5" /> Sisa Waktu Penawaran
        </span>
        {isCritical && (
          <span className="text-destructive font-semibold">Segera Berakhir</span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xl sm:text-2xl font-semibold tabular-nums text-foreground">
        <div>
          {String(timeLeft.days).padStart(2, '0')}
          <span className="text-[10px] font-sans font-normal text-muted-foreground block">hari</span>
        </div>
        <span className="text-muted-foreground opacity-40 -mt-3">:</span>
        <div>
          {String(timeLeft.hours).padStart(2, '0')}
          <span className="text-[10px] font-sans font-normal text-muted-foreground block">jam</span>
        </div>
        <span className="text-muted-foreground opacity-40 -mt-3">:</span>
        <div>
          {String(timeLeft.minutes).padStart(2, '0')}
          <span className="text-[10px] font-sans font-normal text-muted-foreground block">menit</span>
        </div>
        <span className="text-muted-foreground opacity-40 -mt-3">:</span>
        <div className={isCritical ? 'text-destructive' : ''}>
          {String(timeLeft.seconds).padStart(2, '0')}
          <span className="text-[10px] font-sans font-normal text-muted-foreground block">detik</span>
        </div>
      </div>
    </div>
  );
};
