import test from 'node:test';
import assert from 'node:assert/strict';
import { topUpRequestId } from '../src/utils/paymentAttempt.ts';
import { loadSnap } from '../src/utils/midtransSnap.ts';

const first = '123e4567-e89b-42d3-a456-426614174000';
const next = '123e4567-e89b-42d3-a456-426614174001';
const transaction = (status = 'pending') => ({id:'fixture',tipe:'topup',nominal:100000,request_id:first,status});

test('closing or reloading a pending top up reuses its request rather than creating another payment', () => {
  assert.equal(topUpRequestId(100000, [], first, () => next), first);
  assert.equal(topUpRequestId(100000, [transaction()], '', () => next), first);
  assert.equal(topUpRequestId(200000, [transaction()], '', () => next), next);
  for (const status of ['sukses', 'gagal']) assert.equal(topUpRequestId(100000, [transaction(status)], first, () => next), next);
  assert.equal(topUpRequestId(100000, [], 'tampered', () => next), next);
  assert.equal(topUpRequestId(100000, [], 'AUTO-LOCK-1', () => next), next);
  assert.equal(topUpRequestId(200000, [transaction()], first, () => next), next);
});

function browserFixture(t) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let script;
  globalThis.window = {};
  globalThis.document = {
    getElementById: () => script || null,
    createElement: () => Object.assign(new EventTarget(), {dataset:{}, remove() { script = undefined; }}),
    head:{appendChild(value) { script = value; }},
  };
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; });
  return () => script;
}

test('Snap connection errors and stalled scripts fail without trapping the payment button', async t => {
  const script = browserFixture(t);
  const failed = assert.rejects(loadSnap('fixture-client', false), /koneksi/);
  script().dispatchEvent(new Event('error'));
  await failed;
  assert.equal(script(), undefined);
  t.mock.timers.enable({apis:['setTimeout']});
  const timeout = assert.rejects(loadSnap('fixture-client', false), /koneksi/);
  t.mock.timers.tick(15000);
  await timeout;
  assert.equal(script(), undefined);
});

test('Snap retry loads the same environment and rejects a changed client configuration', async t => {
  const script = browserFixture(t);
  const loaded = loadSnap('fixture-client', false);
  window.snap = {pay() {}};
  script().dispatchEvent(new Event('load'));
  await loaded;
  await loadSnap('fixture-client', false);
  await assert.rejects(loadSnap('different-client', false), /berubah/);
  await assert.rejects(loadSnap('fixture-client', true), /berubah/);
});
