import test from 'node:test';
import assert from 'node:assert/strict';
import {toDateTimeLocal} from '../src/utils/formatters.ts';
import {toCsv} from '../src/utils/csv.ts';

test('session datetime-local defaults preserve the intended instant in different time zones', () => {
  const before = process.env.TZ;
  try {
    for (const zone of ['Asia/Bangkok','Asia/Jakarta','America/Los_Angeles','UTC']) {
      process.env.TZ = zone;
      for (const instant of ['2026-10-20T04:00:00Z','2026-03-08T10:30:00Z']) {
        const date = new Date(instant);
        assert.equal(new Date(toDateTimeLocal(date)).getTime(), date.getTime(), zone);
      }
    }
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('report CSV preserves quotes, commas, line breaks, and a hash in item names', () => {
  assert.equal(toCsv([['Lot #3, "jam"','baris 1\nbaris 2',100000]]), '"Lot #3, ""jam""","baris 1\nbaris 2","100000"\r\n');
});

test('participant-supplied names cannot become spreadsheet formulas', () => {
  for (const value of ['=1+1','+SUM(1,2)','-2+3','@SUM(1,2)','\t=1','  =1']) {
    assert.equal(toCsv([[value]]), `"'${value}"\r\n`);
  }
  assert.equal(toCsv([['Barang biasa',-100]]), '"Barang biasa","-100"\r\n');
});
