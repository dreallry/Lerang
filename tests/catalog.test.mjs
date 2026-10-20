import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBarang, normalizeLelang, normalizeHistory, mergeBarang } from '../src/utils/catalogData.ts';

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
