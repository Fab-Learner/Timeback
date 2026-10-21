import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.js';
import { createFirestoreStore } from '../src/store/firestore.js';

// The same behaviour is required of every store. The Firestore run needs the
// emulator: npm run test:firestore
const stores = [['memory', () => createMemoryStore()]];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  let n = 0;
  stores.push(['firestore', () => createFirestoreStore({ projectId: 'demo-timeback', appName: `test-${++n}-${Date.now()}` })]);
}

for (const [name, make] of stores) {
  describe(`${name} store`, () => {
    test('creates, updates, resets and deletes students', async () => {
      const store = make();
      const s = await store.createStudent({ name: 'Zed Test', grade: 3 });
      assert.equal((await store.getStudent(s.id)).name, 'Zed Test');

      await store.updateStudent(s.id, { name: 'Zed Renamed', grade: 4 });
      await store.markCompleted(s.id, 'lesson-1');
      await store.recordAnswer(s.id, { expectedCount: 0, activityId: 'quiz-1', skillId: 'skill-1', mastery: { score: 0.4, attempts: 1 }, log: { at: 'now' } });
      let stored = await store.getStudent(s.id);
      assert.equal(stored.name, 'Zed Renamed');
      assert.deepEqual(stored.completed, ['lesson-1']);
      assert.equal(stored.answered['quiz-1'], 1);

      await store.resetStudent(s.id);
      stored = await store.getStudent(s.id);
      assert.deepEqual(stored.mastery, {});
      assert.deepEqual(stored.completed, []);

      assert.equal(await store.deleteStudent(s.id), true);
      assert.equal(await store.getStudent(s.id), null);
      assert.equal(await store.updateStudent(s.id, { name: 'x' }), null);
    });

    test('rejects an answer recorded against a stale count', async () => {
      const store = make();
      const s = await store.createStudent({ name: 'Race Test', grade: 3 });
      const answer = { activityId: 'q', skillId: 'k', mastery: { score: 0.4, attempts: 1 }, log: { at: 'now' } };
      assert.equal(await store.recordAnswer(s.id, { ...answer, expectedCount: 0 }), true);
      assert.equal(await store.recordAnswer(s.id, { ...answer, expectedCount: 0 }), false);
    });

    test('a new session ends the previous one and heartbeats accumulate', async () => {
      const store = make();
      const s = await store.createStudent({ name: 'Session Test', grade: 3 });
      const first = await store.startSession(s.id, '2026-01-01T10:00:00.000Z');
      const second = await store.startSession(s.id, '2026-01-01T11:00:00.000Z');
      assert.equal((await store.getSession(first.id)).endedAt, '2026-01-01T11:00:00.000Z');
      assert.equal((await store.getStudent(s.id)).lastSessionId, second.id);

      await store.addHeartbeat(second.id, 15, 0);
      const updated = await store.addHeartbeat(second.id, 0, 15);
      assert.equal(updated.activeSeconds, 15);
      assert.equal(updated.idleSeconds, 15);

      const sessions = await store.listSessions(s.id, 10);
      assert.deepEqual(sessions.map((x) => x.id), [second.id, first.id]);

      await store.deleteStudent(s.id);
      assert.equal(await store.getSession(first.id), null);
    });

    test('stores users, codes and skills', async () => {
      const store = make();
      await store.saveUser({ email: 'g@school.test', name: 'G', role: 'guide' });
      assert.equal((await store.getUser('g@school.test')).role, 'guide');
      await store.deleteUser('g@school.test');
      assert.equal(await store.getUser('g@school.test'), null);

      await store.saveOtp('g@school.test', { hash: 'h', attempts: 0 });
      await store.bumpOtpAttempts('g@school.test');
      assert.equal((await store.getOtp('g@school.test')).attempts, 1);
      await store.deleteOtp('g@school.test');
      assert.equal(await store.getOtp('g@school.test'), null);

      await store.saveSkill({ id: 'zz-store-test', name: 'Z', subject: 'S', order: 999, prereqs: [], activities: [] });
      assert.ok((await store.listSkills()).some((k) => k.id === 'zz-store-test'));
      await store.deleteSkill('zz-store-test');
      assert.ok(!(await store.listSkills()).some((k) => k.id === 'zz-store-test'));
    });
  });
}
