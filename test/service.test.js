import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/service.js';
import { quizOf, setup } from './helpers.js';

async function withStudent() {
  const ctx = await setup();
  const student = await ctx.service.createStudent({ name: 'Test Student', grade: 4 });
  return { ...ctx, student };
}

test('a student works through lessons, then masters a skill with quiz answers', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);

  let next = await service.nextFor(student.id);
  assert.equal(next.skill.id, 'm-counting');
  assert.equal(next.activity.type, 'video');

  next = await service.complete(session.id, next.activity.id);
  assert.equal(next.activity.type, 'quiz');

  const quiz = quizOf('m-counting');
  for (let i = 0; i < 4; i++) {
    const index = i % quiz.questions.length;
    const res = await service.answer(session.id, {
      activityId: quiz.id,
      choice: quiz.questions[index].answer,
      questionIndex: index,
    });
    assert.equal(res.correct, true);
  }

  assert.notEqual((await service.nextFor(student.id)).skill.id, 'm-counting');
  const report = await service.report(student.id);
  assert.equal(report.skills.find((s) => s.id === 'm-counting').mastered, true);
});

test('a locked skill cannot be answered', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);
  await assert.rejects(
    service.answer(session.id, { activityId: 'm-addition-quiz', choice: 0 }),
    (err) => err instanceof HttpError && err.status === 409,
  );
});

test('a stale question index is rejected', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);
  await service.complete(session.id, 'm-counting-lesson');
  await assert.rejects(
    service.answer(session.id, { activityId: 'm-counting-quiz', choice: 0, questionIndex: 2 }),
    (err) => err.status === 409,
  );
});

test('heartbeats are clamped and feed the waste meter and roster', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);

  const first = await service.heartbeat(session.id, { activeSeconds: 1e6, idleSeconds: -5 });
  assert.equal(first.activeSeconds, 60);
  assert.equal(first.idleSeconds, 0);

  const status = await service.heartbeat(session.id, { activeSeconds: 0, idleSeconds: 60 });
  assert.equal(status.level, 'alert');

  const [row] = await service.roster();
  assert.equal(row.session.level, 'alert');
  assert.equal(row.currentSkill, 'Counting to 100');
});

test('ended sessions reject further activity', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);
  await service.endSession(session.id);
  await assert.rejects(service.heartbeat(session.id, { activeSeconds: 15 }), (err) => err.status === 409);
});

test('starting a new session ends the previous one', async () => {
  const { service, student } = await withStudent();
  const first = await service.startSession(student.id);
  await service.startSession(student.id);
  await assert.rejects(service.heartbeat(first.id, { activeSeconds: 15 }), (err) => err.status === 409);
});

test('student input is validated', async () => {
  const { service } = await setup();
  await assert.rejects(service.createStudent({ name: '  ', grade: 4 }), (err) => err.status === 400);
  await assert.rejects(service.createStudent({ name: 'X', grade: 13 }), (err) => err.status === 400);
});

test('resetting a student clears progress', async () => {
  const { service, student } = await withStudent();
  const session = await service.startSession(student.id);
  await service.complete(session.id, 'm-counting-lesson');
  await service.resetStudent(student.id);
  assert.equal((await service.nextFor(student.id)).activity.id, 'm-counting-lesson');
});

test('admins can add a skill that becomes available to students', async () => {
  const { service, student } = await withStudent();
  await service.saveSkill('s-states', {
    name: 'States of matter',
    subject: 'Science',
    prereqs: [],
    activities: [
      { id: 's-states-quiz', type: 'quiz', title: 'Check', minutes: 5, questions: [{ id: 's-states-q1', prompt: 'Which has a fixed shape?', choices: ['Solid', 'Gas'], answer: 0 }] },
    ],
  });
  const content = await service.publicContent();
  assert.ok(content.some((s) => s.id === 's-states'));
  assert.equal(JSON.stringify(content).includes('"answer"'), false);
  assert.ok((await service.report(student.id)).skills.some((s) => s.id === 's-states'));
});

test('invalid skills are rejected with the reason', async () => {
  const { service } = await setup();
  await assert.rejects(
    service.saveSkill('loop', { name: 'Loop', subject: 'Math', prereqs: ['loop'], activities: [] }),
    (err) => err.status === 400 && /quiz|loop/.test(err.message),
  );
});

test('a skill that others depend on cannot be deleted', async () => {
  const { service } = await setup();
  await assert.rejects(service.deleteSkill('m-counting'), (err) => err.status === 409 && /Addition/.test(err.message));
  assert.deepEqual(await service.deleteSkill('m-fractions'), { ok: true });
});
