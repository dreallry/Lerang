import { documentLinkError } from './catalogData.ts';

export interface SpecificationRow { key: string; val: string }

export function submissionDetails(documents: readonly string[], specs: readonly SpecificationRow[]) {
  const links: string[] = [];
  const entries: [string, string][] = [];
  const names = new Set<string>();
  const issue = (field: string, message: string) => ({ documents: links, specifications: Object.fromEntries(entries), error: { field, message } });
  for (const [index, draft] of documents.entries()) {
    const value = draft.trim();
    if (!value) continue;
    const error = documentLinkError(value, links);
    if (error) return issue(`submission-document-${index}`, `Dokumen ${index + 1}: ${error}`);
    links.push(value);
  }
  for (const [index, draft] of specs.entries()) {
    const key = draft.key.trim(), value = draft.val.trim();
    if (!key && !value) continue;
    if (!key || !value) return issue(`submission-spec-${!key ? 'key' : 'value'}-${index}`, `Spesifikasi ${index + 1}: isi nama dan nilainya, atau hapus baris ini jika tidak diperlukan.`);
    if (entries.length >= 50) return issue(`submission-spec-key-${index}`, 'Maksimal 50 spesifikasi per barang.');
    const keyBytes = new TextEncoder().encode(key).length;
    const valueBytes = new TextEncoder().encode(value).length;
    if (keyBytes > 100 || valueBytes > 2000) return issue(`submission-spec-${keyBytes > 100 ? 'key' : 'value'}-${index}`, `Spesifikasi ${index + 1} terlalu panjang. Ringkas nama atau nilainya.`);
    if (/[.#$\[\]\/\x00-\x1f\x7f]/.test(key)) return issue(`submission-spec-key-${index}`, 'Nama spesifikasi tidak boleh memakai titik, #, $, [, ], /, atau karakter kontrol. Contoh nama: Tahun atau Warna.');
    const name = key.toLocaleLowerCase('id-ID');
    if (names.has(name)) return issue(`submission-spec-key-${index}`, `Nama spesifikasi “${key}” sudah digunakan. Gabungkan nilainya atau gunakan nama yang berbeda.`);
    names.add(name);
    entries.push([key, value]);
  }
  return { documents: links, specifications: Object.fromEntries(entries), error: null };
}
