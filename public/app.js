import { $, api, el, guard, showError, startPage } from './common.js';

const BEAT_MS = 15_000;
const IDLE_MS = 60_000;

const view = { studentId: null, session: null, next: null, answer: null, lastInput: Date.now() };

async function loadStudents() {
  const students = await api('GET', '/api/students');
  $('#student').replaceChildren(
    ...students.map((s) => el('option', { value: s.id, text: `${s.name} (grade ${s.grade})` })),
  );
  $('#start').disabled = students.length === 0;
  if (students.length === 0) {
    $('#activity').replaceChildren(el('p', { class: 'muted', text: 'No students yet. An admin can add them on the Admin page.' }));
    return;
  }
  view.studentId = students[0].id;
  await loadSidebar();
}

async function loadSidebar() {
  if (!view.studentId) return;
  const report = await api('GET', `/api/students/${view.studentId}/report`);
  $('#skills').replaceChildren(
    ...report.skills.map((s) => {
      const pct = Math.round(s.score * 100);
      return el(
        'li',
        { class: s.mastered ? 'mastered' : '' },
        el('div', { class: 'skill-head' }, el('span', { text: s.name }), el('span', { class: 'muted small', text: s.mastered ? 'mastered' : `${pct}%` })),
        el('div', { class: 'bar small' }, el('div', { style: `width:${pct}%` })),
      );
    }),
  );
}

async function startSession() {
  view.studentId = $('#student').value;
  view.session = await api('POST', `/api/students/${view.studentId}/sessions`);
  await refresh();
}

async function refresh() {
  if (!view.session) return;
  view.next = await api('GET', `/api/students/${view.studentId}/next`);
  view.answer = null;
  renderActivity();
  renderMeters();
  await loadSidebar();
}

function renderActivity() {
  const box = $('#activity');
  if (!view.session) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Start a session to see the next activity.' }));
    return;
  }
  if (view.next.done) {
    box.replaceChildren(
      el('h2', { text: 'All caught up' }),
      el('p', { class: 'muted', text: 'Every available skill is mastered. A guide can set the next goals.' }),
    );
    return;
  }

  const { skill, activity, question } = view.next;
  const body = activity.type === 'quiz' ? renderQuiz(question) : renderLesson(activity);
  box.replaceChildren(
    el('p', { class: 'eyebrow', text: `${skill.subject} · ${skill.name}` }),
    el('h2', { text: activity.title }),
    el('span', { class: `tag ${activity.type}`, text: `${activity.type} · ${activity.minutes} min` }),
    body,
  );
}

function renderLesson(activity) {
  const nodes = [];
  if (activity.url) {
    nodes.push(el('iframe', { class: 'video', src: activity.url, title: activity.title, allowfullscreen: true }));
  }
  nodes.push(...activity.body.map((p) => el('p', { text: p })));
  nodes.push(el('button', { class: 'primary', text: 'Mark complete', onclick: guard(completeActivity) }));
  return el('div', { class: 'lesson' }, ...nodes);
}

function renderQuiz(question) {
  const result = view.answer;
  const choices = question.choices.map((text, i) => {
    let cls = 'choice';
    if (result && i === result.correctIndex) cls += ' right';
    else if (result && i === result.choice) cls += ' wrong';
    return el('button', { class: cls, text, disabled: Boolean(result), onclick: guard(() => submitAnswer(i)) });
  });

  const footer = result
    ? el(
        'div',
        { class: `feedback ${result.correct ? 'ok' : 'miss'}` },
        el('p', { text: result.feedback }),
        el('button', { class: 'primary', text: 'Continue', onclick: guard(refresh) }),
      )
    : el('p', { class: 'muted small', text: `Question ${question.index + 1} of ${question.total}` });

  return el('div', { class: 'quiz' }, el('p', { class: 'prompt', text: question.prompt }), el('div', { class: 'choices' }, ...choices), footer);
}

async function submitAnswer(choice) {
  const res = await api('POST', `/api/sessions/${view.session.id}/answer`, {
    activityId: view.next.activity.id,
    choice,
    questionIndex: view.next.question.index,
  });
  view.answer = { ...res, choice };
  renderActivity();
  await loadSidebar();
}

async function completeActivity() {
  view.next = await api('POST', `/api/sessions/${view.session.id}/complete`, {
    activityId: view.next.activity.id,
  });
  renderActivity();
  await loadSidebar();
}

function renderMeters() {
  const s = view.session;
  if (!s) {
    $('#time').textContent = 'not started';
    $('#timeBar').style.width = '0';
    $('#waste').textContent = '—';
    $('#wasteBar').style.width = '0';
    return;
  }
  $('#time').textContent = `${Math.round(s.minutesUsed)} / ${s.budgetMinutes} min`;
  $('#timeBar').style.width = `${Math.min(100, (s.minutesUsed / s.budgetMinutes) * 100)}%`;

  const wasteBar = $('#wasteBar');
  $('#waste').textContent = s.totalSeconds > 0 ? `${Math.round(s.wastePct * 100)}% idle` : '—';
  wasteBar.style.width = `${Math.round(s.wastePct * 100)}%`;
  wasteBar.className = `level-${s.level}`;
}

// Heartbeats: every 15 seconds, count the interval as active only if the tab is
// visible and the student has given input recently. Otherwise it is waste.
for (const type of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart']) {
  addEventListener(type, () => (view.lastInput = Date.now()), { passive: true });
}

setInterval(async () => {
  if (!view.session || view.session.endedAt) return;
  const active = !document.hidden && Date.now() - view.lastInput < IDLE_MS;
  const seconds = BEAT_MS / 1000;
  try {
    view.session = await api(
      'POST',
      `/api/sessions/${view.session.id}/heartbeat`,
      active ? { activeSeconds: seconds, idleSeconds: 0 } : { activeSeconds: 0, idleSeconds: seconds },
    );
    renderMeters();
    if (view.session.minutesRemaining <= 0) {
      view.session = await api('POST', `/api/sessions/${view.session.id}/end`);
      renderMeters();
      showError('Session time is up.');
    }
  } catch (err) {
    showError(err.message);
  }
}, BEAT_MS);

$('#student').addEventListener('change', guard(async () => {
  view.studentId = $('#student').value;
  view.session = null;
  view.next = null;
  view.answer = null;
  renderActivity();
  renderMeters();
  await loadSidebar();
}));
$('#start').addEventListener('click', guard(startSession));

guard(async () => {
  await startPage('index.html');
  await loadStudents();
})();
