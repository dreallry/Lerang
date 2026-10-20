import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');
const serverKey = env.MIDTRANS_SERVER_KEY?.trim() || '';
const clientKey = env.MIDTRANS_CLIENT_KEY?.trim() || '';
const productionFlag = env.MIDTRANS_IS_PRODUCTION?.trim().toLowerCase() || 'false';
if (productionFlag !== 'false' || !serverKey || !clientKey) {
  console.error('FAIL: pemeriksaan ini memerlukan kedua kunci Midtrans dan mode produksi nonaktif.');
  process.exit(1);
}
try {
  const response = await fetch(`https://api.sandbox.midtrans.com/v2/LERANG-VERIFY-${Date.now()}/status`, {
    headers: { Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if ((response.ok || response.status === 404) && String(data.status_code) === '404') {
    console.log('PASS: Server Key diterima Midtrans Sandbox; order pemeriksaan memang tidak ada. Tidak ada pembayaran dibuat.');
  } else {
    console.error(`FAIL: Midtrans Sandbox mengembalikan HTTP ${response.status}. Periksa pasangan kunci Sandbox di Settings > Access Keys. Tidak ada pembayaran dibuat.`);
    process.exitCode = 1;
  }
} catch {
  console.error('FAIL: Midtrans Sandbox belum dapat dijangkau. Tidak ada pembayaran dibuat.');
  process.exitCode = 1;
}
