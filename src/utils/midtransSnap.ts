const SCRIPT_ID = 'midtrans-snap-script';

export function loadSnap(clientKey: string, production: boolean): Promise<void> {
  const src = production ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing && (existing.src !== src || existing.dataset.clientKey !== clientKey)) {
    return Promise.reject(new Error('Konfigurasi Snap berubah. Muat ulang halaman sebelum membayar.'));
  }
  if (existing && window.snap) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    const clean = () => {
      clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const failed = () => {
      clean(); script.remove();
      reject(new Error('Midtrans belum dapat dimuat. Periksa koneksi lalu lanjutkan pembayaran yang sama.'));
    };
    const loaded = () => {
      if (!window.snap) { failed(); return; }
      clean(); resolve();
    };
    const timeout = setTimeout(failed, 15000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.id = SCRIPT_ID; script.src = src; script.async = true; script.dataset.clientKey = clientKey;
      document.head.appendChild(script);
    }
  });
}
