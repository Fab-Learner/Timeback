import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, ContentError } from '../src/content.js';
import { bundledSkills } from './helpers.js';

const quiz = (id) => ({
  id: `${id}-quiz`,
  type: 'quiz',
  title: 'Check',
  minutes: 5,
  questions: [{ id: `${id}-q1`, prompt: 'Pick one', choices: ['a', 'b'], answer: 0 }],
});
const skill = (id, prereqs = [], extra = {}) => ({ id, name: id, subject: 'Math', order: 0, prereqs, activities: [quiz(id)], ...extra });

test('the bundled lessons are valid', () => {
  const content = buildContent(bundledSkills);
  assert.equal(content.skills.length, 8);
});

test('prerequisite loops are rejected', () => {
  assert.throws(() => buildContent([skill('a', ['b']), skill('b', ['a'])]), (err) => err instanceof ContentError && /loop/.test(err.message));
});

test('unknown prerequisites are rejected', () => {
  assert.throws(() => buildContent([skill('a', ['missing'])]), /unknown prereq/);
});

test('a skill without a quiz is rejected', () => {
  assert.throws(() => buildContent([skill('a', [], { activities: [] })]), /needs a quiz/);
});

test('an answer index outside the choices is rejected', () => {
  const bad = skill('a');
  bad.activities[0].questions[0].answer = 5;
  assert.throws(() => buildContent([bad]), /invalid answer index/);
});

test('ids must be URL-safe', () => {
  assert.throws(() => buildContent([skill('Has Spaces')]), /lowercase letters/);
});

test('video links must use https', () => {
  const s = skill('a');
  s.activities.unshift({ id: 'a-video', type: 'video', title: 'Watch', minutes: 5, url: 'http://example.com', body: [] });
  assert.throws(() => buildContent([s]), /https/);
});
