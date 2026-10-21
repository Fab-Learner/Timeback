// Shared helpers for every page.

export const $ = (sel, root = document) => root.querySelector(sel);

// Build DOM nodes without innerHTML so user-entered text is never parsed as markup.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false || key === 'value') continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  // Set value last: a <select> can only take a value once its options exist.
  if (props.value !== undefined && props.value !== null) node.value = props.value;
  return node;
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  // A 401 from the sign-in calls means a wrong code; anywhere else it means "not signed in".
  if (res.status === 401 && path !== '/api/auth/request' && path !== '/api/auth/verify') {
    location.href = `login.html?next=${encodeURIComponent(location.pathname)}`;
    throw new Error('Please sign in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function showMessage(message, kind) {
  let box = $('#message');
  if (!box) {
    box = el('p', { id: 'message', role: 'status' });
    document.body.append(box);
  }
  box.className = `message ${kind}`;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => (box.hidden = true), 6000);
}

export const showError = (message) => showMessage(message, 'error');
export const showNotice = (message) => showMessage(message, 'notice');

// Wrap async handlers so failures show a message instead of vanishing.
export const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    showError(err.message);
  }
};

// Ensure someone is signed in (redirects to sign-in otherwise) and draw the header.
export async function startPage(current) {
  const { user } = await api('GET', '/api/auth/me');
  const links = [
    ['index.html', 'Student'],
    ['guide.html', 'Guide'],
    ...(user.role === 'admin' ? [['admin.html', 'Admin']] : []),
  ];
  $('#nav').replaceChildren(
    ...links.map(([href, label]) => el('a', { href, text: label, 'aria-current': href === current ? 'page' : null })),
    el('span', { class: 'who', text: user.name || user.email }),
    el('button', {
      class: 'link',
      text: 'Sign out',
      onclick: guard(async () => {
        await api('POST', '/api/auth/logout');
        location.href = 'login.html';
      }),
    }),
  );
  return user;
}
