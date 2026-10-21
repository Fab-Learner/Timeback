import { buildContent, ContentError } from './content.js';
import { isEligible, isMastered, scoreOf, selectNext, updateScore } from './mastery.js';
import { wasteReport } from './waste.js';
import { round } from './util.js';

export const SESSION_MINUTES = 120;
const MAX_BEAT_SECONDS = 60;
const CONTENT_TTL_MS = 30_000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// What a student's browser may see of an activity (no answer keys).
export function viewActivity(a) {
  const { id, type, title, minutes, body, url, skillId } = a;
  return { id, type, title, minutes, body: body ?? [], url: url ?? null, skillId };
}

function currentQuestion(activity, answeredCount) {
  const index = answeredCount % activity.questions.length;
  const q = activity.questions[index];
  return { index, total: activity.questions.length, id: q.id, prompt: q.prompt, choices: q.choices };
}

function clampSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BEAT_SECONDS) : 0;
}

function learnerState(student) {
  return {
    mastery: new Map(Object.entries(student.mastery ?? {})),
    completed: new Set(student.completed ?? []),
    answered: new Map(Object.entries(student.answered ?? {})),
  };
}

function cleanStudentInput({ name, grade }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length > 100) throw new HttpError(400, 'name is required (up to 100 characters)');
  if (!Number.isInteger(grade) || grade < 0 || grade > 12) throw new HttpError(400, 'grade must be 0-12');
  return { name: cleanName, grade };
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Shape admin input into a stored skill. Validation happens in buildContent.
function cleanSkillInput(id, input, order) {
  const activities = Array.isArray(input.activities) ? input.activities : [];
  return {
    id,
    name: text(input.name),
    subject: text(input.subject),
    order,
    prereqs: Array.isArray(input.prereqs) ? input.prereqs.map(String) : [],
    activities: activities.map((a) => {
      const base = { id: text(a.id), type: text(a.type), title: text(a.title), minutes: Number(a.minutes) > 0 ? Math.round(Number(a.minutes)) : 5 };
      if (base.type === 'quiz') {
        return {
          ...base,
          questions: (Array.isArray(a.questions) ? a.questions : []).map((q) => ({
            id: text(q.id),
            prompt: text(q.prompt),
            choices: (Array.isArray(q.choices) ? q.choices : []).map(text),
            answer: Number(q.answer),
            hint: text(q.hint) || null,
          })),
        };
      }
      return {
        ...base,
        url: text(a.url) || null,
        body: (Array.isArray(a.body) ? a.body : []).map(text).filter(Boolean),
      };
    }),
  };
}

export function createService({ store, coach, clock = () => new Date() }) {
  const now = () => clock().toISOString();
  let cache = null;
  let cachedAt = 0;

  async function content() {
    if (!cache || Date.now() - cachedAt > CONTENT_TTL_MS) {
      cache = buildContent(await store.listSkills());
      cachedAt = Date.now();
    }
    return cache;
  }

  async function requireStudent(id) {
    const student = await store.getStudent(id);
    if (!student) throw new HttpError(404, 'student not found');
    return student;
  }

  async function openSession(id) {
    const session = await store.getSession(id);
    if (!session) throw new HttpError(404, 'session not found');
    if (session.endedAt) throw new HttpError(409, 'session has ended');
    return session;
  }

  function sessionStatus(session) {
    const waste = wasteReport([{ active: session.activeSeconds, idle: session.idleSeconds }]);
    const minutesUsed = waste.totalSeconds / 60;
    return {
      id: session.id,
      studentId: session.studentId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      budgetMinutes: SESSION_MINUTES,
      minutesUsed: round(minutesUsed, 1),
      minutesRemaining: round(Math.max(0, SESSION_MINUTES - minutesUsed), 1),
      ...waste,
    };
  }

  async function nextForStudent(student) {
    const c = await content();
    const { mastery, completed, answered } = learnerState(student);
    const pick = selectNext(c.skills, mastery, completed);
    if (!pick) return { done: true, skill: null, activity: null, question: null };

    const { skill, activity } = pick;
    const m = scoreOf(mastery, skill.id);
    return {
      done: false,
      skill: { id: skill.id, name: skill.name, subject: skill.subject, score: m.score, attempts: m.attempts },
      activity: viewActivity(activity),
      question: activity.type === 'quiz' ? currentQuestion(activity, answered.get(activity.id) ?? 0) : null,
    };
  }

  // --- Learning ---------------------------------------------------------------

  async function nextFor(studentId) {
    return nextForStudent(await requireStudent(studentId));
  }

  async function answer(sessionId, { activityId, choice, questionIndex }) {
    const session = await openSession(sessionId);
    const c = await content();
    const activity = c.activities.get(activityId);
    if (activity?.type !== 'quiz') throw new HttpError(400, 'not a quiz activity');

    const student = await requireStudent(session.studentId);
    const skill = c.skillMap.get(activity.skillId);
    const { mastery, answered } = learnerState(student);
    if (!isEligible(skill, mastery)) throw new HttpError(409, 'skill is not available');

    const count = answered.get(activity.id) ?? 0;
    const index = count % activity.questions.length;
    if (questionIndex !== undefined && questionIndex !== index) {
      throw new HttpError(409, 'question has changed');
    }
    const q = activity.questions[index];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) {
      throw new HttpError(400, 'invalid choice');
    }

    const correct = choice === q.answer;
    const next = updateScore(scoreOf(mastery, skill.id), correct);
    const recorded = await store.recordAnswer(student.id, {
      expectedCount: count,
      activityId: activity.id,
      skillId: skill.id,
      mastery: next,
      log: { sessionId: session.id, questionId: q.id, choice, correct, at: now() },
    });
    if (!recorded) throw new HttpError(409, 'question has changed');

    const mastered = isMastered(next);
    const feedback = await coach({ skill, question: q, choice, correct, mastered });
    return {
      correct,
      correctIndex: q.answer,
      feedback,
      skill: { id: skill.id, name: skill.name, score: next.score, attempts: next.attempts, mastered },
    };
  }

  async function complete(sessionId, activityId) {
    const session = await openSession(sessionId);
    const c = await content();
    const activity = c.activities.get(activityId);
    if (!activity) throw new HttpError(404, 'activity not found');
    if (activity.type === 'quiz') throw new HttpError(400, 'quizzes are completed by answering questions');

    const student = await requireStudent(session.studentId);
    if (!isEligible(c.skillMap.get(activity.skillId), learnerState(student).mastery)) {
      throw new HttpError(409, 'skill is not available');
    }
    await store.markCompleted(student.id, activity.id);
    return nextFor(student.id);
  }

  async function heartbeat(sessionId, { activeSeconds, idleSeconds }) {
    const session = await openSession(sessionId);
    return sessionStatus(await store.addHeartbeat(session.id, clampSeconds(activeSeconds), clampSeconds(idleSeconds)));
  }

  async function startSession(studentId) {
    await requireStudent(studentId);
    return sessionStatus(await store.startSession(studentId, now()));
  }

  async function endSession(sessionId) {
    const session = await openSession(sessionId);
    return sessionStatus(await store.endSession(session.id, now()));
  }

  // --- Reporting --------------------------------------------------------------

  async function listStudents() {
    return (await store.listStudents()).map(({ id, name, grade }) => ({ id, name, grade }));
  }

  async function publicContent() {
    return (await content()).skills.map((s) => ({
      id: s.id,
      name: s.name,
      subject: s.subject,
      prereqs: s.prereqs,
      activities: s.activities.map(viewActivity),
    }));
  }

  async function report(studentId) {
    const student = await requireStudent(studentId);
    const c = await content();
    const { mastery } = learnerState(student);
    const skills = c.skills.map((s) => {
      const m = scoreOf(mastery, s.id);
      return { id: s.id, name: s.name, subject: s.subject, score: m.score, attempts: m.attempts, mastered: isMastered(m) };
    });
    const sessions = (await store.listSessions(student.id, 10)).map(sessionStatus);
    return {
      student: { id: student.id, name: student.name, grade: student.grade },
      skills,
      sessions,
      next: await nextForStudent(student),
    };
  }

  async function roster() {
    const c = await content();
    const students = await store.listStudents();
    return Promise.all(
      students.map(async (s) => {
        const { mastery } = learnerState(s);
        const last = s.lastSessionId ? await store.getSession(s.lastSessionId) : null;
        const next = await nextForStudent(s);
        return {
          id: s.id,
          name: s.name,
          grade: s.grade,
          masteredSkills: c.skills.filter((k) => isMastered(scoreOf(mastery, k.id))).length,
          totalSkills: c.skills.length,
          currentSkill: next.skill?.name ?? null,
          done: next.done,
          session: last ? sessionStatus(last) : null,
        };
      }),
    );
  }

  // --- Admin: students --------------------------------------------------------

  async function createStudent(input) {
    const { id, name, grade } = await store.createStudent(cleanStudentInput(input));
    return { id, name, grade };
  }

  async function updateStudent(id, input) {
    const updated = await store.updateStudent(id, cleanStudentInput(input));
    if (!updated) throw new HttpError(404, 'student not found');
    return { id: updated.id, name: updated.name, grade: updated.grade };
  }

  async function deleteStudent(id) {
    if (!(await store.deleteStudent(id))) throw new HttpError(404, 'student not found');
    return { ok: true };
  }

  async function resetStudent(id) {
    if (!(await store.resetStudent(id))) throw new HttpError(404, 'student not found');
    return { ok: true };
  }

  // --- Admin: lessons and quizzes ---------------------------------------------

  async function adminSkills() {
    return (await store.listSkills()).map(({ id, name, subject, order, prereqs, activities }) => ({
      id,
      name,
      subject,
      order,
      prereqs,
      activities,
    }));
  }

  async function saveSkill(id, input) {
    const existing = await store.listSkills();
    const current = existing.find((s) => s.id === id);
    const order = current?.order ?? existing.reduce((max, s) => Math.max(max, s.order + 1), 0);
    const skill = cleanSkillInput(id, input ?? {}, order);
    try {
      buildContent([...existing.filter((s) => s.id !== id), skill]);
    } catch (err) {
      if (err instanceof ContentError) throw new HttpError(400, err.message);
      throw err;
    }
    await store.saveSkill(skill);
    cache = null;
    return skill;
  }

  async function deleteSkill(id) {
    const existing = await store.listSkills();
    if (!existing.some((s) => s.id === id)) throw new HttpError(404, 'skill not found');
    const dependents = existing.filter((s) => s.prereqs.includes(id)).map((s) => s.name);
    if (dependents.length) {
      throw new HttpError(409, `remove it as a prerequisite first: ${dependents.join(', ')}`);
    }
    await store.deleteSkill(id);
    cache = null;
    return { ok: true };
  }

  return {
    publicContent,
    listStudents,
    nextFor,
    startSession,
    endSession,
    heartbeat,
    complete,
    answer,
    report,
    roster,
    createStudent,
    updateStudent,
    deleteStudent,
    resetStudent,
    adminSkills,
    saveSkill,
    deleteSkill,
  };
}

// Load the bundled lessons into an empty store. Safe to run on every start:
// it only writes when there are no skills yet.
export async function seedSkills(store, skills) {
  if ((await store.listSkills()).length > 0) return false;
  buildContent(skills);
  for (const skill of skills) await store.saveSkill(skill);
  return true;
}
