import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wasteReport } from '../src/waste.js';

test('the idle share sets the waste level', () => {
  assert.equal(wasteReport([{ active: 45, idle: 15 }]).level, 'watch');
  assert.equal(wasteReport([{ active: 20, idle: 40 }]).level, 'alert');
  assert.equal(wasteReport([{ active: 60, idle: 0 }]).level, 'ok');
});

test('very short sessions are not judged', () => {
  assert.equal(wasteReport([{ active: 0, idle: 30 }]).level, 'ok');
});

test('totals are summed across heartbeats', () => {
  const report = wasteReport([
    { active: 15, idle: 0 },
    { active: 0, idle: 15 },
    { active: 15, idle: 15 },
  ]);
  assert.equal(report.activeSeconds, 30);
  assert.equal(report.idleSeconds, 30);
  assert.equal(report.wastePct, 0.5);
});
