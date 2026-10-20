import test from 'node:test';
import assert from 'node:assert/strict';
import { pickupCourier, recipientReady, shippingBlockReason, nextShippingStatus } from '../src/utils/shipping.ts';

test('pickup uses recipient contacts without a fictional address or courier tracking number', () => {
  const order = { kurir: pickupCourier, status: 'dikemas', nama_penerima: 'Fixture recipient', telp_penerima: '08123456789' };
  assert.equal(recipientReady(order), true);
  assert.equal(nextShippingStatus(order), 'diterima');
  assert.equal(recipientReady({ ...order, kurir: 'Fixture courier' }), false);
  assert.equal(nextShippingStatus({ ...order, kurir: 'Fixture courier' }), 'dikirim');
  assert.equal(nextShippingStatus({ ...order, status: 'diterima' }), null);
});

test('admin controls reject archives, unverified payments and mismatched invoice relationships', () => {
  const order = { id_user_pembeli: 1, id_barang: 2, id_lelang: 3 };
  const invoice = { id_user: 1, id_barang: 2, id_lelang: 3, status: 'Sudah Dibayar' };
  assert.equal(shippingBlockReason(order, invoice), '');
  assert.ok(shippingBlockReason({ ...order, legacy_historical: true }, invoice));
  assert.ok(shippingBlockReason(order, { ...invoice, payment_review_required: true }));
  assert.ok(shippingBlockReason(order, { ...invoice, id_user: 7 }));
  assert.ok(shippingBlockReason(order, undefined));
});
