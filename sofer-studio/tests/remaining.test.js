// tests/remaining.test.js — regression tests for the remaining review findings
// (R1/F-15, R2/F-16, R3/F-21, R4/F-22, R5/F-24, R7/F-26, R8/F-31, R9/F-32,
//  R11/F-35, R13/F-30, R15/F-29).
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { startTestServer, request, jsonHeaders, getToken, bootstrap, compute } from './helpers.js';
import { createRunner, ok, eq, approx } from './harness.js';
import { normalizeProfile } from '../engine/profile.js';
import { normalizeGeometry, computeLayout, autoSuggestLine, computeLineKey } from '../engine/layout.js';
import { processSource, isPartialCorpus } from '../engine/source.js';
import { analyzeToken } from '../engine/shem.js';
import { nibSizeWarning, strokeWarning } from '../engine/width.js';

const runner = createRunner();
const P = normalizeProfile({ letter_height_mm: 4.5 });

// ---- R9: no spelling-based holy-name decision ------------------------------
runner.test('R9: עליון requires a human occurrence decision', () => {
  eq(analyzeToken('עליון'), null);
});

// ---- R11 / F-35: nibSizeWarning vs strokeWarning separated -----------------
runner.test('R11: nibSizeWarning keys on letter height; strokeWarning on stroke', () => {
  const tall = normalizeProfile({ letter_height_mm: 5.0, stroke_mm: 0.5, min_letter_height_mm: 3.0, min_nib_mm: 1.0 });
  eq(nibSizeWarning(tall), null, 'tall letters -> no letter-height warning');
  ok(strokeWarning(tall) != null, 'thin stroke -> strokeWarning fires');
  const short = normalizeProfile({ letter_height_mm: 2.0, stroke_mm: 2.0, min_letter_height_mm: 3.0, min_nib_mm: 1.0 });
  ok(nibSizeWarning(short) != null, 'short letters -> nibSizeWarning fires');
  eq(strokeWarning(short), null, 'thick stroke -> no stroke warning');
});

// ---- R5 / F-24: auto-suggest prefers line-end + flags unjustifiable --------
function wl(text, ids) {
  const arr = Array.from(text);
  return { text, isShem: false, letters: arr.map((g, i) => ({ id: (ids && ids[i]) || 'x' + text + i, base: g, grapheme: g })) };
}

runner.test('R5: line-end candidate gets more stretch than non-line-end', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, non_stretchable: [], max_stretch: { 'ד': 1.5, 'ה': 1.5 } });
  // word1 'ד' is word-final (rank 1); word2 'ה' is the last word -> line-end (rank 0).
  const line = {
    words: [wl('ד', ['ocd']), wl('ה', ['och'])],
    leftovers: null,
    leftover_mm: 1.0, base_leftover_mm: 1.0, stretch_decisions: [], tokens: ['ד', 'ה'],
  };
  const r = autoSuggestLine(line, p);
  const byId = {};
  r.suggestions.forEach((s) => { byId[s.letter_occurrence_id] = s.stretch_mm; });
  ok(r.unjustifiable === false, '1.0mm within total cap 3.0 -> not unjustifiable');
  ok(byId.och != null && byId.ocd != null, 'both candidates suggested');
  ok(byId.och > byId.ocd, 'line-end (' + byId.och + ') exceeds non-line-end word-final (' + byId.ocd + ')');
});

runner.test('R5: leftover beyond total cap -> unjustifiable + shortfall', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, non_stretchable: [], max_stretch: { 'ד': 1.5, 'ה': 1.5 } });
  const line = { words: [wl('ד', ['ocd']), wl('ה', ['och'])], leftover_mm: 5.0, base_leftover_mm: 5.0, stretch_decisions: [], tokens: ['ד', 'ה'] };
  const r = autoSuggestLine(line, p);
  eq(r.unjustifiable, true, '5.0mm leftover over 3.0mm cap flagged');
  approx(r.shortfall_mm, 2.0, 1e-6, 'shortfall = 2.0mm');
});

// ---- R7 / F-26: unusual-letter type carried into words[].override ----------
runner.test('R7: large/small/broken/suspended types reach words[].override', () => {
  const src = processSource({
    format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['א ב ג ד']] }] }),
    unusual_letters: [
      { ref: 'x 1:1', letter: 'ב', occurrence_index: 0, type: 'large', width_override_mm: 9 },
      { ref: 'x 1:1', letter: 'ג', occurrence_index: 0, type: 'small', width_override_mm: 4 },
      { ref: 'x 1:1', letter: 'ד', occurrence_index: 0, type: 'broken', width_override_mm: 4 },
    ],
  });
  const g = normalizeGeometry({ line_width_mm: 500 });
  const L = computeLayout(src, P, g);
  const overrides = [];
  for (const line of L.lines) for (const w of line.words) overrides.push(...(w.override || []));
  const types = overrides.map((o) => o.type);
  ok(types.includes('large'), 'large carried: ' + JSON.stringify(overrides));
  ok(types.includes('small'), 'small carried');
  ok(types.includes('broken'), 'broken carried');
  ok(overrides.every((o) => o.id && o.mm != null), 'each override has id + mm');
});

// ---- R8 / F-31: line_key content-derived + unique across layouts -----------
runner.test('R8: same positional line_id, different content -> different line_key', () => {
  const g = normalizeGeometry({ line_width_mm: 400 });
  const a = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'Genesis', chapters: [['בראשית ברא אלהים']] }] }) });
  const b = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'Genesis', chapters: [['בראשית ברא']] }] }) });
  const LA = computeLayout(a, P, g);
  const LB = computeLayout(b, P, g);
  eq(LA.lines[0].line_id, LB.lines[0].line_id, 'positional line_id identical');
  ok(LA.lines[0].line_key && LA.lines[0].line_key.length === 64, 'line_key present (sha256 hex)');
  ok(LA.lines[0].line_key !== LB.lines[0].line_key, 'content-derived key differs');
  // same content + same profile -> same key (stability)
  const LA2 = computeLayout(a, P, g);
  eq(LA.lines[0].line_key, LA2.lines[0].line_key, 'identical content -> identical key');
});

// ---- R15 / F-29: partial_corpus -------------------------------------------
runner.test('R15: partial_corpus true for subset, false for five books', () => {
  eq(isPartialCorpus(['Genesis'], false), true);
  eq(isPartialCorpus(['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'], false), false);
  eq(isPartialCorpus(['בראשית', 'שמות', 'ויקרא', 'במדבר', 'דברים'], false), false);
});

// ---- HTTP boundary --------------------------------------------------------
const dbPath = fileURLToPath(new URL('../data/_test_remaining.db', import.meta.url));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
const server = await startTestServer(dbPath);
let base;

runner.test('http setup', async () => {
  base = await bootstrap(server);
  ok(base.token, 'token');
});

// R13 / F-30: Host port mismatch rejected
runner.test('R13: Host with wrong port rejected', async () => {
  const r = await request(server, 'GET', '/api/health', { host: '127.0.0.1:9999' });
  eq(r.status, 400, 'port mismatch rejected');
});

// R15: partial_corpus over HTTP
runner.test('R15 HTTP: single-book source flagged partial_corpus', async () => {
  const src = await request(server, 'POST', '/api/sources/import', {
    headers: jsonHeaders(base.token), body: { name: 'gen', format: 'json', text: { books: [{ name: 'Genesis', chapters: [['בראשית ברא אלהים']] }] } },
  });
  eq(src.status, 200);
  eq(src.json.partial_corpus, true, 'import response flags partial_corpus');
  const g = await request(server, 'GET', '/api/sources/' + src.json.id);
  eq(g.json.partial_corpus, true, 'GET /api/sources/:id flags partial_corpus');
});

// R8: explicit lock confirmation required before first "written"
runner.test('R8 HTTP: first written requires lock:true; with it, locks', async () => {
  const l = await compute(server, base.token, base);
  const firstLine = l.lines[0].line_id;
  const no = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/progress', {
    headers: jsonHeaders(base.token), body: { line_id: firstLine, status: 'written' },
  });
  eq(no.status, 409, 'written without lock:true -> 409');
  const yes = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/progress', {
    headers: jsonHeaders(base.token), body: { line_id: firstLine, status: 'written', lock: true },
  });
  eq(yes.status, 200, 'written with lock:true -> 200');
  const fl = await request(server, 'GET', '/api/layouts/' + l.layout_id);
  eq(fl.json.status, 'locked', 'layout now locked');
});

// R8: progress keyed by line_key
runner.test('R8 HTTP: progress can be addressed by line_key', async () => {
  const l = await compute(server, base.token, base);
  const lk = l.lines[0].line_key;
  ok(lk, 'line_key surfaced on public lines');
  const r = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/progress', {
    headers: jsonHeaders(base.token), body: { line_key: lk, status: 'checked' },
  });
  eq(r.status, 200, 'line_key progress accepted');
});

// R4 / F-22: adopted layout keeps the candidate summary
runner.test('R4 HTTP: adoption preserves total_amudim + klaf_length_m', async () => {
  const l = await compute(server, base.token, base);
  await request(server, 'POST', '/api/layouts/' + l.layout_id + '/lock', { headers: jsonHeaders(base.token) });
  const cand = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: base.profile_id, geometry_id: base.geometry_id } });
  eq(cand.status, 200);
  const adopt = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/adopt-candidate', { headers: jsonHeaders(base.token), body: { candidate_id: cand.json.candidate_id } });
  eq(adopt.status, 200);
  const nl = await request(server, 'GET', '/api/layouts/' + adopt.json.new_layout_id);
  ok(nl.json.summary && nl.json.summary.total_amudim != null, 'total_amudim survived adoption');
  ok(nl.json.summary && nl.json.summary.klaf_length_m != null, 'klaf_length_m survived adoption');
});

// R3 / F-21: measurement-only change produces a non-empty diff
runner.test('R3 HTTP: stroke-only change yields non-empty diff', async () => {
  const src = await request(server, 'POST', '/api/sources/import', {
    headers: jsonHeaders(base.token), body: { name: 'short', format: 'json', text: { books: [{ name: 'Genesis', chapters: [['אב גד']] }] } },
  });
  const geo = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(base.token), body: { name: 'wide', line_width_mm: 400, lines_per_amud: 2 } });
  const l = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: geo.json.id } });
  const lrs = l.json;
  await request(server, 'POST', '/api/layouts/' + lrs.layout_id + '/lock', { headers: jsonHeaders(base.token) });
  const p2 = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(base.token), body: { name: 'strokeup', letter_height_mm: 4.5, stroke_mm: 0.4 } });
  const cand = await request(server, 'POST', '/api/layouts/' + lrs.layout_id + '/candidate', { headers: jsonHeaders(base.token), body: { profile_id: p2.json.id, geometry_id: geo.json.id } });
  eq(cand.status, 200);
  ok(Array.isArray(cand.json.diff) && cand.json.diff.length > 0, 'stroke-only change produced a non-empty diff');
  ok(cand.json.diff.some((c) => c.type === 'measurement_changed'), 'measurement_changed emitted: ' + JSON.stringify(cand.json.diff));
});

// R1 / F-15: concurrent /api/health served during a large compare
runner.test('R1 HTTP: health served while compare computes', async () => {
  // A corpus large enough that a synchronous compare would visibly block the loop.
  const verses = [];
  for (let v = 0; v < 3000; v++) verses.push('בראשית ברא אלהים את השמים ואת הארץ והארץ היתה תהו ובהו ויאמר אלהים יהי אור');
  const src = await request(server, 'POST', '/api/sources/import', {
    headers: jsonHeaders(base.token), body: { name: 'big', format: 'json', text: { books: [{ name: 'Genesis', chapters: [verses] }] }, unusual_letters: [] },
  });
  const geo = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(base.token), body: { name: 'wide2', line_width_mm: 400, lines_per_amud: 4 } });
  const p2 = await request(server, 'POST', '/api/profiles', { headers: jsonHeaders(base.token), body: { name: 'p2b', letter_height_mm: 5.0 } });
  const t0 = Date.now();
  const comparePromise = request(server, 'POST', '/api/compare', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, geometry_id: geo.json.id, profile_ids: [base.profile_id, p2.json.id] } });
  // Give the compare a moment to start, then probe health.
  await new Promise((r) => setTimeout(r, 5));
  const health = await request(server, 'GET', '/api/health');
  const healthMs = Date.now() - t0;
  eq(health.status, 200, 'health reachable during compare');
  ok(healthMs < 1000, 'health served within bounded time (' + healthMs + 'ms)');
  const cmp = await comparePromise;
  eq(cmp.status, 200, 'compare completes');
  ok(cmp.json && cmp.json.comparisons.length === 2, 'two profile comparisons returned');
});

// R2 / F-16: poll-based compute job reports real progress
runner.test('R2 HTTP: compute job poll returns progress and final layout_id', async () => {
  const src = await request(server, 'POST', '/api/sources/import', {
    headers: jsonHeaders(base.token), body: { name: 'pollsrc', format: 'json', text: { books: [{ name: 'Genesis', chapters: [['בראשית ברא אלהים את השמים', 'והארץ היתה תהו']] }] } },
  });
  const start = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: base.geometry_id, poll: true } });
  eq(start.status, 200);
  ok(start.json.job_id, 'job_id returned');
  let final = null;
  for (let i = 0; i < 200; i++) {
    const jr = await request(server, 'GET', '/api/layout/compute-job/' + start.json.job_id);
    if (jr.json.status === 'done') { final = jr.json; break; }
    if (jr.json.status === 'error') { final = jr.json; break; }
    await new Promise((r) => setTimeout(r, 10));
  }
  ok(final && final.status === 'done', 'job reached done: ' + JSON.stringify(final));
  ok(final.layout_id, 'job carries layout_id');
});

// R6/R7 HTTP: annotations unusual_letters override flows through recompute
runner.test('R6 HTTP: posted override reaches words[].override after recompute', async () => {
  const src = await request(server, 'POST', '/api/sources/import', {
    headers: jsonHeaders(base.token),
    body: { name: 'ovsrc', format: 'json', text: { books: [{ name: 'x', chapters: [['אבגד']] }] }, unusual_letters: [{ ref: 'x 1:1', letter: 'ב', occurrence_index: 0, type: 'large', width_override_mm: 9 }] },
  });
  eq(src.status, 200);
  const ov = await request(server, 'POST', '/api/layout/compute', {
    headers: jsonHeaders(base.token),
    body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: base.geometry_id, annotations: { unusual_letters: [{ occurrence_id: 'ul-0-large', type: 'large', width_override_mm: 12 }] } },
  });
  eq(ov.status, 200);
  const lay = await request(server, 'GET', '/api/layouts/' + ov.json.layout_id);
  const allOv = [];
  for (const line of lay.json.lines) for (const w of line.words) allOv.push(...(w.override || []));
  const hit = allOv.find((o) => o.type === 'large');
  ok(hit, 'override present');
  approx(hit.mm, 12, 1e-6, 'posted override width applied (12mm)');
});

// R12/F-36: engine geometry validation surfaces as 422, not 500
runner.test('R12 HTTP: overlap geometry returns 422 (not 500)', async () => {
  const l = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: base.source_id, profile_id: base.profile_id, geometry_id: base.geometry_id } });
  eq(l.status, 200);
  // force an overlap: create a geometry whose pitch is below the active letter height
  const geo = await request(server, 'POST', '/api/geometries', { headers: jsonHeaders(base.token), body: { name: 'overlap', line_width_mm: 80, lines_per_amud: 4, baseline_pitch_mm: 1.0 } });
  const r = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: base.source_id, profile_id: base.profile_id, geometry_id: geo.json.id } });
  eq(r.status, 422, 'overlap surfaces as 422');
  ok(!String(r.json.error || '').includes('sofer-studio'), 'no internal path in response');
});

const okAll = await runner.run();
await server.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
