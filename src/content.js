// Skills are stored as a flat list. Each skill has a subject, an order, its
// prerequisites, and its activities (lessons and at least one quiz).
// buildContent validates the whole set and indexes it.

export class ContentError extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTIVITY_TYPES = new Set(['video', 'reading', 'quiz']);

function check(condition, message) {
  if (!condition) throw new ContentError(message);
}

function validateActivity(skillId, a) {
  check(typeof a.id === 'string' && ID_PATTERN.test(a.id), `activity id "${a.id}" in ${skillId} must be lowercase letters, digits and dashes`);
  check(ACTIVITY_TYPES.has(a.type), `activity ${a.id} has unknown type "${a.type}"`);
  check(typeof a.title === 'string' && a.title.trim(), `activity ${a.id} needs a title`);
  if (a.url) check(/^https:\/\//.test(a.url), `activity ${a.id} video URL must start with https://`);
  if (a.type !== 'quiz') return;

  check(Array.isArray(a.questions) && a.questions.length > 0, `quiz ${a.id} needs at least one question`);
  for (const q of a.questions) {
    check(typeof q.id === 'string' && ID_PATTERN.test(q.id), `question id "${q.id}" in ${a.id} is invalid`);
    check(typeof q.prompt === 'string' && q.prompt.trim(), `question ${q.id} needs a prompt`);
    check(Array.isArray(q.choices) && q.choices.length >= 2, `question ${q.id} needs at least two choices`);
    check(q.choices.every((c) => typeof c === 'string' && c.trim()), `question ${q.id} has an empty choice`);
    check(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length, `question ${q.id} has an invalid answer index`);
  }
}

function checkNoCycles(skills, skillMap) {
  const state = new Map(); // id -> 'visiting' | 'done'
  const visit = (id, path) => {
    if (state.get(id) === 'done') return;
    check(state.get(id) !== 'visiting', `prerequisites form a loop: ${[...path, id].join(' -> ')}`);
    state.set(id, 'visiting');
    for (const p of skillMap.get(id).prereqs) visit(p, [...path, id]);
    state.set(id, 'done');
  };
  for (const s of skills) visit(s.id, []);
}

export function buildContent(skillList) {
  const skills = [];
  const skillMap = new Map();
  const activities = new Map();
  const questionIds = new Set();

  const sorted = [...skillList].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const skill of sorted) {
    check(typeof skill.id === 'string' && ID_PATTERN.test(skill.id), `skill id "${skill.id}" must be lowercase letters, digits and dashes`);
    check(!skillMap.has(skill.id), `duplicate skill ${skill.id}`);
    check(typeof skill.name === 'string' && skill.name.trim(), `skill ${skill.id} needs a name`);
    check(typeof skill.subject === 'string' && skill.subject.trim(), `skill ${skill.id} needs a subject`);

    const entry = {
      id: skill.id,
      name: skill.name,
      subject: skill.subject,
      order: skill.order ?? 0,
      prereqs: skill.prereqs ?? [],
      activities: (skill.activities ?? []).map((a) => ({ ...a, skillId: skill.id })),
    };
    check(entry.activities.some((a) => a.type === 'quiz'), `skill ${skill.id} needs a quiz`);
    for (const activity of entry.activities) {
      validateActivity(skill.id, activity);
      check(!activities.has(activity.id), `duplicate activity ${activity.id}`);
      activities.set(activity.id, activity);
      for (const q of activity.questions ?? []) {
        check(!questionIds.has(q.id), `duplicate question ${q.id}`);
        questionIds.add(q.id);
      }
    }
    skills.push(entry);
    skillMap.set(entry.id, entry);
  }

  for (const skill of skills) {
    for (const prereq of skill.prereqs) {
      check(skillMap.has(prereq), `${skill.id} has unknown prereq ${prereq}`);
    }
  }
  checkNoCycles(skills, skillMap);

  return { skills, skillMap, activities };
}

// Flatten the bundled subject files (content/*.json) into stored skills.
export function skillsFromSubjects(subjects) {
  let order = 0;
  return subjects.flatMap((subject) =>
    subject.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      subject: subject.subject,
      order: order++,
      prereqs: skill.prereqs ?? [],
      activities: skill.activities,
    })),
  );
}
