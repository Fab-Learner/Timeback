import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './service.js';

// Email one-time-code sign-in for admins and guides.
//
// - Codes are 6 digits, stored only as an HMAC, valid for 10 minutes, and
//   locked after 5 wrong tries.
// - A new code can be sent at most once a minute and 10 times a day per email.
// - Unknown emails get the same response as known ones, so the form cannot be
//   used to discover who has an account.
// - The session cookie is a signed token. The user's role is looked up on every
//   request, so removing someone takes effect immediately.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_MS = 60_000;
export const DAILY_SENDS = 10;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const ROLES = ['admin', 'guide'];

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const DAY_MS = 24 * 60 * 60_000;

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new HttpError(400, 'enter a valid email address');
  return email;
}

function sameText(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createAccounts({ store, mailer, secret, adminEmails = [], clock = () => new Date(), log = console.info }) {
  if (!secret) throw new Error('a session secret is required');
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const nowMs = () => clock().getTime();
  const hmac = (value) => createHmac('sha256', secret).update(value).digest('base64url');

  function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${hmac(body)}`;
  }

  function readToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, signature] = token.split('.');
    if (!sameText(signature, hmac(body))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      return payload.exp > nowMs() ? payload : null;
    } catch {
      return null;
    }
  }

  async function userFor(email) {
    const stored = await store.getUser(email);
    if (admins.has(email)) return { email, name: stored?.name ?? '', role: 'admin', fromSettings: true };
    return stored ? { ...stored, fromSettings: false } : null;
  }

  // The person always sees the same response; the server log says what happened.
  async function requestCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!(await userFor(email))) return log(`no code sent to ${email}: not an admin or guide`);

    const now = nowMs();
    const previous = await store.getOtp(email);
    if (previous && now - previous.sentAt < RESEND_MS) return log(`no code sent to ${email}: last code was under a minute ago`);
    const sameWindow = previous && now - previous.windowStart < DAY_MS;
    const sends = sameWindow ? previous.sends + 1 : 1;
    if (sends > DAILY_SENDS) return log(`no code sent to ${email}: daily limit reached`);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await store.saveOtp(email, {
      hash: hmac(`${email}:${code}`),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      sentAt: now,
      windowStart: sameWindow ? previous.windowStart : now,
      sends,
    });
    try {
      await mailer.sendCode(email, code);
    } catch (err) {
      await store.deleteOtp(email);
      console.error(`sign-in email to ${email} failed:`, err.name, err.message);
      throw new HttpError(502, 'we could not send the sign-in email; please try again in a minute');
    }
    log(`sign-in code sent to ${email}`);
  }

  async function verifyCode(rawEmail, rawCode) {
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.replace(/\s/g, '') : '';
    const otp = await store.getOtp(email);
    const invalid = new HttpError(401, 'that code is wrong or has expired');
    if (!otp || otp.expiresAt < nowMs() || otp.attempts >= MAX_ATTEMPTS) throw invalid;
    if (!/^\d{6}$/.test(code) || !sameText(otp.hash, hmac(`${email}:${code}`))) {
      await store.bumpOtpAttempts(email);
      throw invalid;
    }
    // Keep the send counters so the daily limit still applies after sign-in.
    await store.saveOtp(email, { ...otp, hash: '', expiresAt: 0 });

    const user = await userFor(email);
    if (!user) throw invalid;
    return { user: publicUser(user), token: signToken({ email, exp: nowMs() + SESSION_TTL_MS }) };
  }

  async function userFromToken(token) {
    const payload = readToken(token);
    if (!payload) return null;
    const user = await userFor(payload.email);
    return user ? publicUser(user) : null;
  }

  function publicUser({ email, name, role, fromSettings }) {
    return { email, name: name ?? '', role, fromSettings: Boolean(fromSettings) };
  }

  async function listUsers() {
    const stored = await store.listUsers();
    const byEmail = new Map(stored.map((u) => [u.email, publicUser({ ...u, fromSettings: false })]));
    for (const email of admins) {
      byEmail.set(email, publicUser({ email, name: byEmail.get(email)?.name, role: 'admin', fromSettings: true }));
    }
    return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  }

  async function saveUser(rawEmail, { name, role }) {
    const email = normalizeEmail(rawEmail);
    if (!ROLES.includes(role)) throw new HttpError(400, 'role must be admin or guide');
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 100) : '';
    await store.saveUser({ email, name: cleanName, role });
    return publicUser(await userFor(email));
  }

  async function deleteUser(rawEmail, actingEmail) {
    const email = normalizeEmail(rawEmail);
    if (email === actingEmail) throw new HttpError(400, 'you cannot remove yourself');
    if (admins.has(email)) throw new HttpError(400, 'this admin is set in ADMIN_EMAILS and must be removed there');
    await store.deleteUser(email);
    return { ok: true };
  }

  return { requestCode, verifyCode, userFromToken, listUsers, saveUser, deleteUser };
}
