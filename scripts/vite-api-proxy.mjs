export function configureApiProxy(proxy) {
  proxy.on('error', (_error, _request, response) => {
    if (!response || typeof response.writeHead !== 'function' || response.headersSent) return;
    response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ success: false, error: 'Server lelang belum tersambung. Coba lagi setelah layanan tersedia.' }));
  });
}
