import { rangePreset, validRange, type DateRange } from '../../utils/reporting';

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  return <section className="space-y-4 border-y border-border py-5" aria-label="Rentang tanggal laporan">
    <div className="flex flex-wrap items-end gap-4">
      <label className="grid gap-2 text-sm">Dari tanggal<input type="date" min="1970-01-01" max="2100-12-31" value={value.from} onChange={event => onChange({ ...value, from: event.target.value })} className="catalog-input" /></label>
      <label className="grid gap-2 text-sm">Sampai tanggal<input type="date" min="1970-01-01" max="2100-12-31" value={value.to} onChange={event => onChange({ ...value, to: event.target.value })} className="catalog-input" /></label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan rentang cepat">{[7, 30, 90].map(days => <button type="button" key={days} className="button-secondary" onClick={() => onChange(rangePreset(days))}>{days} hari</button>)}<button type="button" className="button-secondary" onClick={() => onChange({ from: '', to: '' })}>Semua waktu</button></div>
    </div>
    <p className="text-sm text-muted-foreground">Tanggal awal dan akhir termasuk dalam rentang. Zona waktu WIB (UTC+7).</p>
    {!validRange(value) && <p role="alert" className="text-sm text-destructive">Tanggal akhir harus sama atau setelah tanggal awal. Gunakan tahun 1970–2100.</p>}
  </section>;
}
