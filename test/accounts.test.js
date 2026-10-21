import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TTL_MS, DAILY_SENDS, MAX_ATTEMPTS, RESEND_MS } from '../src/accounts.js';
import { setup } from './helpers.js';

function fakeClock(start = Date.parse('2026-10-21T08:00:00Z')) {
  let t = start;
  const clock = () => new Date(t);
  clock.advance = (ms) => (t += ms);
  return clock;
}

test('an admin from settings can sign in with an emailed code', async () => {
  const { accounts, inbox } = await setup();
  await accounts.requestCode('Admin@School.test ');
  const code = inbox.lastCodeFor('admin@school.test');
  assert.match(code, /^\d{6}$/);

  const { user, token } = await accounts.verifyCode('admin@school.test', code);
  assert.equal(user.role, 'admin');
  assert.equal((await accounts.userFromToken(token)).email, 'admin@school.test');
});

test('unknown emails get no code and no error', async () => {
  const { accounts, inbox } = await setup();
  await accounts.requestCode('stranger@example.com');
  assert.equal(inbox.sent.length, 0);
});

test('a code works once', async () => {
  const { accounts, inbox } = await setup();
  await accounts.requestCode('admin@school.test');
  const code = inbox.lastCodeFor('admin@school.test');
  await accounts.verifyCode('admin@school.test', code);
  await assert.rejects(accounts.verifyCode('admin@school.test', code), (err) => err.status === 401);
});

test('codes expire', async () => {
  const clock = fakeClock();
  const { accounts, inbox } = await setup({ clock });
  await accounts.requestCode('admin@school.test');
  clock.advance(CODE_TTL_MS + 1);
  await assert.rejects(accounts.verifyCode('admin@school.test', inbox.lastCodeFor('admin@school.test')), (err) => err.status === 401);
});

test('too many wrong tries lock the code', async () => {
  const { accounts, inbox } = await setup();
  await accounts.requestCode('admin@school.test');
  const code = inbox.lastCodeFor('admin@school.test');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await assert.rejects(accounts.verifyCode('admin@school.test', wrong), (err) => err.status === 401);
  }
  await assert.rejects(accounts.verifyCode('admin@school.test', code), (err) => err.status === 401);
});

test('codes are throttled per minute and per day', async () => {
  const clock = fakeClock();
  const { accounts, inbox } = await setup({ clock });
  await accounts.requestCode('admin@school.test');
  await accounts.requestCode('admin@school.test');
  assert.equal(inbox.sent.length, 1);

  for (let i = 1; i < DAILY_SENDS + 3; i++) {
    clock.advance(RESEND_MS);
    await accounts.requestCode('admin@school.test');
  }
  assert.equal(inbox.sent.length, DAILY_SENDS);
});

test('tampered and expired tokens are rejected', async () => {
  const clock = fakeClock();
  const { accounts, inbox } = await setup({ clock });
  await accounts.requestCode('admin@school.test');
  const { token } = await accounts.verifyCode('admin@school.test', inbox.lastCodeFor('admin@school.test'));

  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'admin@school.test', exp: Date.now() * 2 })).toString('base64url');
  assert.equal(await accounts.userFromToken(`${forged}.${sig}`), null);
  assert.equal(await accounts.userFromToken(`${body}.x${sig}`), null);

  clock.advance(8 * 24 * 60 * 60_000);
  assert.equal(await accounts.userFromToken(token), null);
});

test('removing a guide ends their access immediately', async () => {
  const { accounts, inbox } = await setup();
  await accounts.saveUser('guide@school.test', { name: 'Gia', role: 'guide' });
  await accounts.requestCode('guide@school.test');
  const { user, token } = await accounts.verifyCode('guide@school.test', inbox.lastCodeFor('guide@school.test'));
  assert.equal(user.role, 'guide');

  await accounts.deleteUser('guide@school.test', 'admin@school.test');
  assert.equal(await accounts.userFromToken(token), null);
});

test('admins cannot remove themselves or settings admins', async () => {
  const { accounts } = await setup();
  await accounts.saveUser('other@school.test', { role: 'admin' });
  await assert.rejects(accounts.deleteUser('other@school.test', 'other@school.test'), /yourself/);
  await assert.rejects(accounts.deleteUser('admin@school.test', 'other@school.test'), /ADMIN_EMAILS/);
});
