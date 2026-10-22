import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, rmdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, loadEnv } from 'vite';
import { apiPort } from './dev-config.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function portOccupied(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = occupied => { socket.destroy(); resolve(occupied); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1200, () => finish(true));
  });
}

export async function inspectAPI(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    const health = await response.json();
    if (!response.ok || health?.server !== 'Golang Native') return 'occupied';
    if (health.db !== true || health.firebase !== true) return 'degraded';
  } catch {
    return await portOccupied(port) ? 'occupied' : 'absent';
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/barang`, {
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    const catalog = await response.json();
    return response.ok && catalog?.success === true && Array.isArray(catalog.data) ? 'ready' : 'read-error';
  } catch {
    return 'read-error';
  }
}

function requireUsableAPI(state, port) {
  if (state === 'occupied') throw new Error(`Port ${port} is occupied by an unrecognized service. Stop it or change PORT; no existing process was stopped.`);
  if (state === 'degraded') throw new Error(`The Go API on port ${port} has incomplete Firebase settings. Check its startup output and run npm run check:firebase, then restart the API.`);
  if (state === 'read-error') throw new Error(`The Go API on port ${port} is running but cannot read the Firebase catalog. Restart it from current source (rebuild server.exe if used), then run npm run check:firebase if the error persists. No existing process was stopped.`);
}

export async function startDevelopment({ apiOnly = false } = {}) {
  const env = { ...process.env, ...loadEnv('development', projectRoot, '') };
  const port = apiPort(env);
  env.PORT = String(port);
  let web;
  let binary;
  let directory;
  let ownedAPI = false;
  let stopping = false;
  const children = new Set();

  async function cleanup() {
    if (stopping) return;
    stopping = true;
    await web?.close().catch(() => {});
    await Promise.all([...children].map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit').catch(() => {});
      try { child.kill(); } catch { /* The child may have exited since the check. */ }
      await Promise.race([exited, delay(5000, undefined, { ref: false })]);
    }));
    if (binary) await rm(binary, { force: true }).catch(() => {});
    if (directory) await rmdir(directory).catch(() => {});
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
  }

  function interrupted() { void cleanup().then(() => { process.exitCode = 0; }); }
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);

  function childProcess(command, args) {
    const child = spawn(command, args, { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true });
    children.add(child);
    return child;
  }

  try {
    let state = await inspectAPI(port);
    requireUsableAPI(state, port);
    if (state === 'absent') {
      await mkdir(path.join(projectRoot, 'tmp'), { recursive: true });
      directory = await mkdtemp(path.join(projectRoot, 'tmp', 'dev-api-'));
      binary = path.join(directory, process.platform === 'win32' ? 'lerang-api.exe' : 'lerang-api');
      console.log('Building the Go API...');
      const build = childProcess('go', ['build', '-o', binary, '.']);
      let code;
      try { [code] = await once(build, 'exit'); }
      catch { throw new Error('Go could not be started. Install Go and ensure it is available on PATH.'); }
      if (stopping) return;
      if (code !== 0) throw new Error('Go API build failed. Check the output above and confirm Go is installed.');

      state = await inspectAPI(port);
      requireUsableAPI(state, port);
      if (state === 'absent') {
        const api = childProcess(binary, []);
        ownedAPI = true;
        let startupError;
        api.once('error', error => { startupError = error; });
        const deadline = Date.now() + 60000;
        while (!stopping && Date.now() < deadline) {
          if (startupError) throw new Error('The Go API could not start. Check executable permissions and the output above.');
          if (api.exitCode !== null || api.signalCode !== null) throw new Error('The Go API stopped during startup. Check its output above.');
          state = await inspectAPI(port);
          if (state === 'ready') break;
          requireUsableAPI(state, port);
          await delay(300);
        }
        if (stopping) return;
        if (state !== 'ready') throw new Error('The Go API did not become ready within 60 seconds. Check its startup output.');
        api.once('exit', () => {
          if (!stopping) {
            console.error('The Go API stopped; development services are shutting down.');
            process.exitCode = 1;
            void cleanup();
          }
        });
      }
    }
    if (stopping) return;
    console.log(`${ownedAPI ? 'Started' : 'Reusing'} Go API at http://localhost:${port}. Firebase catalog read succeeded.`);
    if (!apiOnly) {
      web = await createServer({ root: projectRoot, server: { port: 5173, strictPort: true } });
      if (stopping) { await web.close(); return; }
      await web.listen();
      web.printUrls();
    } else if (!ownedAPI) {
      await cleanup();
    }
  } catch (error) {
    if (!stopping) {
      console.error(error instanceof Error ? error.message : 'Development startup failed.');
      process.exitCode = 1;
    }
    await cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startDevelopment({ apiOnly: process.argv.includes('--api-only') });
}
