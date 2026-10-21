import { isEligible, isMastered, scoreOf, selectNext, updateScore } from './mastery.js';
import { wasteReport } from './waste.js';
import { round } from './util.js';

export const SESSION_MINUTES = 120;
const MAX_BEAT_SECONDS = 60;

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

export function createService({ db, content, coach, clock = () => new Date() }) {
  const now = () => clock().toISOString();
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  function studentRow(id) {
    const row = get('SELECT id, name, grade FROM students WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'student not found');
    return row;
  }

  function sessionRow(id) {
    const row = get(
      'SELECT id, student_id AS studentId, started_at AS startedAt, ended_at AS endedAt FROM sessions WHERE id = ?',
      id,
    );
    if (!row) throw new HttpError(404, 'session not found');
    return row;
  }

  function openSession(id) {
    const row = sessionRow(id);
    if (row.endedAt) throw new HttpError(409, 'session has ended');
    return row;
  }

  function snapshot(studentId) {
    const mastery = new Map(
      all('SELECT skill_id, score, attempts FROM mastery WHERE student_id = ?', studentId).map((r) => [
        r.skill_id,
        { score: r.score, attempts: r.attempts },
      ]),
    );
    const completed = new Set(
      all('SELECT activity_id FROM progress WHERE student_id = ?', studentId).map((r) => r.activity_id),
    );
    const answered = new Map(
      all(
        'SELECT activity_id, COUNT(*) AS n FROM answers WHERE student_id = ? GROUP BY activity_id',
        studentId,
      ).map((r) => [r.activity_id, r.n]),
    );
    return { mastery, completed, answered };
  }

  function sessionStatus(session) {
    const beats = all(
      'SELECT active_seconds AS active, idle_seconds AS idle FROM heartbeats WHERE session_id = ?',
      session.id,
    );
    const waste = wasteReport(beats);
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

  function nextFor(studentId) {
    const { mastery, completed, answered } = snapshot(studentId);
    const pick = selectNext(content.skills, mastery, completed);
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

  async function answer(sessionId, { activityId, choice, questionIndex }) {
    const session = openSession(sessionId);
    const activity = content.activities.get(activityId);
    if (activity?.type !== 'quiz') throw new HttpError(400, 'not a quiz activity');

    const skill = content.skillMap.get(activity.skillId);
    const { mastery, answered } = snapshot(session.studentId);
    if (!isEligible(skill, mastery)) throw new HttpError(409, 'skill is not available');

    const index = (answered.get(activity.id) ?? 0) % activity.questions.length;
    if (questionIndex !== undefined && questionIndex !== index) {
      throw new HttpError(409, 'question has changed');
    }
    const q = activity.questions[index];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) {
      throw new HttpError(400, 'invalid choice');
    }

    const correct = choice === q.answer;
    const next = updateScore(scoreOf(mastery, skill.id), correct);
    db.exec('BEGIN');
    try {
      run(
        'INSERT INTO answers (student_id, session_id, activity_id, question_id, choice, correct, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        session.studentId,
        session.id,
        activity.id,
        q.id,
        choice,
        correct ? 1 : 0,
        now(),
      );
      run(
        `INSERT INTO mastery (student_id, skill_id, score, attempts) VALUES (?, ?, ?, ?)
         ON CONFLICT (student_id, skill_id) DO UPDATE SET score = excluded.score, attempts = excluded.attempts`,
        session.studentId,
        skill.id,
        next.score,
        next.attempts,
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const mastered = isMastered(next);
    const feedback = await coach({ skill, question: q, choice, correct, mastered });
    return {
      correct,
      correctIndex: q.answer,
      feedback,
      skill: { id: skill.id, name: skill.name, score: next.score, attempts: next.attempts, mastered },
    };
  }

  function complete(sessionId, activityId) {
    const session = openSession(sessionId);
    const activity = content.activities.get(activityId);
    if (!activity) throw new HttpError(404, 'activity not found');
    if (activity.type === 'quiz') throw new HttpError(400, 'quizzes are completed by answering questions');

    const { mastery } = snapshot(session.studentId);
    if (!isEligible(content.skillMap.get(activity.skillId), mastery)) {
      throw new HttpError(409, 'skill is not available');
    }
    run(
      'INSERT OR IGNORE INTO progress (student_id, activity_id, completed_at) VALUES (?, ?, ?)',
      session.studentId,
      activity.id,
      now(),
    );
    return nextFor(session.studentId);
  }

  function heartbeat(sessionId, { activeSeconds, idleSeconds }) {
    const session = openSession(sessionId);
    run(
      'INSERT INTO heartbeats (session_id, active_seconds, idle_seconds, at) VALUES (?, ?, ?, ?)',
      session.id,
      clampSeconds(activeSeconds),
      clampSeconds(idleSeconds),
      now(),
    );
    return sessionStatus(session);
  }

  function startSession(studentId) {
    studentRow(studentId);
    run('UPDATE sessions SET ended_at = ? WHERE student_id = ? AND ended_at IS NULL', now(), studentId);
    const { lastInsertRowid } = run(
      'INSERT INTO sessions (student_id, started_at) VALUES (?, ?)',
      studentId,
      now(),
    );
    return sessionStatus(sessionRow(Number(lastInsertRowid)));
  }

  function endSession(sessionId) {
    const session = openSession(sessionId);
    run('UPDATE sessions SET ended_at = ? WHERE id = ?', now(), session.id);
    return sessionStatus(sessionRow(session.id));
  }

  function listStudents() {
    return all('SELECT id, name, grade FROM students ORDER BY name');
  }

  function createStudent({ name, grade }) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) throw new HttpError(400, 'name is required');
    if (!Number.isInteger(grade) || grade < 0 || grade > 12) throw new HttpError(400, 'grade must be 0-12');
    const { lastInsertRowid } = run(
      'INSERT INTO students (name, grade) VALUES (?, ?)',
      cleanName,
      grade,
    );
    return studentRow(Number(lastInsertRowid));
  }

  function publicContent() {
    return content.skills.map((s) => ({
      id: s.id,
      name: s.name,
      subject: s.subject,
      prereqs: s.prereqs,
      activities: s.activities.map(viewActivity),
    }));
  }

  function report(studentId) {
    const student = studentRow(studentId);
    const { mastery } = snapshot(studentId);
    const skills = content.skills.map((s) => {
      const m = scoreOf(mastery, s.id);
      return {
        id: s.id,
        name: s.name,
        subject: s.subject,
        score: m.score,
        attempts: m.attempts,
        mastered: isMastered(m),
      };
    });
    const sessions = all(
      'SELECT id, student_id AS studentId, started_at AS startedAt, ended_at AS endedAt FROM sessions WHERE student_id = ? ORDER BY id DESC LIMIT 10',
      studentId,
    ).map((row) => sessionStatus(row));
    return { student, skills, sessions, next: nextFor(studentId) };
  }

  function roster() {
    return listStudents().map((s) => {
      const { mastery } = snapshot(s.id);
      const last = get(
        'SELECT id, student_id AS studentId, started_at AS startedAt, ended_at AS endedAt FROM sessions WHERE student_id = ? ORDER BY id DESC LIMIT 1',
        s.id,
      );
      const next = nextFor(s.id);
      return {
        ...s,
        masteredSkills: content.skills.filter((k) => isMastered(scoreOf(mastery, k.id))).length,
        totalSkills: content.skills.length,
        currentSkill: next.skill?.name ?? null,
        done: next.done,
        session: last ? sessionStatus(last) : null,
      };
    });
  }

  return {
    publicContent,
    listStudents,
    createStudent,
    nextFor,
    startSession,
    endSession,
    heartbeat,
    complete,
    answer,
    report,
    roster,
  };
}
