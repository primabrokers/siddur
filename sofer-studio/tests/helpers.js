// tests/helpers.js — spin up a test app against a temp DB + raw HTTP request helper.
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { openDatabase } from '../db/db.js';

export function resolvePublicDir() {
  const dir = fileURLToPath(new URL('../public', import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function startTestServer(dbPath) {
  const db = openDatabase(dbPath);
  const app = createApp({ db, publicDir: resolvePublicDir(), port: 0 });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const port = app.address().port;
  return {
    db,
    app,
    port,
    baseUrl: 'http://127.0.0.1:' + port,
    async close() {
      await new Promise((r) => app.close(r));
      db.close();
    },
  };
}

export function request(server, method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(server.baseUrl);
    const hdrs = { ...headers };
    if (host) hdrs.Host = host;
    const req = http.request({ host: url.hostname, port: url.port, path, method, headers: hdrs }, (res) => {
      // Hebrew code points may straddle HTTP chunks; decode the stream rather
      // than coercing each Buffer separately into replacement characters.
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

export function jsonHeaders(token) {
  return { 'Content-Type': 'application/json', 'X-Sofer-Token': token };
}

export async function getToken(server) {
  const r = await request(server, 'GET', '/api/session');
  return r.headers['x-sofer-token'] || (r.json && r.json.token);
}

export async function bootstrap(server) {
  const token = await getToken(server);
  const h = jsonHeaders(token);
  const prof = await request(server, 'POST', '/api/profiles', { headers: h, body: { name: 'p1', letter_height_mm: 4.5 } });
  const geo = await request(server, 'POST', '/api/geometries', { headers: h, body: { name: 'g1', line_width_mm: 80, lines_per_amud: 4, amudim_per_yeria: 2 } });
  const src = await request(server, 'POST', '/api/sources/import', { headers: h, body: { name: 'demo', format: 'json', text: { books: [{ name: 'בראשית', chapters: [['בראשית ברא אלהים את השמים ואת הארץ', 'והארץ היתה תהו ובהו', 'ויאמר אלהים יהי אור']] }] } } });
  return { token, profile_id: prof.json.id, geometry_id: geo.json.id, source_id: src.json.id };
}

export async function compute(server, token, { source_id, profile_id, geometry_id }) {
  const r = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(token), body: { source_id, profile_id, geometry_id } });
  return r.json;
}
