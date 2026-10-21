import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApi } from '../src/api.js';
import { createHttpServer } from '../src/http.js';
import { setup } from './helpers.js';

const { service, accounts, inbox } = await setup();
await accounts.saveUser('guide@school.test', { name: 'Gia', role: 'guide' });
const server = createHttpServer({
  api: createApi({ service, accounts }),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const json = (method, body, cookie) => ({
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function signIn(email) {
  await fetch(`${base}/api/auth/request`, json('POST', { email }));
  const res = await fetch(`${base}/api/auth/verify`, json('POST', { email, code: inbox.lastCodeFor(email) }));
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  return cookie.split(';')[0];
}

const admin = await signIn('admin@school.test');
const guide = await signIn('guide@school.test');

test('student data requires sign-in', async () => {
  assert.equal((await fetch(`${base}/api/students`)).status, 401);
  assert.equal((await fetch(`${base}/api/students`, { headers: { cookie: guide } })).status, 200);
});

test('guides cannot use admin routes', async () => {
  const res = await fetch(`${base}/api/admin/students`, json('POST', { name: 'X', grade: 3 }, guide));
  assert.equal(res.status, 403);
});

test('an admin creates a student and a guide runs their session', async () => {
  const created = await fetch(`${base}/api/admin/students`, json('POST', { name: 'HTTP Kid', grade: 3 }, admin));
  assert.equal(created.status, 200);
  const student = await created.json();

  const session = await (await fetch(`${base}/api/students/${student.id}/sessions`, json('POST', {}, guide))).json();
  assert.equal(session.budgetMinutes, 120);

  const beat = await fetch(`${base}/api/sessions/${session.id}/heartbeat`, json('POST', { activeSeconds: 15, idleSeconds: 0 }, guide));
  assert.equal((await beat.json()).activeSeconds, 15);
});

test('admins manage staff', async () => {
  const saved = await fetch(`${base}/api/admin/users/${encodeURIComponent('new@school.test')}`, json('PUT', { name: 'New', role: 'guide' }, admin));
  assert.equal(saved.status, 200);
  const users = await (await fetch(`${base}/api/admin/users`, { headers: { cookie: admin } })).json();
  assert.ok(users.some((u) => u.email === 'new@school.test' && u.role === 'guide'));
});

test('the content catalogue has no answer keys', async () => {
  const skills = await (await fetch(`${base}/api/content`, { headers: { cookie: guide } })).json();
  assert.ok(skills.length >= 8);
  assert.equal(JSON.stringify(skills).includes('"answer"'), false);
});

test('state-changing requests must be JSON', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('sign-out clears the cookie', async () => {
  const res = await fetch(`${base}/api/auth/logout`, json('POST', {}, guide));
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('returns JSON errors and serves pages', async () => {
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
});
