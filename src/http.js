import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { HttpError } from './service.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY_BYTES = 200_000;
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

function send(res, status, type, payload, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

const sendJson = (res, status, body, headers) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body), headers);

export function createHttpServer({ api, publicDir }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        let body;
        if (req.method !== 'GET') {
          // Requiring JSON blocks cross-site form posts that would carry the session cookie.
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
            throw new HttpError(415, 'send requests as application/json');
          }
          body = await readJson(req);
        }
        const out = await api({
          method: req.method,
          pathname: url.pathname,
          body,
          cookies: parseCookies(req.headers.cookie),
        });
        return sendJson(res, out.status, out.body, out.headers);
      }

      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');

      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      const file = join(publicDir, rel);
      if (!file.startsWith(publicDir + sep)) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');

      const data = await readFile(file);
      return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', data);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err.code === 'ENOENT' || err.code === 'EISDIR') return send(res, 404, 'text/plain; charset=utf-8', 'not found');
      console.error(err);
      return sendJson(res, 500, { error: 'internal error' });
    }
  });
}
