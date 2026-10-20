import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWallet, normalizeInvoice, normalizeFulfillment } from '../src/utils/accountData.ts';

test('wallet restores only server-confirmed deposit and proxy limits for its owner', () => {
  const wallet = normalizeWallet({
    saldo_wallet: '250000', saldo_hold: 100000,
    transactions: [{ id: 'hold-7', id_user: '3', nominal: '100000', tipe: 'hold', status: 'sukses' }],
    held_deposits: { '7_3': true }, auto_bids: { '7_3': '500000' },
  }, 3);
  assert.equal(wallet.saldo_wallet, 250000);
  assert.equal(wallet.saldo_hold, 100000);
  assert.deepEqual(wallet.heldDeposits, { '7_3': true });
  assert.deepEqual(wallet.autoBids, { '7_3': 500000 });
  assert.equal(wallet.transactions[0].nominal, 100000);
  assert.equal(wallet.transactions[0].id_user, 3);
});

test('a wallet response cannot restore another participant deposit, proxy limit, or transaction', () => {
  const base = { saldo_wallet: 250000, saldo_hold: 0, transactions: [] };
  assert.throws(() => normalizeWallet({ ...base, held_deposits: { '7_4': true } }, 3));
  assert.throws(() => normalizeWallet({ ...base, auto_bids: { '7_4': 500000 } }, 3));
  assert.throws(() => normalizeWallet({ ...base, transactions: [{ id: 'private', id_user: 4, nominal: 1 }] }, 3));
});

test('missing, fractional, negative, or unsafe balances cannot become usable funds', () => {
  const base = { saldo_wallet: 100000, saldo_hold: 0, transactions: [] };
  for (const amount of [-1, 0.5, Infinity, 'not-money', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeWallet({ ...base, saldo_wallet: amount }, 3));
  }
  assert.throws(() => normalizeWallet({ transactions: [] }, 3));
  assert.throws(() => normalizeWallet({ ...base, transactions: null }, 3));
});

test('an invoice preserves migration review flags while normalizing related identifiers', () => {
  const invoice = normalizeInvoice({ id_pembayaran: '8', id_lelang: '7', id_barang: '2', id_user: '3', jumlah_pembayaran: '600000', sisa_tagihan: '500000', legacy_historical: true, payment_review_required: true });
  assert.equal(invoice.id_lelang, 7);
  assert.equal(invoice.sisa_tagihan, 500000);
  assert.equal(invoice.legacy_historical, true);
  assert.equal(invoice.payment_review_required, true);
  assert.throws(() => normalizeInvoice({ ...invoice, sisa_tagihan: -1 }));
});

test('fulfillment reload supports persisted empty tracking history without inventing events', () => {
  const order = normalizeFulfillment({ id_fulfillment: 'order-8', id_pembayaran: '8', id_lelang: '7', id_barang: '2', id_user_pembeli: '3', status: 'menunggu_alamat' });
  assert.equal(order.id_user_pembeli, 3);
  assert.deepEqual(order.tracking_history, []);
  assert.equal(order.ongkir, 0);
  assert.throws(() => normalizeFulfillment({ ...order, id_user_pembeli: 0 }));
});
