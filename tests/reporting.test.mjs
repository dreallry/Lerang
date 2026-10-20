import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, validRange, inDateRange, rangePreset, invoiceDate, verifiedPayments, paymentSeries } from '../src/utils/reporting.ts';

test('date ranges use inclusive WIB days across UTC midnight, months, leap dates and invalid input', () => {
  const range = { from: '2026-10-20', to: '2026-10-20' };
  assert.equal(dateKey('2026-10-19T17:00:00Z'), '2026-10-20');
  assert.equal(dateKey('2026-10-20 23:59:59'), '2026-10-20');
  assert.equal(inDateRange('2026-10-19T16:59:59Z', range), false);
  assert.equal(inDateRange('2026-10-20T16:59:59Z', range), true);
  assert.equal(inDateRange('2026-10-20T17:00:00Z', range), false);
  assert.equal(validRange({ from: '2026-10-21', to: '2026-10-20' }), false);
  for (const value of ['garbage', '2026-02-30', '2026-13-01', '2026-02-30T12:00:00Z']) assert.equal(dateKey(value), null);
  assert.equal(dateKey('2024-02-29'), '2024-02-29');
  assert.deepEqual(rangePreset(7, new Date('2026-03-01T01:00:00Z')), { from: '2026-02-23', to: '2026-03-01' });
});

test('verified totals exclude archives, review cases, unpaid and undated records even for all time', () => {
  const base = { status: 'Sudah Dibayar', tgl_pembayaran: '2026-10-20T03:00:00Z', jumlah_pembayaran: 100000 };
  const records = [base, { ...base, legacy_historical: true }, { ...base, payment_review_required: true }, { ...base, status: 'Belum Dibayar' }, { ...base, tgl_pembayaran: '' }];
  assert.deepEqual(verifiedPayments(records, { from: '', to: '' }), [base]);
  assert.equal(invoiceDate({ ...base, status: 'Belum Dibayar', created_at: '2026-10-19' }), '2026-10-19');
  assert.equal(inDateRange(undefined, { from: '', to: '' }), true);
  assert.equal(inDateRange(undefined, { from: '2026-10-20', to: '' }), false);
});

test('WIB grouping is independent of the browser or operating system timezone', () => {
  const before=process.env.TZ;
  try { for(const zone of ['UTC','Asia/Jakarta','America/Los_Angeles']) {
    process.env.TZ=zone;
    assert.equal(dateKey('2026-03-01 00:15:00'),'2026-03-01');
    assert.equal(dateKey('2026-02-28T17:15:00Z'),'2026-03-01');
  }} finally {if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('chart bins fill missing dates and preserve exact daily and monthly totals', () => {
  const records = [{ tgl_pembayaran: '2026-10-19T17:00:00Z', jumlah_pembayaran: 100000 }, { tgl_pembayaran: '2026-10-20T16:00:00Z', jumlah_pembayaran: 250000 }, { tgl_pembayaran: '2026-10-21T18:00:00Z', jumlah_pembayaran: 500000 }];
  const daily = paymentSeries(records, { from: '2026-10-20', to: '2026-10-22' });
  assert.deepEqual(daily.map(row => row.amount), [350000, 0, 500000]);
  assert.deepEqual(daily.map(row => row.count), [2, 0, 1]);
  const monthly = paymentSeries(records, { from: '2026-08-01', to: '2026-11-01' });
  assert.deepEqual(monthly.map(row => row.amount), [0, 0, 850000, 0]);
  assert.deepEqual(paymentSeries(records, { from: '2026-10-21', to: '2026-10-20' }), []);
});
