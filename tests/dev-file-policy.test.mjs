import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

for (const config of ['vite.config.ts', 'vite.auth.config.ts']) {
  test(`${config} serves app files but never local credentials or private runtime files`, async t => {
    const fixtures = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
    await mkdir(fixtures, { recursive: true });
    const root = await mkdtemp(path.join(fixtures, 'vite-policy-fixture-'));

    await writeFile(path.join(root, 'index.html'), '<h1>Public fixture</h1>');
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/public.js'), 'export const fixtureValue = "PUBLIC_FIXTURE_MODULE";');
    const privatePaths = [
      '.env', '.env.production', '.git/config', '.firebase/hosting.cache',
      'firebase-service-account.json', 'project-firebase-adminsdk-fixture.json',
      'secrets/private.json', 'artifacts/accounts.json', 'tmp/session.json',
      'uploads/private.png', 'tests/browser/fixture.html',
      'private.pem', 'private.key', 'private.p12', 'private.pfx',
      'archive.sql', 'archive.sqlite', 'archive.db', 'archive.sql.gz',
    ];
    for (const file of privatePaths) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'PRIVATE_FIXTURE_MARKER');
    }
    const server = await createServer({
      configFile: fileURLToPath(new URL(`../${config}`, import.meta.url)), root,
      cacheDir: path.join(root, '.vite'), logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, open: false, proxy: {} },
    });
    t.after(async () => {
      server.httpServer.closeAllConnections();
      await server.close();
      assert.ok(path.resolve(root).startsWith(path.resolve(fixtures) + path.sep));
      await rm(root, { recursive: true, force: true });
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const publicResponse = await fetch(base);
    assert.equal(publicResponse.status, 200);
    assert.match(await publicResponse.text(), /Public fixture/);
    for (const route of ['/src/public.js', '/@vite/client']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), route === '/src/public.js' ? /PUBLIC_FIXTURE_MODULE/ : /WebSocket/);
    }
    for (const file of privatePaths) {
      const paths = [`/@fs/${root.replaceAll('\\', '/')}/${file}`];
      // /uploads is intentionally proxied to Go; test its disk path through Vite's fs route.
      if (!file.startsWith('uploads/')) paths.push(`/${file}`);
      for (const route of paths) {
        for (const suffix of ['', '?raw', '?url', '?import&raw', '?raw&import']) {
          const response = await fetch(`${base}${route}${suffix}`);
          const body = await response.text();
          assert.equal(response.status, 403, `${route}${suffix}`);
          assert.doesNotMatch(body, /PRIVATE_FIXTURE_MARKER/);
        }
      }
    }
    const encodedPaths = [
      '/%2eenv', '/%61rtifacts/accounts.json',
      `/@fs/${root.replaceAll('\\', '/')}/%2eenv`,
      `/%40fs/${root.replaceAll('\\', '/')}/secrets/private.json`,
      '/.ENV', '/ARTIFACTS/accounts.json',
    ];
    for (const route of encodedPaths) {
      const response = await fetch(`${base}${route}?raw`);
      assert.equal(response.status, 403, route);
      assert.doesNotMatch(await response.text(), /PRIVATE_FIXTURE_MARKER/);
    }
  });
}

