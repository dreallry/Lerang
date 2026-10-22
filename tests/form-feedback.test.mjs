import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeValidationMessage } from '../src/utils/formFeedback.ts';

const validity = { valueMissing: false, typeMismatch: false, tooShort: false, tooLong: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false, patternMismatch: false };
const field = { label: ' Nama barang * ', type: 'text', min: '', max: '', minLength: 10, maxLength: 200, validity };

test('native validation identifies the field and localizes missing values without echoing its value', () => {
  assert.equal(nativeValidationMessage({ ...field, validity: { ...validity, valueMissing: true } }), 'Nama barang wajib diisi.');
  assert.equal(nativeValidationMessage({ ...field, label: 'Persetujuan', type: 'checkbox', validity: { ...validity, valueMissing: true } }), 'Persetujuan perlu dicentang sebelum melanjutkan.');
  assert.equal(nativeValidationMessage({ ...field, label: 'Email', type: 'email', validity: { ...validity, typeMismatch: true } }), 'Email: masukkan alamat email yang valid.');
});

test('length and range errors state the actual configured constraint', () => {
  assert.equal(nativeValidationMessage({ ...field, validity: { ...validity, tooShort: true } }), 'Nama barang minimal 10 karakter.');
  assert.equal(nativeValidationMessage({ ...field, validity: { ...validity, tooLong: true } }), 'Nama barang maksimal 200 karakter.');
  assert.equal(nativeValidationMessage({ ...field, label: 'Harga', min: '100000', validity: { ...validity, rangeUnderflow: true } }), 'Harga minimal 100000.');
  assert.equal(nativeValidationMessage({ ...field, label: 'Harga', max: '500000', validity: { ...validity, rangeOverflow: true } }), 'Harga maksimal 500000.');
});

test('numeric and pattern failures retain a usable fallback for unlabeled fields', () => {
  assert.equal(nativeValidationMessage({ ...field, label: '', validity: { ...validity, badInput: true } }), 'Isian ini: periksa angka yang dimasukkan.');
  assert.equal(nativeValidationMessage({ ...field, label: 'Kode pos', validity: { ...validity, patternMismatch: true } }), 'Kode pos: periksa kembali format isian ini.');
});
