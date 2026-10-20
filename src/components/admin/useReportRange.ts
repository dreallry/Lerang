import { useState } from 'react';
import { rangePreset, validRange, type DateRange } from '../../utils/reporting';

export function useReportRange() {
  const [range, setRange] = useState<DateRange>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('lerang_admin_period') || 'null');
      if (stored && typeof stored.from === 'string' && typeof stored.to === 'string' && validRange(stored)) return stored;
    } catch { /* A browser storage failure must not prevent opening reports. */ }
    return rangePreset(30);
  });
  return [range, (next: DateRange) => {
    setRange(next);
    if (validRange(next)) try { sessionStorage.setItem('lerang_admin_period', JSON.stringify(next)); } catch { /* The active page still retains its selected range. */ }
  }] as const;
}
