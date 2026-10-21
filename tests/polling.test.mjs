import test from 'node:test';
import assert from 'node:assert/strict';
import { startPolling } from '../src/utils/polling.ts';

function events(t) {
  const priorWindow = globalThis.window;
  globalThis.window = new EventTarget();
  Object.assign(globalThis.document, {
    addEventListener: globalThis.window.addEventListener.bind(globalThis.window),
    removeEventListener: globalThis.window.removeEventListener.bind(globalThis.window),
  });
  t.after(() => { globalThis.window = priorWindow; });
}

test('slow refreshes finish before the next poll and cleanup stops further requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { hidden: false };
  events(t);
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
  events(t);
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

test('offline polling waits and reconnect refreshes immediately without overlapping a pending request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { hidden: false };
  events(t);
  const previousOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  t.after(() => {
    if (previousOnline) Object.defineProperty(navigator, 'onLine', previousOnline);
    else delete navigator.onLine;
    delete globalThis.document;
  });
  let calls = 0, finish;
  const stop = startPolling(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 30000);
  assert.equal(calls, 0);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  window.dispatchEvent(new Event('online'));
  assert.equal(calls, 1);
  window.dispatchEvent(new Event('online'));
  assert.equal(calls, 1);
  finish(); await Promise.resolve();
  document.hidden = true;
  t.mock.timers.tick(30000); await Promise.resolve();
  assert.equal(calls, 1);
  document.hidden = false;
  window.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 2);
  stop(); finish(); await Promise.resolve();
  window.dispatchEvent(new Event('online'));
  assert.equal(calls, 2);
});
