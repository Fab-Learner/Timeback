import { SESSION_TTL_MS } from './accounts.js';

export const SESSION_COOKIE = 'tb_session';

// Route roles: null = anyone, 'staff' = signed-in guide or admin, 'admin' = admin only.
// Handlers receive { params, body, user, setSession, clearSession }.
export function createApi({ service, accounts, secureCookies = false }) {
  const ID = '([A-Za-z0-9_-]+)';
  const routes = [
    ['POST', '/api/auth/request', null, async ({ body }) => {
      await accounts.requestCode(body.email);
      return { ok: true };
    }],
    ['POST', '/api/auth/verify', null, async ({ body, setSession }) => {
      const { user, token } = await accounts.verifyCode(body.email, body.code);
      setSession(token);
      return { user };
    }],
    ['POST', '/api/auth/logout', null, ({ clearSession }) => {
      clearSession();
      return { ok: true };
    }],
    ['GET', '/api/auth/me', 'staff', ({ user }) => ({ user })],

    ['GET', '/api/content', 'staff', () => service.publicContent()],
    ['GET', '/api/students', 'staff', () => service.listStudents()],
    ['GET', `/api/students/${ID}/next`, 'staff', ({ params: [id] }) => service.nextFor(id)],
    ['GET', `/api/students/${ID}/report`, 'staff', ({ params: [id] }) => service.report(id)],
    ['POST', `/api/students/${ID}/sessions`, 'staff', ({ params: [id] }) => service.startSession(id)],
    ['POST', `/api/sessions/${ID}/heartbeat`, 'staff', ({ params: [id], body }) => service.heartbeat(id, body)],
    ['POST', `/api/sessions/${ID}/complete`, 'staff', ({ params: [id], body }) => service.complete(id, body.activityId)],
    ['POST', `/api/sessions/${ID}/answer`, 'staff', ({ params: [id], body }) => service.answer(id, body)],
    ['POST', `/api/sessions/${ID}/end`, 'staff', ({ params: [id] }) => service.endSession(id)],
    ['GET', '/api/guide/roster', 'staff', () => service.roster()],

    ['POST', '/api/admin/students', 'admin', ({ body }) => service.createStudent(body)],
    ['PUT', `/api/admin/students/${ID}`, 'admin', ({ params: [id], body }) => service.updateStudent(id, body)],
    ['DELETE', `/api/admin/students/${ID}`, 'admin', ({ params: [id] }) => service.deleteStudent(id)],
    ['POST', `/api/admin/students/${ID}/reset`, 'admin', ({ params: [id] }) => service.resetStudent(id)],

    ['GET', '/api/admin/users', 'admin', () => accounts.listUsers()],
    ['PUT', '/api/admin/users/([^/]+)', 'admin', ({ params: [email], body }) => accounts.saveUser(decodeURIComponent(email), body)],
    ['DELETE', '/api/admin/users/([^/]+)', 'admin', ({ params: [email], user }) => accounts.deleteUser(decodeURIComponent(email), user.email)],

    ['GET', '/api/admin/skills', 'admin', () => service.adminSkills()],
    ['PUT', `/api/admin/skills/${ID}`, 'admin', ({ params: [id], body }) => service.saveSkill(id, body)],
    ['DELETE', `/api/admin/skills/${ID}`, 'admin', ({ params: [id] }) => service.deleteSkill(id)],
  ].map(([method, path, role, handler]) => ({ method, pattern: new RegExp(`^${path}$`), role, handler }));

  function cookie(value, maxAgeSeconds) {
    const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
    if (secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  return async function handle({ method, pathname, body, cookies }) {
    let match = null;
    const route = routes.find((r) => r.method === method && (match = r.pattern.exec(pathname)));
    if (!route) return { status: 404, body: { error: 'not found' } };

    let user = null;
    if (route.role) {
      user = await accounts.userFromToken(cookies[SESSION_COOKIE]);
      if (!user) return { status: 401, body: { error: 'sign in required' } };
      if (route.role === 'admin' && user.role !== 'admin') return { status: 403, body: { error: 'admins only' } };
    }

    const headers = {};
    const result = await route.handler({
      params: match.slice(1),
      body: body ?? {},
      user,
      setSession: (token) => (headers['set-cookie'] = cookie(token, Math.floor(SESSION_TTL_MS / 1000))),
      clearSession: () => (headers['set-cookie'] = cookie('', 0)),
    });
    return { status: 200, body: result, headers };
  };
}
