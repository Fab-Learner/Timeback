import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { loadContent } from '../src/content.js';
import subjects from '../content/index.js';
import { createService, HttpError } from '../src/service.js';

const content = loadContent(subjects);

function setup() {
  const db = openDb(':memory:');
  const service = createService({
    db,
    content,
    coach: async ({ correct }) => (correct ? 'Nice' : 'Try again'),
  });
  const student = service.createStudent({ name: 'Test Student', grade: 4 });
  return { service, student };
}

test('a student works through lessons, then masters a skill with quiz answers', async () => {
  const { service, student } = setup();
  const session = service.startSession(student.id);

  let next = service.nextFor(student.id);
  assert.equal(next.skill.id, 'm-counting');
  assert.equal(next.activity.type, 'video');

  next = service.complete(session.id, next.activity.id);
  assert.equal(next.activity.type, 'quiz');

  const quiz = content.activities.get('m-counting-quiz');
  for (let i = 0; i < 4; i++) {
    const index = i % quiz.questions.length;
    const res = await service.answer(session.id, {
      activityId: quiz.id,
      choice: quiz.questions[index].answer,
      questionIndex: index,
    });
    assert.equal(res.correct, true);
  }

  assert.notEqual(service.nextFor(student.id).skill.id, 'm-counting');
  const report = service.report(student.id);
  assert.equal(report.skills.find((s) => s.id === 'm-counting').mastered, true);
});

test('a locked skill cannot be answered', async () => {
  const { service, student } = setup();
  const session = service.startSession(student.id);
  await assert.rejects(
    service.answer(session.id, { activityId: 'm-addition-quiz', choice: 0 }),
    (err) => err instanceof HttpError && err.status === 409,
  );
});

test('a stale question index is rejected', async () => {
  const { service, student } = setup();
  const session = service.startSession(student.id);
  service.complete(session.id, 'm-counting-lesson');
  await assert.rejects(
    service.answer(session.id, { activityId: 'm-counting-quiz', choice: 0, questionIndex: 2 }),
    (err) => err.status === 409,
  );
});

test('heartbeats are clamped and feed the waste meter and roster', () => {
  const { service, student } = setup();
  const session = service.startSession(student.id);

  const first = service.heartbeat(session.id, { activeSeconds: 1e6, idleSeconds: -5 });
  assert.equal(first.activeSeconds, 60);
  assert.equal(first.idleSeconds, 0);

  const status = service.heartbeat(session.id, { activeSeconds: 0, idleSeconds: 60 });
  assert.equal(status.level, 'alert');

  const [row] = service.roster();
  assert.equal(row.session.level, 'alert');
  assert.equal(row.currentSkill, 'Counting to 100');
});

test('ended sessions reject further activity', () => {
  const { service, student } = setup();
  const session = service.startSession(student.id);
  service.endSession(session.id);
  assert.throws(() => service.heartbeat(session.id, { activeSeconds: 15 }), (err) => err.status === 409);
});

test('starting a new session ends the previous one', () => {
  const { service, student } = setup();
  const first = service.startSession(student.id);
  service.startSession(student.id);
  assert.throws(() => service.heartbeat(first.id, { activeSeconds: 15 }), (err) => err.status === 409);
});

test('createStudent validates its input', () => {
  const { service } = setup();
  assert.throws(() => service.createStudent({ name: '  ', grade: 4 }), (err) => err.status === 400);
  assert.throws(() => service.createStudent({ name: 'X', grade: 13 }), (err) => err.status === 400);
});
