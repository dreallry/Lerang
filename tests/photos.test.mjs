import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PHOTO_BYTES, photoBatchError, validPhotoUrl } from '../src/utils/photos.ts';

const photo = { name: 'barang.JPG', type: 'image/jpeg', size: 1000 };

test('photo selection respects count, actual empty files, supported formats, and size limits', () => {
  assert.equal(photoBatchError([photo], 11), '');
  assert.equal(photoBatchError([{ ...photo, size: MAX_PHOTO_BYTES }], 0), '');
  assert.ok(photoBatchError([photo, photo], 11).includes('12'));
  assert.ok(photoBatchError([{ ...photo, size: MAX_PHOTO_BYTES + 1 }], 0).includes('10 MB'));
  assert.ok(photoBatchError([{ ...photo, size: 0 }], 0).includes('kosong'));
  assert.ok(photoBatchError([{ ...photo, name: 'identitas.svg', type: 'image/svg+xml' }], 0));
  assert.ok(photoBatchError([{ ...photo, type: 'text/html' }], 0));
  assert.ok(photoBatchError([{ ...photo, name: 'barang.exe' }], 0));
  assert.equal(photoBatchError([{ ...photo, type: '' }], 0), '');
});

test('photo links accept portable managed paths and HTTP addresses without credentials or oversized URLs', () => {
  for (const url of ['https://example.com/photo.jpg', 'http://localhost:5173/api/photos/fixture.png', `/api/photos/${'a'.repeat(32)}.jpg`]) assert.equal(validPhotoUrl(url), true);
  for (const url of ['', 'https://', 'https:example.com/photo.jpg', 'javascript:alert(1)', 'data:image/png;base64,fixture', '/photo.jpg', '/api/photos/../secrets.json', '/api/photos/file.svg', 'https://user:password@example.com/photo.png', `https://example.com/${'x'.repeat(4096)}`]) assert.equal(validPhotoUrl(url), false);
});
