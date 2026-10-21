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
const MAX_BODY_BYTES = 100_000;

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function send(res, status, type, payload) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
}

export function createHttpServer({ api, publicDir }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readJson(req) : undefined;
        const out = await api(req.method, url.pathname, body);
        return send(res, out.status, 'application/json; charset=utf-8', JSON.stringify(out.body));
      }

      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');

      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      const file = join(publicDir, rel);
      if (!file.startsWith(publicDir + sep)) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');

      const data = await readFile(file);
      return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', data);
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, err.status, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }));
      }
      if (err.code === 'ENOENT') return send(res, 404, 'text/plain; charset=utf-8', 'not found');
      console.error(err);
      return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal error' }));
    }
  });
}
