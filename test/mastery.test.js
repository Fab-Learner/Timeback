import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMastered, selectNext, updateScore } from '../src/mastery.js';

test('an unbroken run of correct answers reaches mastery after four attempts', () => {
  let m = { score: 0, attempts: 0 };
  for (let i = 0; i < 3; i++) m = updateScore(m, true);
  assert.equal(isMastered(m), false, 'three attempts are not enough');
  m = updateScore(m, true);
  assert.equal(isMastered(m), true);
});

test('a wrong answer lowers a high score', () => {
  const next = updateScore({ score: 0.8, attempts: 4 }, false);
  assert.ok(next.score < 0.8);
  assert.equal(next.attempts, 5);
});

const skills = [
  {
    id: 'a',
    name: 'A',
    prereqs: [],
    activities: [
      { id: 'a-read', type: 'reading' },
      { id: 'a-quiz', type: 'quiz' },
    ],
  },
  {
    id: 'b',
    name: 'B',
    prereqs: ['a'],
    activities: [
      { id: 'b-read', type: 'reading' },
      { id: 'b-quiz', type: 'quiz' },
    ],
  },
];

test('selectNext starts with a skill that has no prerequisites', () => {
  const pick = selectNext(skills, new Map(), new Set());
  assert.equal(pick.skill.id, 'a');
  assert.equal(pick.activity.id, 'a-read');
});

test('selectNext unlocks the next skill once its prerequisite is mastered', () => {
  const mastery = new Map([['a', { score: 0.9, attempts: 5 }]]);
  const pick = selectNext(skills, mastery, new Set(['a-read']));
  assert.equal(pick.skill.id, 'b');
  assert.equal(pick.activity.id, 'b-read');
});

test('selectNext offers the quiz once a skill’s lessons are complete', () => {
  const pick = selectNext(skills, new Map(), new Set(['a-read']));
  assert.equal(pick.activity.id, 'a-quiz');
});

test('selectNext prefers the lowest-scoring open skill', () => {
  const open = [
    { id: 'x', name: 'X', prereqs: [], activities: [{ id: 'x-quiz', type: 'quiz' }] },
    { id: 'y', name: 'Y', prereqs: [], activities: [{ id: 'y-quiz', type: 'quiz' }] },
  ];
  const mastery = new Map([
    ['x', { score: 0.5, attempts: 2 }],
    ['y', { score: 0.2, attempts: 2 }],
  ]);
  assert.equal(selectNext(open, mastery, new Set()).skill.id, 'y');
});

test('selectNext returns null when every skill is mastered', () => {
  const mastery = new Map([
    ['a', { score: 0.95, attempts: 6 }],
    ['b', { score: 0.95, attempts: 6 }],
  ]);
  assert.equal(selectNext(skills, mastery, new Set()), null);
});
