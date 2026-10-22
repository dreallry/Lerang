import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBarang, normalizeLelang, normalizeHistory, mergeBarang, documentLinkError, itemRevision, joinAuctions } from '../src/utils/catalogData.ts';

test('the RTDB joined auction response retains IDs, status, times and zero deposit', () => {
  const auction = normalizeLelang({ lelang: { id_lelang: '4', id_barang: '8', id_user: '2', status: 'dibuka', uang_jaminan: 0, harga_akhir: '150000', kelipatan_minimal: '50000', tgl_mulai: '2026-10-19T10:00:00Z', tgl_selesai: '2026-10-20T10:00:00Z' }, barang: {id_barang:8} });
  assert.equal(auction.id_lelang, 4);
  assert.equal(auction.id_barang, 8);
  assert.equal(auction.id_user, 2);
  assert.equal(auction.status, 'dibuka');
  assert.equal(auction.uang_jaminan, 0);
  assert.equal(auction.harga_akhir, 150000);
  assert.equal(auction.id_sesi, undefined);
  assert.equal(auction.id_petugas, 0);
  assert.equal(auction.tgl_mulai, '2026-10-19T10:00:00Z');
});

test('history from Firebase push keys joins the correct item without losing its key', () => {
  const auction = normalizeLelang({id_lelang:4, id_barang:8});
  const bid = normalizeHistory({id_history:'17200000_2', id_lelang:'4', id_user:'2', penawaran_harga:'200000'}, [auction]);
  assert.equal(bid.id_barang, 8);
  assert.equal(bid.id_history, '17200000_2');
  assert.equal(bid.penawaran_harga, 200000);
});

test('refreshing approved catalog items does not erase pending submissions or duplicate IDs', () => {
  const pending = normalizeBarang({id_barang:9, harga_awal:100000, status_verifikasi:'pending', foto_barang:null});
  const approved = normalizeBarang({id_barang:'8', harga_awal:'100000', status_verifikasi:'approved'});
  const result = mergeBarang([pending, approved], [{...approved, harga_awal:200000}]);
  assert.equal(result.length, 2);
  assert.equal(result.find(item => item.id_barang === 9).status_verifikasi, 'pending');
  assert.equal(result.find(item => item.id_barang === 8).harga_awal, 200000);
  assert.deepEqual(pending.foto_barang, []);
});

test('malformed API records cannot become clickable lots with invalid IDs or prices', () => {
  assert.throws(() => normalizeLelang({lelang:{id_barang:8}}));
  assert.throws(() => normalizeBarang({id_barang:8, harga_awal:'broken'}));
  assert.throws(() => normalizeHistory({id_lelang:4, id_user:2, penawaran_harga:100}, []));
});

test('document input rejects labels before they can fail the whole submission', () => {
  for (const value of ['STNK, BPKB Asli', '', 'javascript:alert(1)', '/api/photos/fixture.jpg', 'https://user:password@example.com/doc.pdf']) assert.ok(documentLinkError(value, []));
  assert.equal(documentLinkError('https://example.com/doc.pdf', []), '');
  assert.match(documentLinkError('https://example.com/doc.pdf', ['https://example.com/doc.pdf']), /sudah/);
  assert.match(documentLinkError('https://example.com/doc.pdf', Array(12).fill('fixture')), /12/);
});

test('item revision retains exact server precision and supports dated legacy items', () => {
  const current = '2026-10-20T10:00:00.123456789Z';
  assert.equal(itemRevision({ updated_at: current, created_at: 'older', tanggal: 'oldest' }), current);
  assert.equal(itemRevision({ created_at: 'older', tanggal: 'oldest' }), 'older');
  assert.equal(itemRevision({ tanggal: 'oldest' }), 'oldest');
  assert.equal(itemRevision({ tanggal: '' }), '');
});

test('catalog joins group bid history, retain auction order and leave server arrays unchanged', () => {
  const items = [normalizeBarang({ id_barang: 8, id_user: 5 }), normalizeBarang({ id_barang: 9 })];
  const auctions = [normalizeLelang({ id_lelang: 2, id_barang: 9 }), normalizeLelang({ id_lelang: 1, id_barang: 8, id_user: 7, id_petugas: 3 }), normalizeLelang({ id_lelang: 3, id_barang: 99 })];
  const bids = Object.freeze([
    Object.freeze(normalizeHistory({ id_history: 'low', id_lelang: 1, id_barang: 8, id_user: 7, nama_user: 'Peserta 7', penawaran_harga: 100 }, auctions)),
    Object.freeze(normalizeHistory({ id_history: 'other', id_lelang: 2, id_barang: 9, id_user: 8, nama_user: 'Peserta 8', penawaran_harga: 900 }, auctions)),
    Object.freeze(normalizeHistory({ id_history: 'high', id_lelang: 1, id_barang: 8, id_user: 7, nama_user: 'Peserta 7', penawaran_harga: 200 }, auctions)),
  ]);
  const seller = Object.freeze({ id_user: 5, nama_lengkap: 'Penjual' });
  const officer = Object.freeze({ id_petugas: 3, nama_petugas: 'Petugas' });
  const joined = joinAuctions(auctions, items, bids, [seller], [officer]);

  assert.deepEqual(joined.map(item => item.lelang.id_lelang), [2, 1]);
  assert.deepEqual(joined[1].history.map(bid => bid.id_history), ['high', 'low']);
  assert.equal(joined[1].totalBids, 2);
  assert.equal(joined[1].penjual, seller);
  assert.equal(joined[1].petugas, officer);
  assert.deepEqual(joined[1].penawarTertinggi, { id_user: 7, nama_lengkap: 'Peserta 7' });
  assert.deepEqual(bids.map(bid => bid.id_history), ['low', 'other', 'high']);
  assert.notEqual(joined[1].history, bids);
});

test('catalog joins refresh winner identities and do not invent participant profiles', () => {
  const item = normalizeBarang({ id_barang: 8 });
  const auction = normalizeLelang({ id_lelang: 1, id_barang: 8, id_user: 7 });
  let joined = joinAuctions([auction], [item], [], [], []);
  assert.equal(joined[0].penawarTertinggi, null);
  assert.equal(joined[0].penjual, null);
  assert.equal(joined[0].petugas, null);
  const winner = { id_user: 7, nama_lengkap: 'Nama terbaru' };
  joined = joinAuctions([auction], [item], [], [winner], []);
  assert.equal(joined[0].penawarTertinggi, winner);
  assert.equal(joined[0].totalBids, 0);
});
