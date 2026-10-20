import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadEnv } from 'vite';

export async function firebaseAdmin() {
  const env = loadEnv('development', process.cwd(), '');
  const credential = JSON.parse(fs.readFileSync(env.FIREBASE_CREDENTIALS, 'utf8'));
  if (credential.project_id !== env.VITE_FIREBASE_PROJECT_ID) throw new Error('Project Web dan Admin Firebase berbeda.');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credential.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300,
  })}`;
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), credential.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Akses Admin Firebase ditolak: HTTP ${response.status}`);
  const { access_token } = await response.json();
  return {
    env, projectId: credential.project_id,
    request: (url, options = {}) => fetch(url, {
      ...options, signal: AbortSignal.timeout(30000),
      headers: { ...options.headers, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    }),
  };
}
