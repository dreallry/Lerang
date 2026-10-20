import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://localhost:5173');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Pemeriksaan modul memakai server lokal.');
const pages = ['admin/AdminDashboard', 'admin/OperationsCenter', 'admin/AdminC2CKurasi', 'admin/AdminAuctionManager', 'admin/AdminSessionManager', 'admin/AdminReportGenerator', 'admin/AdminUserManagement', 'admin/AdminFulfillment', 'user/UserInvoices', 'user/UserFulfillment'];
const checked = new Map();
for (const page of pages) {
  const url = new URL(`/src/components/${page}.tsx`, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${page}: modul halaman gagal dimuat (HTTP ${response.status}).`);
  const source = await response.text();
  const dependencies = [...source.matchAll(/from\s+["']([^"'\n]*\/node_modules\/\.vite[^"'\n]*)["']/g)].map(match => match[1]);
  assert.ok(dependencies.length, `${page}: respons bukan modul Vite yang diharapkan.`);
  for (const dependency of dependencies) {
    if (!checked.has(dependency)) {
      const asset = await fetch(new URL(dependency, base), { signal: AbortSignal.timeout(15000) });
      checked.set(dependency, asset.status);
    }
    assert.equal(checked.get(dependency), 200, `${page}: dependensi ${dependency.split('?')[0]} gagal dimuat. Dashboard akan menjadi kosong.`);
  }
  console.log(`PASS: ${page}`);
}
console.log(`PASS: ${pages.length} halaman dan ${checked.size} dependensi admin dapat dimuat.`);
