import test from 'node:test';
import assert from 'node:assert/strict';
import { startPolling } from '../src/utils/polling.ts';

test('slow refreshes finish before the next poll and cleanup stops further requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { hidden: false };
  let finish, calls = 0;
  const stop = startPolling(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 5000);
  assert.equal(calls, 1);
  t.mock.timers.tick(30000);
  assert.equal(calls, 1);
  finish(); await Promise.resolve();
  t.mock.timers.tick(4999); assert.equal(calls, 1);
  t.mock.timers.tick(1); assert.equal(calls, 2);
  stop(); finish(); await Promise.resolve();
  t.mock.timers.tick(30000); assert.equal(calls, 2);
  delete globalThis.document;
});

test('a failed refresh retries, and hidden pages pause polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { hidden: false };
  let calls = 0;
  const stop = startPolling(async () => { calls++; throw new Error('fixture network failure'); }, 1000);
  await Promise.resolve();
  t.mock.timers.tick(1000); await Promise.resolve(); assert.equal(calls, 2);
  document.hidden = true;
  t.mock.timers.tick(2000); await Promise.resolve(); assert.equal(calls, 2);
  document.hidden = false;
  t.mock.timers.tick(1000); await Promise.resolve(); assert.equal(calls, 3);
  stop(); delete globalThis.document;
});
