import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { loadContent } from '../src/content.js';
import subjects from '../content/index.js';
import { createService } from '../src/service.js';
import { createApi } from '../src/api.js';
import { createHttpServer } from '../src/http.js';

const content = loadContent(subjects);
const service = createService({ db: openDb(':memory:'), content, coach: async () => 'hint' });
const server = createHttpServer({
  api: createApi(service),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test('serves the content catalogue without answer keys', async () => {
  const res = await fetch(`${base}/api/content`);
  assert.equal(res.status, 200);
  const skills = await res.json();
  assert.ok(skills.length >= 5);
  const text = JSON.stringify(skills);
  assert.equal(text.includes('"answer"'), false);
});

test('creates a student and runs a session over HTTP', async () => {
  const create = await fetch(`${base}/api/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'HTTP Kid', grade: 3 }),
  });
  assert.equal(create.status, 200);
  const student = await create.json();

  const start = await fetch(`${base}/api/students/${student.id}/sessions`, { method: 'POST' });
  const session = await start.json();
  assert.equal(session.budgetMinutes, 120);

  const beat = await fetch(`${base}/api/sessions/${session.id}/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ activeSeconds: 15, idleSeconds: 0 }),
  });
  assert.equal((await beat.json()).activeSeconds, 15);
});

test('returns JSON errors for bad input and unknown routes', async () => {
  const bad = await fetch(`${base}/api/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);

  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
});

test('serves static pages', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});
