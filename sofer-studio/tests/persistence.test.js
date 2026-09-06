// tests/persistence.test.js — restart survival, progress, locked survival, stable IDs, hash.

import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { startTestServer, request, jsonHeaders, getToken, bootstrap, compute } from './helpers.js';
import { createRunner, ok, eq } from './harness.js';

const dbPath = fileURLToPath(new URL('../data/_test_persistence.db', import.meta.url));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }

const runner = createRunner();
let s1 = await startTestServer(dbPath);

let sourceHash;
let originalLineId;
let profileId, geometryId, layoutId;

runner.test('create + lock + progress, capture identities', async () => {
  const b = await bootstrap(s1);
  profileId = b.profile_id; geometryId = b.geometry_id;
  const srcAll = await request(s1, 'GET', '/api/sources');
  sourceHash = srcAll.json[0].revision_hash;
  const l = await compute(s1, b.token, b);
  layoutId = l.layout_id;
  originalLineId = l.lines[0].line_id;
  await request(s1, 'POST', '/api/layouts/' + layoutId + '/lock', { headers: jsonHeaders(b.token) });
  const prog = await request(s1, 'POST', '/api/layouts/' + layoutId + '/progress', { headers: jsonHeaders(b.token), body: { line_id: originalLineId, status: 'written' } });
  eq(prog.status, 200);
  ok(sourceHash.length === 64);
});

let s2;
runner.test('restart: data survives', async () => {
  await s1.close();
  s2 = await startTestServer(dbPath);
  const layout = await request(s2, 'GET', '/api/layouts/' + layoutId);
  eq(layout.status, 200);
  eq(layout.json.status, 'locked');
  eq(layout.json.lines[0].line_id, originalLineId);
  const writtenLine = layout.json.lines.find((l) => l.line_id === originalLineId);
  eq(writtenLine.status, 'written');
});

runner.test('restart: source hash integrity', async () => {
  const layout = await request(s2, 'GET', '/api/layouts/' + layoutId);
  eq(layout.json.snapshot.source_hash, sourceHash);
  const src = await request(s2, 'GET', '/api/sources');
  eq(src.json[0].revision_hash, sourceHash);
});

runner.test('stable line IDs across recompute', async () => {
  const token = await getToken(s2);
  const l2 = await compute(s2, token, { source_id: (await request(s2, 'GET', '/api/sources')).json[0].id, profile_id: profileId, geometry_id: geometryId });
  eq(l2.lines[0].line_id, originalLineId);
});


// ---- S3: non_stretchable serialized as a JSON array on all boundaries ----
runner.test('S3: profile export + GET return non_stretchable as a JSON array', async () => {
  const s = (s2 || s1);
  const token = await getToken(s);
  const exp = await request(s, 'GET', '/api/profiles/' + profileId + '/export', { headers: jsonHeaders(token) });
  ok(Array.isArray(exp.json.non_stretchable), 'export non_stretchable must be an array');
  const get = await request(s, 'GET', '/api/profiles/' + profileId);
  ok(Array.isArray(get.json.non_stretchable), 'GET profile non_stretchable must be an array');
});

runner.test('S3: empty non_stretchable override array survives duplicate without defaults', async () => {
  const s = (s2 || s1);
  const token = await getToken(s);
  const created = await request(s, 'POST', '/api/profiles', { headers: jsonHeaders(token), body: { name: 'no-nonstretch', non_stretchable: [] } });
  eq(created.json.non_stretchable.length, 0, 'empty override respected, not replaced by defaults');
  const dup = await request(s, 'POST', '/api/profiles/' + created.json.id + '/duplicate', { headers: jsonHeaders(token), body: { name: 'no-nonstretch-copy' } });
  eq(dup.json.non_stretchable.length, 0, 'duplicate keeps empty override (no reintroduced defaults)');
});

// ---- S4: full line data persists and survives a profile change ----
runner.test('S4: layout lines retain words/items/letter measures after profile change', async () => {
  const s = (s2 || s1);
  const token = await getToken(s);
  const b = await bootstrap(s);
  const l = await compute(s, b.token, b);
  const full0 = await request(s, 'GET', '/api/layouts/' + l.layout_id);
  const line0 = full0.json.lines[0];
  ok(Array.isArray(line0.words) && line0.words.length > 0, 'persisted line has words');
  ok(line0.words[0].letters && line0.words[0].letters.length > 0, 'words have letter occurrence IDs');
  ok(Array.isArray(line0.items), 'persisted line has items');
  ok(typeof line0.base_leftover_mm === 'number', 'persisted line has base_leftover_mm');
  // Capture original width before changing the profile.
  const widthBefore = line0.width_mm;
  // Change the profile (letter height 4.5 -> 7) — must NOT change the stored layout data.
  await request(s, 'PUT', '/api/profiles/' + b.profile_id, { headers: jsonHeaders(token), body: { letter_height_mm: 7.0 } });
  const full1 = await request(s, 'GET', '/api/layouts/' + l.layout_id);
  eq(full1.json.lines[0].width_mm, widthBefore, 'stored line width intact after profile change');
  eq(full1.json.lines[0].words.length, line0.words.length, 'stored words intact after profile change');
});

const okAll = await runner.run();
if (s2) await s2.close(); else await s1.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
