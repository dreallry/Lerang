import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import { configureApiProxy } from '../scripts/vite-api-proxy.mjs';

test('an unavailable API returns actionable JSON503 instead of an empty500', async t => {
  const unused = httpServer();
  await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve));
  const port = unused.address().port;
  await new Promise(resolve => unused.close(resolve));
  const server = await createServer({ configFile:false, logLevel:'silent',
    server:{ host:'127.0.0.1', port:0, proxy:{ '/api':{ target:`http://127.0.0.1:${port}`, configure:configureApiProxy } } },
    optimizeDeps:{noDiscovery:true,include:[]},
  });
  t.after(async()=>{server.httpServer.closeAllConnections();await server.close()});
  await server.listen();
  const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/api/barang`);
  assert.equal(response.status,503);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();
  assert.equal(body.success,false);
  assert.match(body.error,/Server lelang belum tersambung/);
});
