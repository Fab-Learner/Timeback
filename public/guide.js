const REFRESH_MS = 15_000;
const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined));
  return node;
}

async function api(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

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
  try {
    const rows = await api('/api/guide/roster');
    $('#roster').replaceChildren(...rows.map(row));
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $('#error').textContent = err.message;
    $('#error').hidden = false;
  }
}

load();
setInterval(load, REFRESH_MS);
