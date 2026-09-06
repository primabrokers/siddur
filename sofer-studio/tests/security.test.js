// tests/security.test.js — Host, cross-origin, Content-Type, size limits, token,
// lock via direct API, candidate separate.

import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { startTestServer, request, jsonHeaders, getToken, bootstrap, compute } from './helpers.js';
import { createRunner, ok, eq } from './harness.js';

const dbPath = fileURLToPath(new URL('../data/_test_security.db', import.meta.url));
const server = await startTestServer(dbPath);
const runner = createRunner();

runner.test('session returns token + X-Sofer-Token header', async () => {
  const r = await request(server, 'GET', '/api/session');
  eq(r.status, 200);
  ok(r.headers['x-sofer-token'], 'header present');
  eq(r.json.token, r.headers['x-sofer-token']);
});

runner.test('health is ok', async () => {
  const r = await request(server, 'GET', '/api/health');
  eq(r.status, 200);
  eq(r.json.status, 'ok');
});

runner.test('reject non-loopback Host header', async () => {
  const r = await request(server, 'GET', '/api/health', { host: 'evil.com:4300' });
  eq(r.status, 400);
});

runner.test('reject cross-origin state-changing request', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { ...jsonHeaders(token), 'Origin': 'http://evil.com' },
    body: { name: 'x' },
  });
  eq(r.status, 403);
});

runner.test('reject wrong Content-Type on mutation', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { 'Content-Type': 'text/plain', 'X-Sofer-Token': token },
    body: JSON.stringify({ name: 'x' }),
  });
  eq(r.status, 415);
});

runner.test('reject missing token', async () => {
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { 'Content-Type': 'application/json' },
    body: { name: 'x' },
  });
  eq(r.status, 401);
});

runner.test('reject oversized body (413)', async () => {
  const token = await getToken(server);
  const big = '{"name":"' + 'x'.repeat(2 * 1024 * 1024) + '"}';
  const r = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(token), body: big });
  eq(r.status, 413);
});

runner.test('safe errors do not leak stack/path', async () => {
  const r = await request(server, 'GET', '/api/profiles/does-not-exist');
  eq(r.status, 404);
  ok(!JSON.stringify(r.json).includes('/sofer-studio'), 'no internal path');
});

runner.test('locked layout: stretch via direct API is 409', async () => {
  const b = await bootstrap(server);
  const l = await compute(server, b.token, b);
  const lid = l.layout_id;
  const lock = await request(server, 'POST', '/api/layouts/' + lid + '/lock', { headers: jsonHeaders(b.token) });
  eq(lock.status, 200);
  const st = await request(server, 'POST', '/api/layouts/' + lid + '/stretch', { headers: jsonHeaders(b.token), body: { line_id: l.lines[0].line_id, decisions: [] } });
  eq(st.status, 409);
});

runner.test('delete profile referenced by locked layout is 409', async () => {
  const b = await bootstrap(server);
  const l = await compute(server, b.token, b);
  await request(server, 'POST', '/api/layouts/' + l.layout_id + '/lock', { headers: jsonHeaders(b.token) });
  const d = await request(server, 'DELETE', '/api/profiles/' + b.profile_id, { headers: jsonHeaders(b.token) });
  eq(d.status, 409);
});

runner.test('candidate is separate; parent layout unchanged', async () => {
  const b = await bootstrap(server);
  const l = await compute(server, b.token, b);
  await request(server, 'POST', '/api/layouts/' + l.layout_id + '/lock', { headers: jsonHeaders(b.token) });
  const p2 = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(b.token), body: { name: 'p2', letter_height_mm: 5.5 } });
  const cand = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/candidate', { headers: jsonHeaders(b.token), body: { profile_id: p2.json.id, geometry_id: b.geometry_id } });
  eq(cand.status, 200);
  // parent still locked with original profile
  const parent = await request(server, 'GET', '/api/layouts/' + l.layout_id);
  eq(parent.json.status, 'locked');
  eq(parent.json.profile_id, b.profile_id);
});


// ---- S2: strict same-origin validation ----
runner.test('S2: reject Origin on a different port', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { ...jsonHeaders(token), 'Origin': 'http://127.0.0.1:9999' },
    body: { name: 'x' },
  });
  eq(r.status, 403);
});

runner.test('S2: reject opaque Origin "null"', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { ...jsonHeaders(token), 'Origin': 'null' },
    body: { name: 'x' },
  });
  eq(r.status, 403);
});

runner.test('S2: accept exact same-origin Origin', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', {
    headers: { ...jsonHeaders(token), 'Origin': server.baseUrl },
    body: { name: 'x' },
  });
  eq(r.status, 200);
});

// ---- S1: strict physical-input validation ----
runner.test('S1: reject negative letter_height_mm', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(token), body: { name: 'x', letter_height_mm: -3 } });
  eq(r.status, 400);
  ok(/letter_height/.test(JSON.stringify(r.json)), 'clear error message');
});

runner.test('S1: reject non-finite letter width', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(token), body: { name: 'x', letter_widths: { 'א': 'abc' } } });
  eq(r.status, 400);
});

runner.test('S1: reject negative geometry line_width_mm', async () => {
  const token = await getToken(server);
  const r = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(token), body: { name: 'g', line_width_mm: -5 } });
  eq(r.status, 400);
});

// ---- S5: stretch atomicity at the HTTP boundary ----
runner.test('S5: duplicate stretch decisions aggregate and enforce cap over HTTP', async () => {
  const b = await bootstrap(server);
  const l = await compute(server, b.token, b);
  let target = null;
  for (const line of l.lines) {
    for (const w of (line.words || [])) {
      for (const lt of (w.letters || [])) {
        if (lt.base === 'ר') { target = { line_id: line.line_id, id: lt.id }; break; }
      }
      if (target) break;
    }
    if (target) break;
  }
  ok(target, 'found a ר occurrence to stretch');
  const r = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/stretch', {
    headers: jsonHeaders(b.token),
    body: { line_id: target.line_id, decisions: [
      { letter_occurrence_id: target.id, stretch_mm: 1 },
      { letter_occurrence_id: target.id, stretch_mm: 1 },
    ] },
  });
  eq(r.status, 409, 'duplicate 1mm+1mm (2mm) exceeds 1.8mm cap -> 409');
});

const okAll = await runner.run();
await server.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
