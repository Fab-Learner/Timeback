import { round } from './util.js';

// A skill is mastered once a student has answered enough quiz questions
// and their running score clears the bar.
export const MASTERY_SCORE = 0.8;
export const MASTERY_MIN_ATTEMPTS = 4;
const LEARNING_RATE = 0.4;

export const scoreOf = (mastery, skillId) => mastery.get(skillId) ?? { score: 0, attempts: 0 };

export function updateScore({ score, attempts }, correct) {
  const next = score + ((correct ? 1 : 0) - score) * LEARNING_RATE;
  return { score: round(next, 3), attempts: attempts + 1 };
}

export function isMastered({ score, attempts }) {
  return attempts >= MASTERY_MIN_ATTEMPTS && score >= MASTERY_SCORE;
}

// A skill is open when it is not yet mastered and every prerequisite is.
export function isEligible(skill, mastery) {
  if (isMastered(scoreOf(mastery, skill.id))) return false;
  return skill.prereqs.every((id) => isMastered(scoreOf(mastery, id)));
}

// Choose the next activity: the weakest open skill, its unfinished
// lessons first, then its quiz (which is always available to retake).
export function selectNext(skills, mastery, completed) {
  const open = skills.filter((skill) => isEligible(skill, mastery));
  if (open.length === 0) return null;

  const skill = open.reduce((weakest, s) =>
    scoreOf(mastery, s.id).score < scoreOf(mastery, weakest.id).score ? s : weakest,
  );

  const lesson = skill.activities.find((a) => a.type !== 'quiz' && !completed.has(a.id));
  const activity = lesson ?? skill.activities.find((a) => a.type === 'quiz');
  return { skill, activity };
}
