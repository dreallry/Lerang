import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { apiPort } from '../scripts/dev-config.mjs';
import { inspectAPI } from '../scripts/dev.mjs';

async function fixture(t, body, { status = 200, catalog = { success: true, data: [] }, catalogStatus = 200 } = {}) {
  const server = http.createServer((request, response) => {
    assert.ok(['/api/health', '/api/barang'].includes(request.url));
    const isHealth = request.url === '/api/health';
    response.writeHead(isHealth ? status : catalogStatus, { 'Content-Type': 'application/json', Connection: 'close' });
    response.end(JSON.stringify(isHealth ? body : catalog));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('development API port defaults and rejects invalid configuration', () => {
  assert.equal(apiPort({}), 8080);
  assert.equal(apiPort({ PORT: '9090' }), 9090);
  for (const PORT of ['0', '-1', '65536', '8080/path', '8e3', 'NaN']) {
    assert.throws(() => apiPort({ PORT }), /PORT must be an integer/);
  }
});

test('API readiness allows optional payments to remain unavailable', async t => {
  const port = await fixture(t, { server: 'Golang Native', db: true, firebase: true, midtrans: false, status: 'degraded' });
  assert.equal(await inspectAPI(port), 'ready');
});

test('API with missing Firebase configuration is not ready', async t => {
  const port = await fixture(t, { server: 'Golang Native', db: false, firebase: true });
  assert.equal(await inspectAPI(port), 'degraded');
});

test('configured API with a broken Firebase catalog must not be reused', async t => {
  const port = await fixture(t, { server: 'Golang Native', db: true, firebase: true }, {
    catalogStatus: 500, catalog: { success: false, message: 'Catalog could not be decoded' },
  });
  assert.equal(await inspectAPI(port), 'read-error');
});

test('configured API returning an unexpected catalog shape is not ready', async t => {
  const port = await fixture(t, { server: 'Golang Native', db: true, firebase: true }, {
    catalog: { success: true, data: {} },
  });
  assert.equal(await inspectAPI(port), 'read-error');
});

test('a different HTTP server must not be reused as the Go API', async t => {
  const port = await fixture(t, { status: 'ok' });
  assert.equal(await inspectAPI(port), 'occupied');
});

test('closed port is recognized as a missing API', async () => {
  // Closing only this fixture leaves application services untouched.
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const closedPort = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.equal(await inspectAPI(closedPort), 'absent');
});
