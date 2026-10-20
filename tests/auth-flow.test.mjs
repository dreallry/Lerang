import test from 'node:test';
import assert from 'node:assert/strict';
import { authPageDestination, readEmailAction, appLoginUrl } from '../src/utils/authFlow.ts';

test('signed-in users cannot reopen login or registration, including admin deep links', () => {
  for (const page of ['login', 'register']) {
    assert.equal(authPageDestination(page, 'authenticated', 'masyarakat'), 'catalog');
    assert.equal(authPageDestination(page, 'authenticated', 'administrator'), 'admin-dashboard');
    assert.equal(authPageDestination(page, 'authenticated', 'petugas'), 'admin-dashboard');
    assert.equal(authPageDestination(page, 'loading', 'masyarakat'), null);
    assert.equal(authPageDestination(page, 'guest', 'masyarakat'), null);
  }
});

test('a Google user without an application profile can complete registration', () => {
  assert.equal(authPageDestination('login', 'profile-required', 'masyarakat'), 'register');
  assert.equal(authPageDestination('register', 'profile-required', 'masyarakat'), null);
  assert.equal(authPageDestination('auth-action', 'authenticated', 'masyarakat'), null);
});

test('email action parameters work on standalone pages and app hash routes', () => {
  assert.deepEqual(readEmailAction('https://accounts.example/?mode=resetPassword&oobCode=fixture&apiKey=untrusted'), {mode:'resetPassword',code:'fixture'});
  assert.deepEqual(readEmailAction('http://localhost:5173/#auth-action?mode=verifyEmail&oobCode=fixture'), {mode:'verifyEmail',code:'fixture'});
});

test('return links use only the configured app, without forwarding action codes', () => {
  assert.equal(appLoginUrl('http://localhost:5173/?oobCode=fixture#catalog'), 'http://localhost:5173/#login');
  assert.equal(appLoginUrl('https://auction.example/portal/'), 'https://auction.example/portal/#login');
  for (const value of ['javascript:alert(1)', 'http://attacker.example', 'https://user:secret@auction.example']) assert.throws(() => appLoginUrl(value));
});
