import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../src/utils/authErrors.ts';
import { parseSessionProfile } from '../src/utils/sessionProfile.ts';
import { firebaseConfigFromEnv } from '../src/lib/firebaseConfig.ts';

test('configuration failures give an actionable message, without raw Firebase errors', () => {
  for (const code of ['auth/configuration-not-found', 'auth/operation-not-allowed', 'auth/invalid-api-key']) {
    const text = authErrorMessage({ code, message: `Firebase: Error (${code})` });
    assert.match(text, /pengelola/);
    assert.doesNotMatch(text, /Firebase: Error/);
  }
});

test('incorrect credentials do not suggest replacing existing accounts', () => {
  for (const code of ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential']) {
    assert.match(authErrorMessage({ code }), /reset/);
    assert.doesNotMatch(authErrorMessage({ code }), /daftar ulang/i);
  }
});

test('staff profiles remain staff when restoring a Firebase session', () => {
  const session = parseSessionProfile({ id_petugas: '7', id_level: '1', nama_petugas: 'Fixture petugas' });
  assert.equal(session.kind, 'petugas');
  assert.equal(session.profile.id_petugas, 7);
  assert.equal(session.profile.id_level, 1);
});

test('participant profiles preserve server balances and normalize numeric IDs', () => {
  const session = parseSessionProfile({ id_user: '9', saldo_wallet: '150000', saldo_hold: '50000' });
  assert.equal(session.kind, 'masyarakat');
  assert.equal(session.profile.id_user, 9);
  assert.equal(session.profile.saldo_wallet, 150000);
  assert.equal(session.profile.saldo_hold, 50000);
});

test('invalid IDs, roles and wallet values are rejected', () => {
  for (const profile of [null, {}, {id_user: null}, {id_user: 0}, {id_user: 1.5}, {id_petugas: 2, id_level: 99}, {id_user: 1, saldo_wallet: 'broken'}]) {
    assert.throws(() => parseSessionProfile(profile));
  }
});

test('missing configuration cannot silently fall back to another Firebase project', () => {
  assert.throws(() => firebaseConfigFromEnv({}), /VITE_FIREBASE_API_KEY/);
  const env = Object.fromEntries(['API_KEY','AUTH_DOMAIN','DATABASE_URL','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID'].map(key => [`VITE_FIREBASE_${key}`, ' fixture ']));
  assert.equal(firebaseConfigFromEnv(env).projectId, 'fixture');
  delete env.VITE_FIREBASE_PROJECT_ID;
  assert.throws(() => firebaseConfigFromEnv(env), /VITE_FIREBASE_PROJECT_ID/);
});
