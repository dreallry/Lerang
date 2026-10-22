import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionDetails } from '../src/utils/submissionDetails.ts';

test('visible document and specification rows are submitted without a separate add action', () => {
  const documents = [' https://example.test/document.pdf ', ''];
  const specs = [{ key:' Tahun ', val:' 2023 ' }, { key:'', val:'' }];
  const result = submissionDetails(documents, specs);
  assert.equal(result.error,null);
  assert.deepEqual(result.documents,['https://example.test/document.pdf']);
  assert.deepEqual(result.specifications,{Tahun:'2023'});
  assert.equal(documents[0],' https://example.test/document.pdf ');
  assert.equal(specs[0].key,' Tahun ');
  assert.deepEqual(submissionDetails([],[]),{documents:[],specifications:{},error:null});
});

test('an incomplete specification points to its missing field without losing rows', () => {
  assert.equal(submissionDetails([],[{key:'Tahun',val:''}]).error.field,'submission-spec-value-0');
  assert.equal(submissionDetails([],[{key:'',val:'2023'}]).error.field,'submission-spec-key-0');
  assert.equal(submissionDetails([],[{key:'Tahun',val:'2023'},{key:' tahun ',val:'2024'}]).error.field,'submission-spec-key-1');
});

test('invalid document links and RTDB specification keys are caught before submission', () => {
  assert.match(submissionDetails(['STNK'],[]).error.message,/bukan nama dokumen/);
  assert.equal(submissionDetails(['https://example.test/doc','https://example.test/doc'],[]).error.field,'submission-document-1');
  for (const key of ['a.b','a#b','a$b','a[b','a]b','a/b','a\nb']) {
    assert.equal(submissionDetails([],[{key,val:'value'}]).error.field,'submission-spec-key-0');
  }
  assert.equal(submissionDetails([],[{key:'x'.repeat(101),val:'value'}]).error.field,'submission-spec-key-0');
  assert.equal(submissionDetails([],[{key:'Nama',val:'x'.repeat(2001)}]).error.field,'submission-spec-value-0');
  const safe = submissionDetails([],[{key:'__proto__',val:'text'}]);
  assert.equal(JSON.stringify(safe.specifications),'{"__proto__":"text"}');
});

test('optional detail limits match server limits and ignore empty rows', () => {
  assert.equal(submissionDetails(Array.from({length:13},(_,i)=>`https://example.test/${i}`),[]).error.field,'submission-document-12');
  assert.equal(submissionDetails([],Array.from({length:51},(_,i)=>({key:`Rincian ${i}`,val:'value'}))).error.field,'submission-spec-key-50');
  assert.equal(submissionDetails([''],[{key:' ',val:' '}]).error,null);
});
