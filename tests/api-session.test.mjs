import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (await readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8'))
  .replace("import { auth } from '../firebase';", 'const auth = globalThis.__apiTestAuth;')
  .replace('import.meta.env.VITE_API_BASE_URL', "'/api'");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });

async function fixture(t, owner) {
  const previousFetch = globalThis.fetch;
  globalThis.__apiTestAuth = { currentUser: owner };
  const { default: api } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${Math.random()}`);
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.__apiTestAuth; });
  return { api, auth: globalThis.__apiTestAuth };
}

test('an account change while refreshing credentials never sends the old account mutation', async t => {
  let finishToken;
  const owner = { uid: 'fixture-a', getIdToken: () => new Promise(resolve => { finishToken = resolve; }) };
  const { api, auth } = await fixture(t, owner);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ success: true }); };
  const request = api.lockDeposit(1);
  auth.currentUser = { uid: 'fixture-b' };
  finishToken('fixture-token');
  await assert.rejects(request, /Sesi akun berubah/);
  assert.equal(requests, 0);
});

test('a delayed private response cannot reach a different account or a renewed session of the same account', async t => {
  const owner = { uid: 'fixture-a', getIdToken: async () => 'fixture-token' };
  const { api, auth } = await fixture(t, owner);
  for (const uid of ['fixture-b', 'fixture-a']) {
    auth.currentUser = owner;
    let finishResponse;
    globalThis.fetch = () => new Promise(resolve => { finishResponse = resolve; });
    const request = api.getWalletInfo();
    await Promise.resolve();
    auth.currentUser = { uid };
    finishResponse(Response.json({ success: true, data: { saldo_wallet: 123 } }));
    await assert.rejects(request, /Sesi akun berubah/);
  }
});

test('an aborted photo selection is not sent after a slow credential refresh', async t => {
  let finishToken;
  const { api } = await fixture(t, { uid: 'fixture-a', getIdToken: () => new Promise(resolve => { finishToken = resolve; }) });
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ success: true, data: { url: '/api/media/fixture.jpg' } }); };
  const controller = new AbortController();
  const request = api.uploadFoto(new File(['fixture'], 'fixture.jpg', { type: 'image/jpeg' }), controller.signal);
  controller.abort();
  finishToken('fixture-token');
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(requests, 0);
});
