import { $, api, el, guard, startPage } from './common.js';

const REFRESH_MS = 15_000;

function flagFor(session) {
  if (!session || session.level === 'ok') return null;
  return el('span', {
    class: `pill ${session.level}`,
    text: session.level === 'alert' ? 'Off task' : 'Watch',
  });
}

function row(r) {
  const s = r.session;
  const status = !s ? 'No session' : s.endedAt ? 'Ended' : 'In session';
  return el(
    'tr',
    {},
    el('td', { text: r.name }),
    el('td', { text: String(r.grade) }),
    el('td', { text: `${r.masteredSkills}/${r.totalSkills}` }),
    el('td', { text: r.done ? 'All caught up' : r.currentSkill ?? '—' }),
    el('td', { text: status }),
    el('td', { text: s ? `${Math.round(s.minutesUsed)} min` : '—' }),
    el('td', { text: s && s.totalSeconds > 0 ? `${Math.round(s.wastePct * 100)}%` : '—' }),
    el('td', {}, flagFor(s)),
  );
}

async function load() {
  const rows = await api('GET', '/api/guide/roster');
  $('#roster').replaceChildren(
    ...(rows.length ? rows.map(row) : [el('tr', {}, el('td', { colspan: 8, class: 'muted', text: 'No students yet.' }))]),
  );
  $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

guard(async () => {
  await startPage('guide.html');
  await load();
  setInterval(guard(load), REFRESH_MS);
})();
