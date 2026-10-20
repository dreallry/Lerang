import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsTasks } from '../src/utils/operations.ts';

test('operations queue includes every active lot and open invoice without silently truncating', () => {
  const auctions = Array.from({ length: 7 }, (_, i) => ({ id_lelang: i + 1, status: 'dibuka', tgl_selesai: '2027-01-01' }));
  const invoices = Array.from({ length: 6 }, (_, i) => ({ id_pembayaran: i + 1, status: 'Belum Dibayar', sisa_tagihan: 100000, batas_pembayaran: '2027-01-01' }));
  const tasks = operationsTasks([], auctions, invoices, [], Date.parse('2026-10-20'));
  assert.equal(tasks.length, 13);
  assert.equal(tasks.filter(task => task.kind === 'payment').length, 6);
  assert.equal(new Set(tasks.map(task => task.id)).size, 13);
});

test('financial review and missed closure take priority; legacy records never become live payment tasks', () => {
  const invoices = [
    { id_pembayaran: 1, status: 'Belum Dibayar', legacy_historical: true, batas_pembayaran: '2020-01-01' },
    { id_pembayaran: 2, status: 'Sudah Dibayar', payment_review_required: true },
    { id_pembayaran: 3, status: 'Belum Dibayar', batas_pembayaran: '2026-10-19' },
    { id_pembayaran: 4, status: 'Sudah Dibayar' },
  ];
  const tasks = operationsTasks([], [{ id_lelang: 1, status: 'dibuka', tgl_selesai: '2026-10-19' }], invoices, [{ id_fulfillment: 'old', legacy_historical: true, status: 'dikirim' }], Date.parse('2026-10-20'));
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks.map(task => task.priority), [0, 0, 1, 3]);
  assert.equal(tasks[0].view, 'admin-auctions');
  assert.match(tasks.at(-1).detail, /tidak ditagih/);
});
