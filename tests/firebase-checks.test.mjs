import test from 'node:test';
import assert from 'node:assert/strict';
import { photoStorageStatus } from '../scripts/check-firebase.mjs';

test('available Firebase Storage is preferred over disk fallback', () => {
  const status = photoStorageStatus(true, 'uploads/lot-photos');
  assert.equal(status.passed, true);
  assert.match(status.detail, /bucket.*accessible/);
});

test('missing optional bucket does not fail a configured server-disk deployment', () => {
  const status = photoStorageStatus(false, ' uploads/lot-photos ');
  assert.equal(status.passed, true);
  assert.match(status.detail, /disk fallback configured/);
  assert.match(status.detail, /Go startup/);
  assert.doesNotMatch(status.detail, /bucket.*accessible/);
});

test('missing bucket and disk configuration still reports unavailable photo uploads', () => {
  const status = photoStorageStatus(false, '   ');
  assert.equal(status.passed, false);
  assert.match(status.detail, /PHOTO_UPLOAD_DIR/);
});
