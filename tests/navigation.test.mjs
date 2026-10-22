import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppHash, parseAppHash } from '../src/utils/navigation.ts';

test('detail routes replace their selected ID on direct links and browser history', () => {
  let route = parseAppHash('#auction-detail?id=42');
  assert.equal(route.id, 42);
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '1e2', '9007199254740992', 'not-a-number']) {
    route = parseAppHash(`#auction-detail${value ? `?id=${value}` : ''}`);
    assert.equal(route.view, 'auction-detail');
    assert.equal(route.id, null, `Invalid route retained the previous lot: ${value}`);
  }
  assert.equal(parseAppHash('#theme-detail?id=7').id, 7);
  assert.equal(parseAppHash('#session-detail?id=8').id, 8);
});

test('navigation links round trip without carrying another view selection', () => {
  for (const view of ['auction-detail', 'theme-detail', 'session-detail']) {
    assert.equal(parseAppHash(buildAppHash(view, 12)).id, 12);
    assert.equal(parseAppHash(buildAppHash(view)).id, null);
  }
  assert.equal(buildAppHash('fulfillment', 9), '#fulfillment?invoiceId=9');
  assert.equal(parseAppHash('#fulfillment?invoiceId=9').invoiceId, 9);
  assert.equal(parseAppHash('#fulfillment?id=9').invoiceId, 9);
  assert.equal(parseAppHash('#fulfillment').invoiceId, null);
  assert.equal(buildAppHash('catalog', 12), '#catalog');
  assert.equal(buildAppHash('auction-detail', NaN), '#auction-detail');
});

test('catalog and email action query strings remain intact', () => {
  assert.deepEqual(parseAppHash(''), { view: 'catalog', id: null, invoiceId: null, query: '' });
  assert.equal(parseAppHash('#catalog?q=jam%20%26%20seni%3F').query, 'jam & seni?');
  assert.equal(parseAppHash('#auth-action?mode=resetPassword&oobCode=fixture').view, 'auth-action');
});

test('unknown page names have a recoverable route instead of an empty page', () => {
  assert.equal(parseAppHash('#does-not-exist').view, 'not-found');
  assert.equal(parseAppHash('#admin-missing?id=1').view, 'not-found');
  assert.equal(parseAppHash('#guide').view, 'guide');
});
