import { $, api, el, guard, showNotice, startPage } from './common.js';

const state = { me: null, students: [], users: [], skills: [], editingStudent: null, draft: null };

const gradeLabel = (g) => (g === 0 ? 'K' : String(g));
const randomId = () => Math.random().toString(36).slice(2, 8);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const confirmAction = (message) => window.confirm(message);

// --- Tabs ---------------------------------------------------------------------

function showTab(name) {
  for (const tab of document.querySelectorAll('[role=tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  for (const id of ['students', 'staff', 'lessons']) $(`#tab-${id}`).hidden = id !== name;
}

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

// --- Students -----------------------------------------------------------------

$('#studentGrade').replaceChildren(
  ...Array.from({ length: 13 }, (_, g) => el('option', { value: g, text: g === 0 ? 'Kindergarten' : `Grade ${g}` })),
);

async function loadStudents() {
  state.students = await api('GET', '/api/students');
  $('#studentRows').replaceChildren(
    ...(state.students.length
      ? state.students.map((s) =>
          el(
            'tr',
            {},
            el('td', { text: s.name }),
            el('td', { text: gradeLabel(s.grade) }),
            el(
              'td',
              { class: 'actions' },
              el('button', { text: 'Edit', onclick: () => editStudent(s) }),
              el('button', {
                text: 'Reset progress',
                onclick: guard(async () => {
                  if (!confirmAction(`Erase all of ${s.name}'s progress? This cannot be undone.`)) return;
                  await api('POST', `/api/admin/students/${s.id}/reset`);
                  showNotice(`${s.name}'s progress was reset.`);
                }),
              }),
              el('button', {
                class: 'danger',
                text: 'Delete',
                onclick: guard(async () => {
                  if (!confirmAction(`Delete ${s.name} and all their sessions? This cannot be undone.`)) return;
                  await api('DELETE', `/api/admin/students/${s.id}`);
                  await loadStudents();
                }),
              }),
            ),
          ),
        )
      : [el('tr', {}, el('td', { colspan: 3, class: 'muted', text: 'No students yet.' }))]),
  );
}

function editStudent(student) {
  state.editingStudent = student;
  $('#studentFormTitle').textContent = student ? `Edit ${student.name}` : 'Add a student';
  $('#studentSave').textContent = student ? 'Save changes' : 'Add student';
  $('#studentCancel').hidden = !student;
  $('#studentName').value = student?.name ?? '';
  $('#studentGrade').value = String(student?.grade ?? 0);
  if (student) $('#studentName').focus();
}

$('#studentCancel').addEventListener('click', () => editStudent(null));
$('#studentForm').addEventListener('submit', guard(async (event) => {
  event.preventDefault();
  const body = { name: $('#studentName').value, grade: Number($('#studentGrade').value) };
  if (state.editingStudent) await api('PUT', `/api/admin/students/${state.editingStudent.id}`, body);
  else await api('POST', '/api/admin/students', body);
  editStudent(null);
  await loadStudents();
}));

// --- Staff --------------------------------------------------------------------

async function loadStaff() {
  state.users = await api('GET', '/api/admin/users');
  $('#staffRows').replaceChildren(
    ...state.users.map((u) => {
      const isMe = u.email === state.me.email;
      const actions = u.fromSettings
        ? [el('span', { class: 'muted small', text: 'Set in ADMIN_EMAILS' })]
        : [
            el('button', {
              text: u.role === 'admin' ? 'Make guide' : 'Make admin',
              disabled: isMe,
              onclick: guard(async () => {
                await api('PUT', `/api/admin/users/${encodeURIComponent(u.email)}`, { name: u.name, role: u.role === 'admin' ? 'guide' : 'admin' });
                await loadStaff();
              }),
            }),
            el('button', {
              class: 'danger',
              text: 'Remove',
              disabled: isMe,
              onclick: guard(async () => {
                if (!confirmAction(`Remove ${u.email}? They will be signed out and cannot sign in again.`)) return;
                await api('DELETE', `/api/admin/users/${encodeURIComponent(u.email)}`);
                await loadStaff();
              }),
            }),
          ];
      return el(
        'tr',
        {},
        el('td', { text: u.email }),
        el('td', { text: u.name || '—' }),
        el('td', { text: u.role === 'admin' ? 'Admin' : 'Guide' }),
        el('td', { class: 'actions' }, ...actions),
      );
    }),
  );
}

$('#staffForm').addEventListener('submit', guard(async (event) => {
  event.preventDefault();
  await api('PUT', `/api/admin/users/${encodeURIComponent($('#staffEmail').value.trim())}`, {
    name: $('#staffName').value,
    role: $('#staffRole').value,
  });
  $('#staffForm').reset();
  await loadStaff();
}));

// --- Lessons: skill list ------------------------------------------------------

async function loadSkills() {
  state.skills = await api('GET', '/api/admin/skills');
  const bySubject = new Map();
  for (const s of state.skills) bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
  $('#skillList').replaceChildren(
    ...[...bySubject].map(([subject, skills]) =>
      el(
        'div',
        { class: 'skill-group' },
        el('h3', { text: subject }),
        ...skills.map((s) =>
          el('button', {
            class: `skill-link${state.draft?.id === s.id && !state.draft.isNew ? ' current' : ''}`,
            text: s.name,
            onclick: () => openSkill(s),
          }),
        ),
      ),
    ),
  );
}

function openSkill(skill) {
  state.draft = {
    isNew: false,
    id: skill.id,
    name: skill.name,
    subject: skill.subject,
    prereqs: [...skill.prereqs],
    activities: skill.activities.map((a) => ({
      ...a,
      bodyText: (a.body ?? []).join('\n\n'),
      questions: (a.questions ?? []).map((q) => ({ ...q, choices: [...q.choices] })),
    })),
  };
  renderEditor();
  loadSkills();
}

function newSkill() {
  state.draft = { isNew: true, idTouched: false, id: '', name: '', subject: state.skills[0]?.subject ?? '', prereqs: [], activities: [] };
  addActivity('reading');
  addActivity('quiz');
  renderEditor();
  loadSkills();
}
$('#newSkill').addEventListener('click', newSkill);

// --- Lessons: editor ----------------------------------------------------------

function newQuestion() {
  return { id: `${state.draft.id || 'q'}-${randomId()}`, prompt: '', choices: ['', '', '', ''], answer: 0, hint: '' };
}

function addActivity(type) {
  const prefix = state.draft.id || 'activity';
  const activity = { id: `${prefix}-${randomId()}`, type, title: '', minutes: type === 'quiz' ? 6 : 8 };
  if (type === 'quiz') activity.questions = [newQuestion()];
  else Object.assign(activity, { url: '', bodyText: '' });
  state.draft.activities.push(activity);
}

// Inputs write straight into the draft; structural edits re-render the editor.
const bind = (obj, key, transform = (v) => v) => ({ value: obj[key] ?? '', oninput: (e) => (obj[key] = transform(e.target.value)) });
const rerender = (fn) => () => {
  fn();
  renderEditor();
};

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

function renderQuestion(activity, q, qi) {
  return el(
    'div',
    { class: 'question' },
    el(
      'div',
      { class: 'row spread' },
      el('strong', { text: `Question ${qi + 1}` }),
      el('button', {
        class: 'link danger',
        text: 'Remove question',
        disabled: activity.questions.length === 1,
        onclick: rerender(() => activity.questions.splice(qi, 1)),
      }),
    ),
    el('label', { class: 'field' }, 'Question', el('textarea', { rows: 2, ...bind(q, 'prompt') })),
    el('p', { class: 'muted small', text: 'Choices (select the correct one)' }),
    ...q.choices.map((choice, ci) =>
      el(
        'div',
        { class: 'choice-row' },
        el('input', {
          type: 'radio',
          name: `answer-${q.id}`,
          checked: q.answer === ci,
          'aria-label': `Choice ${ci + 1} is correct`,
          onchange: () => (q.answer = ci),
        }),
        el('input', { value: choice, placeholder: `Choice ${ci + 1}`, oninput: (e) => (q.choices[ci] = e.target.value) }),
        el('button', {
          class: 'link',
          text: 'Remove',
          disabled: q.choices.length <= 2,
          onclick: rerender(() => {
            q.choices.splice(ci, 1);
            if (q.answer >= q.choices.length || q.answer === ci) q.answer = 0;
            else if (q.answer > ci) q.answer -= 1;
          }),
        }),
      ),
    ),
    el('button', { class: 'link', text: 'Add choice', disabled: q.choices.length >= 6, onclick: rerender(() => q.choices.push('')) }),
    el('label', { class: 'field' }, 'Hint shown after a wrong answer (optional)', el('input', bind(q, 'hint'))),
  );
}

function renderActivity(activity, index) {
  const list = state.draft.activities;
  const isQuiz = activity.type === 'quiz';
  const head = el(
    'div',
    { class: 'row spread' },
    isQuiz
      ? el('strong', { text: 'Quiz' })
      : el(
          'select',
          {
            value: activity.type,
            onchange: (e) => {
              activity.type = e.target.value;
              renderEditor();
            },
          },
          el('option', { value: 'reading', text: 'Reading lesson' }),
          el('option', { value: 'video', text: 'Video lesson' }),
        ),
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'link', text: 'Up', disabled: index === 0, onclick: rerender(() => move(list, index, -1)) }),
      el('button', { class: 'link', text: 'Down', disabled: index === list.length - 1, onclick: rerender(() => move(list, index, 1)) }),
      el('button', { class: 'link danger', text: 'Remove', onclick: rerender(() => list.splice(index, 1)) }),
    ),
  );

  const fields = [
    el(
      'div',
      { class: 'row' },
      el('label', { class: 'field grow' }, 'Title', el('input', bind(activity, 'title'))),
      el('label', { class: 'field' }, 'Minutes', el('input', { type: 'number', min: 1, max: 60, ...bind(activity, 'minutes', Number) })),
    ),
  ];
  if (isQuiz) {
    fields.push(...activity.questions.map((q, qi) => renderQuestion(activity, q, qi)));
    fields.push(el('button', { text: 'Add question', onclick: rerender(() => activity.questions.push(newQuestion())) }));
  } else {
    if (activity.type === 'video') {
      fields.push(el('label', { class: 'field' }, 'Video link (https://…, embeddable URL)', el('input', { type: 'url', ...bind(activity, 'url') })));
    }
    fields.push(
      el(
        'label',
        { class: 'field' },
        activity.type === 'video' ? 'Notes shown with the video (blank line between paragraphs)' : 'Lesson text (blank line between paragraphs)',
        el('textarea', { rows: 6, ...bind(activity, 'bodyText') }),
      ),
    );
  }
  return el('div', { class: `activity-card ${activity.type}` }, head, ...fields);
}

function renderEditor() {
  const d = state.draft;
  const others = state.skills.filter((s) => s.id !== d.id);
  const subjects = [...new Set(state.skills.map((s) => s.subject))];

  const idField = d.isNew
    ? el(
        'label',
        { class: 'field' },
        'Skill ID (used in links, cannot be changed later)',
        el('input', {
          id: 'skillId',
          value: d.id,
          pattern: '[a-z0-9][a-z0-9-]*',
          oninput: (e) => {
            d.id = e.target.value;
            d.idTouched = true;
          },
        }),
      )
    : el('p', { class: 'muted small', text: `Skill ID: ${d.id}` });

  $('#editor').replaceChildren(
    el('h2', { text: d.isNew ? 'New skill' : `Edit: ${d.name}` }),
    el(
      'div',
      { class: 'row' },
      el(
        'label',
        { class: 'field grow' },
        'Name',
        el('input', {
          value: d.name,
          oninput: (e) => {
            d.name = e.target.value;
            if (d.isNew && !d.idTouched) {
              d.id = slug(d.name);
              const idInput = $('#skillId');
              if (idInput) idInput.value = d.id;
            }
          },
        }),
      ),
      el('label', { class: 'field' }, 'Subject', el('input', { list: 'subjects', ...bind(d, 'subject') })),
    ),
    el('datalist', { id: 'subjects' }, ...subjects.map((s) => el('option', { value: s }))),
    idField,
    el(
      'fieldset',
      { class: 'prereqs' },
      el('legend', { text: 'Must master first' }),
      others.length
        ? others.map((s) =>
            el(
              'label',
              { class: 'check' },
              el('input', {
                type: 'checkbox',
                checked: d.prereqs.includes(s.id),
                onchange: (e) => {
                  d.prereqs = e.target.checked ? [...d.prereqs, s.id] : d.prereqs.filter((p) => p !== s.id);
                },
              }),
              `${s.name} (${s.subject})`,
            ),
          )
        : el('p', { class: 'muted small', text: 'No other skills yet.' }),
    ),
    el('h3', { text: 'Activities, in order' }),
    ...d.activities.map(renderActivity),
    el(
      'div',
      { class: 'row' },
      el('button', { text: 'Add lesson', onclick: rerender(() => addActivity('reading')) }),
      el('button', { text: 'Add quiz', onclick: rerender(() => addActivity('quiz')) }),
    ),
    el(
      'div',
      { class: 'row editor-actions' },
      el('button', { class: 'primary', text: 'Save skill', onclick: guard(saveDraft) }),
      d.isNew
        ? null
        : el('button', {
            class: 'danger',
            text: 'Delete skill',
            onclick: guard(async () => {
              if (!confirmAction(`Delete "${d.name}"? Students' scores for it will no longer be shown.`)) return;
              await api('DELETE', `/api/admin/skills/${d.id}`);
              state.draft = null;
              $('#editor').replaceChildren(el('p', { class: 'muted', text: 'Skill deleted.' }));
              await loadSkills();
            }),
          }),
    ),
  );
}

async function saveDraft() {
  const d = state.draft;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.id)) throw new Error('Skill ID must use lowercase letters, digits and dashes.');
  const body = {
    name: d.name,
    subject: d.subject,
    prereqs: d.prereqs,
    activities: d.activities.map((a) =>
      a.type === 'quiz'
        ? { id: a.id, type: a.type, title: a.title, minutes: a.minutes, questions: a.questions }
        : { id: a.id, type: a.type, title: a.title, minutes: a.minutes, url: a.type === 'video' ? a.url : '', body: a.bodyText.split(/\n\s*\n/) },
    ),
  };
  const saved = await api('PUT', `/api/admin/skills/${d.id}`, body);
  await loadSkills();
  openSkill(saved);
  showNotice('Saved.');
}

// --- Start --------------------------------------------------------------------

guard(async () => {
  state.me = await startPage('admin.html');
  if (state.me.role !== 'admin') {
    document.querySelector('main').replaceChildren(el('p', { class: 'panel', text: 'Only admins can open this page.' }));
    return;
  }
  editStudent(null);
  await Promise.all([loadStudents(), loadStaff(), loadSkills()]);
})();
