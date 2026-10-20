import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadEnv } from 'vite';

const env = loadEnv(process.argv.includes('--production') ? 'production' : 'development', process.cwd(), '');
let failed = false;
function report(check, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${check}: ${detail}`);
  if (!passed) failed = true;
}
const required = ['API_KEY','AUTH_DOMAIN','DATABASE_URL','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID'];
const missing = required.filter(key => !env[`VITE_FIREBASE_${key}`]?.trim());
report('Web configuration', !missing.length, missing.length ? missing.map(key => `VITE_FIREBASE_${key}`).join(', ') : 'all required values supplied');
if (missing.length) process.exit(1);
const project = env.VITE_FIREBASE_PROJECT_ID;
let credential;
try {
  credential = JSON.parse(fs.readFileSync(env.FIREBASE_CREDENTIALS, 'utf8'));
  report('Admin project', credential.project_id === project, credential.project_id === project ? project : 'Web and Admin SDK projects differ');
} catch {
  report('Admin credentials', false, 'FIREBASE_CREDENTIALS must reference a readable service-account JSON file');
}
report('Realtime Database URL', env.VITE_FIREBASE_DATABASE_URL === env.FIREBASE_DATABASE_URL, 'Web and backend URLs must match');
const endpoint = new URL('https://identitytoolkit.googleapis.com/v1/projects');
endpoint.searchParams.set('key', env.VITE_FIREBASE_API_KEY);
try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  report('Authentication service', response.ok, response.ok ? 'project configuration exists' : data.error?.message || `HTTP ${response.status}`);
  if (response.ok) report('API key project', String(data.projectId) === env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'Auth project number must match the Web App sender ID');
} catch {
  report('Authentication service', false, 'Google Auth endpoint could not be reached');
}
if (credential?.project_id === project) {
  try {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: credential.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_only https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300,
    })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credential.private_key).toString('base64url');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error('Admin access unavailable');
    const { access_token: accessToken } = await tokenResponse.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [database, storage] = await Promise.allSettled([
      fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/items.json`, { headers, signal: AbortSignal.timeout(15000) }),
      fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET)}`, { headers, signal: AbortSignal.timeout(15000) }),
    ]);
    const databaseOK = database.status === 'fulfilled' && database.value.ok;
    const storageOK = storage.status === 'fulfilled' && storage.value.ok;
    report('Realtime Database access', databaseOK, databaseOK ? 'server credentials can read the catalog collection' : 'RTDB could not be read with server credentials');
    report('Storage bucket', storageOK, storageOK ? 'configured bucket exists and can be accessed' : storage.status === 'fulfilled' && storage.value.status === 404 ? 'bucket does not exist; create it in Firebase Console > Storage' : 'configured bucket is unavailable or access was denied');
  } catch {
    report('Admin service access', false, 'could not verify RTDB and Storage access; no private credential values were printed');
  }
}
if (failed) console.log(`Review .env and https://console.firebase.google.com/project/${encodeURIComponent(project)}/overview`);
process.exitCode = failed ? 1 : 0;
