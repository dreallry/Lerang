// Utility formatters for Rupiah, Date/Time, Countdown, and ID generation

export function toDateTimeLocal(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function formatRupiah(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export function formatCompactRupiah(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)} M`;
  }
  if (amount >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(1)} Jt`;
  }
  if (amount >= 1_000) {
    return `Rp ${(amount / 1_000).toFixed(0)} Rb`;
  }
  return formatRupiah(amount);
}

export function formatDateIndo(dateStr: string | Date | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDateOnly(dateStr: string | Date | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isExpired: boolean;
  isUpcoming: boolean;
}

export function calculateTimeLeft(startDateStr: string, endDateStr: string): TimeLeft {
  const now = Date.now();
  const start = new Date(startDateStr).getTime();
  const end = new Date(endDateStr).getTime();

  if (now < start) {
    const diff = start - now;
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / 1000 / 60) % 60),
      seconds: Math.floor((diff / 1000) % 60),
      totalMs: diff,
      isExpired: false,
      isUpcoming: true,
    };
  }

  const diff = end - now;
  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      isExpired: true,
      isUpcoming: false,
    };
  }

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / 1000 / 60) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    totalMs: diff,
    isExpired: false,
    isUpcoming: false,
  };
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Tiered Buyer's Premium (Premi Pembeli)
 * < Rp 10 Juta: 10%
 * Rp 10 Juta - Rp 100 Juta: 8%
 * > Rp 100 Juta: 5%
 */
export function calculateBuyersPremium(amount: number): { percent: number; premium: number; total: number } {
  if (!amount || amount <= 0) {
    return { percent: 0, premium: 0, total: 0 };
  }
  let percent = 8;
  if (amount < 10_000_000) {
    percent = 10;
  } else if (amount > 100_000_000) {
    percent = 5;
  }
  const premium = Math.round((amount * percent) / 100);
  return {
    percent,
    premium,
    total: amount + premium,
  };
}

/**
 * Dynamic minimum increment based on current price
 */
export function getDynamicIncrement(currentPrice: number): number {
  if (currentPrice < 1_000_000) return 50_000;
  if (currentPrice < 10_000_000) return 100_000;
  if (currentPrice < 50_000_000) return 500_000;
  if (currentPrice < 200_000_000) return 1_000_000;
  return 5_000_000;
}
