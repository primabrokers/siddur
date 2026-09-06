// tests/diff.test.js — candidate creation, diff, unchanged, moved, stable rerun.

import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { startTestServer, request, jsonHeaders, getToken, bootstrap, compute } from './helpers.js';
import { createRunner, ok, eq } from './harness.js';

const dbPath = fileURLToPath(new URL('../data/_test_diff.db', import.meta.url));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }

const server = await startTestServer(dbPath);
const runner = createRunner();

let base;
let layoutId;

runner.test('setup: locked layout', async () => {
  base = await bootstrap(server);
  const l = await compute(server, base.token, base);
  layoutId = l.layout_id;
  const lock = await request(server, 'POST', '/api/layouts/' + layoutId + '/lock', { headers: jsonHeaders(base.token) });
  eq(lock.status, 200);
});

runner.test('candidate with identical calibration -> empty diff', async () => {
  const cand = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: base.profile_id, geometry_id: base.geometry_id } });
  eq(cand.status, 200);
  eq(cand.json.diff.length, 0);
});

runner.test('candidate with different calibration -> changes detected', async () => {
  const p2 = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(base.token), body: { name: 'p2', letter_height_mm: 6.0 } });
  const cand = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: p2.json.id, geometry_id: base.geometry_id } });
  eq(cand.status, 200);
  ok(cand.json.diff.length > 0, 'diff has entries');
  ok(cand.json.diff.some((c) => c.type === 'line_changed'), 'line changes present');
});

runner.test('stable rerun: identical diff for identical candidate inputs', async () => {
  const p2 = await request(server, 'GET', '/api/profiles');
  const t = await getToken(server);
  const a = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(t), body: { profile_id: base.profile_id, geometry_id: base.geometry_id } });
  const a2 = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(t), body: { profile_id: base.profile_id, geometry_id: base.geometry_id } });
  eq(JSON.stringify(a.json.diff), JSON.stringify(a2.json.diff));
});

runner.test('diff endpoint returns locked + candidate + changes', async () => {
  const r = await request(server, 'GET', '/api/layouts/' + layoutId + '/diff');
  eq(r.status, 200);
  ok(r.json.locked, 'locked present');
  ok(r.json.candidate, 'candidate present');
  ok(Array.isArray(r.json.changes), 'changes array');
});

runner.test('adopt candidate: identical calibration keeps verified-unchanged status', async () => {
  const parent = await request(server, 'GET', '/api/layouts/' + layoutId);
  const firstLine = parent.json.lines[0].line_id;
  await request(server, 'POST', '/api/layouts/' + layoutId + '/progress', { headers: jsonHeaders(base.token), body: { line_id: firstLine, status: 'written' } });
  const cand = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: base.profile_id, geometry_id: base.geometry_id } });
  const adopt = await request(server, 'POST', '/api/layouts/' + layoutId + '/adopt-candidate', { headers: jsonHeaders(base.token), body: { candidate_id: cand.json.candidate_id, verified_unchanged_lines: [firstLine] } });
  eq(adopt.status, 200);
  ok(adopt.json.new_layout_id, 'new layout created');
  const nl = await request(server, 'GET', '/api/layouts/' + adopt.json.new_layout_id);
  eq(nl.json.status, 'locked');
  const kept = nl.json.lines.filter((l) => l.line_id === firstLine);
  ok(kept.length > 0 && kept[0].status === 'written', 'identical verified line kept written status');
  const others = nl.json.lines.filter((l) => l.line_id !== firstLine);
  ok(others.every((l) => l.status === 'pending'), 'non-verified lines reset');
});

runner.test('F-03: changed line claimed verified resets to pending (server re-checks)', async () => {
  const parent = await request(server, 'GET', '/api/layouts/' + layoutId);
  const firstLine = parent.json.lines[0].line_id;
  await request(server, 'POST', '/api/layouts/' + layoutId + '/progress', { headers: jsonHeaders(base.token), body: { line_id: firstLine, status: 'written' } });
  const p3 = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(base.token), body: { name: 'p3', letter_height_mm: 5.0 } });
  const cand = await request(server, 'POST', '/api/layouts/' + layoutId + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: p3.json.id, geometry_id: base.geometry_id } });
  const adopt = await request(server, 'POST', '/api/layouts/' + layoutId + '/adopt-candidate', { headers: jsonHeaders(base.token), body: { candidate_id: cand.json.candidate_id, verified_unchanged_lines: [firstLine] } });
  eq(adopt.status, 200);
  const nl = await request(server, 'GET', '/api/layouts/' + adopt.json.new_layout_id);
  const line = nl.json.lines.filter((l) => l.line_id === firstLine);
  // The changed line must NOT keep 'written': either it moved or it reset to pending.
  ok(line.length === 0 || line[0].status === 'pending', 'changed line did not carry written status');
});

const okAll = await runner.run();
await server.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
