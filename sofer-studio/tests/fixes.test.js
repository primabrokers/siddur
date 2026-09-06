// tests/fixes.test.js — regression tests for the review findings (F-01..F-26).
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { startTestServer, request, jsonHeaders, getToken, bootstrap, compute } from './helpers.js';
import { createRunner, ok, eq, approx } from './harness.js';
import { normalizeProfile } from '../engine/profile.js';
import { normalizeGeometry, computeLayout, applyStretch, autoSuggestLine, renderPattern, resolvePatternsForSource, KNOWN_SPECIAL_PASSAGES } from '../engine/layout.js';
import { processSource } from '../engine/source.js';
import { searchVerse, parseVerseQuery, bookKey } from '../engine/search.js';
import { validateLayout, maxInterWordGap, validateSpacingBounds } from '../engine/validate.js';
import { totalWidth, wordWidth } from '../engine/width.js';

const P = normalizeProfile({ letter_height_mm: 4.5 });
const runner = createRunner();

// ---- F-01: stretch total can never exceed leftover -------------------------

runner.test('F-01: stretch sum over leftover rejected atomically', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, max_stretch: { 'ד': 1.5, 'ה': 1.5 } });
  const line = { width_mm: 10, leftover_mm: 0.5, base_leftover_mm: 0.5, stretch_decisions: [],
    words: [ { text: 'ד', isShem: false, letters: [{ id: 'a', base: 'ד' }] }, { text: 'ה', isShem: false, letters: [{ id: 'b', base: 'ה' }] } ] };
  let threw = false;
  try { applyStretch(line, [{ letter_occurrence_id: 'a', stretch_mm: 0.4 }, { letter_occurrence_id: 'b', stretch_mm: 0.4 }], p); }
  catch (e) { threw = true; }
  ok(threw, '0.8mm total over 0.5mm leftover rejected');
  eq(line.stretch_decisions.length, 0, 'atomic: no partial decisions persisted');
});

runner.test('F-01: stretch sum equal to leftover accepted + stretched_width_mm set', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, max_stretch: { 'ד': 1.5, 'ה': 1.5 } });
  const line = { width_mm: 10, leftover_mm: 0.5, base_leftover_mm: 0.5, stretch_decisions: [],
    words: [ { text: 'ד', isShem: false, letters: [{ id: 'a', base: 'ד' }] }, { text: 'ה', isShem: false, letters: [{ id: 'b', base: 'ה' }] } ] };
  const r = applyStretch(line, [{ letter_occurrence_id: 'a', stretch_mm: 0.3 }, { letter_occurrence_id: 'b', stretch_mm: 0.2 }], p);
  eq(r.decisions.length, 2);
  approx(line.leftover_mm, 0, 1e-6);
  approx(line.stretched_width_mm, 10.5, 1e-6, 'stretched width = width + total applied');
});

// ---- F-06: renderPattern strict head consumption ---------------------------

runner.test('F-06: reversed-token pattern rejected (source order preserved)', () => {
  const pattern = { passage_name: 'x', scheme_name: 's', slots: [{ index: 0, segments: [{ tokens: ['גד', 'אב'], gap_before_mm: 0 }], gap_after_mm: 0 }] };
  const sw = [{ text: 'אב', consonant: 'אב' }, { text: 'גד', consonant: 'גד' }];
  let threw = false;
  try { renderPattern(pattern, P, normalizeGeometry({ line_width_mm: 200 }), sw); }
  catch (e) { threw = true; }
  ok(threw, 'reversed tokens rejected');
});

runner.test('F-06: repeated word pattern accepted', () => {
  const pattern = { passage_name: 'x', scheme_name: 's', slots: [{ index: 0, segments: [{ tokens: ['אב', 'אב'], gap_before_mm: 0 }], gap_after_mm: 0 }] };
  const sw = [{ text: 'אב', consonant: 'אב' }, { text: 'אב', consonant: 'אב' }];
  const lines = renderPattern(pattern, P, normalizeGeometry({ line_width_mm: 200 }), sw);
  eq(lines.length, 1);
  eq(lines[0].tokens.length, 2);
});

// ---- F-07: segment gaps emitted, no double inter-word gap ------------------

runner.test('F-07: every segment gap (incl. first) emitted, no inter-word double-add', () => {
  const pattern = { passage_name: 'x', scheme_name: 's', slots: [{ index: 0, segments: [{ tokens: ['אב'], gap_before_mm: 5 }, { tokens: ['גד'], gap_before_mm: 7 }], gap_after_mm: 0 }] };
  const sw = [{ text: 'אב', consonant: 'אב' }, { text: 'גד', consonant: 'גד' }];
  const g = normalizeGeometry({ line_width_mm: 500 });
  const lines = renderPattern(pattern, P, g, sw);
  const items = lines[0].items;
  const gaps = items.filter((i) => i.type === 'segment_gap');
  eq(gaps.length, 2, 'two segment gaps, first included');
  approx(gaps[0].width_mm, 5, 1e-6);
  approx(gaps[1].width_mm, 7, 1e-6);
  const w1 = wordWidth('אב', P);
  const w2 = wordWidth('גד', P);
  approx(lines[0].width_mm, 5 + w1 + 7 + w2, 1e-3, 'gap counted once, no inter-word gap across boundary');
});

// ---- F-08: max inter-word gap strictly below reference ---------------------

runner.test('F-08: default max inter-word gap is strictly below small-letter width', () => {
  const small = totalWidth('י', P);
  const max = maxInterWordGap(P, {});
  ok(max < small, 'default max ' + max + ' < small ' + small);
});

runner.test('F-08: explicit max == small-letter width rejected unconditionally', () => {
  const small = totalWidth('י', P);
  const errs = validateSpacingBounds(P, { max_inter_word_gap_mm: small, min_inter_letter_gap_mm: 0, min_inter_word_gap_mm: 0 });
  ok(errs.some((e) => e.includes('strictly below')), 'explicit equality rejected');
});

// ---- F-09: setuma at START of line detected --------------------------------

runner.test('F-09: leading setuma flags validation error', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['{ס} אבגד']] }] }) });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  const V = validateLayout(L.lines, P, g);
  ok(V.lines.some((l) => l.errors.some((e) => e.includes('setuma gap at line edge'))), 'leading setuma flagged');
});

// ---- F-02: known special passages fail closed ------------------------------

runner.test('F-02: resolvePatternsForSource blocks known special passage without pattern', () => {
  const source = { name: 'x', excerpt: false, unusual_letters: [], verses: [
    { book: 'Exodus', chapter: 15, verse: 1, ref: 'Exodus 15:1' },
    { book: 'Exodus', chapter: 15, verse: 2, ref: 'Exodus 15:2' },
  ] };
  const { blockers } = resolvePatternsForSource(source, [], {});
  ok(blockers.length > 0, 'blocker emitted');
  ok(blockers.some((b) => (b.reason || '').includes('Shiras HaYam')), 'names the passage');
});

runner.test('F-02: computeLayout throws for known special passage, study_preview succeeds', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'Exodus', chapters: [[], [], [], [], [], [], [], [], [], [], [], [], [], [], ['אז ישיר משה ובני ישראל את השירה הזאת']] }] }) });
  const g = normalizeGeometry({ line_width_mm: 800 });
  let threw = false;
  try { computeLayout(src, P, g); } catch (e) { threw = true; }
  ok(threw, 'compute without pattern throws');
  const prev = computeLayout(src, P, g, { study_preview: true });
  ok(prev.summary.study_preview === true, 'study_preview flag recorded');
});

// ---- F-05: structured search ----------------------------------------------

runner.test('F-05: book normalization resolves English + Hebrew', () => {
  eq(bookKey('Genesis'), 'genesis');
  eq(bookKey('בראשית'), 'genesis');
  eq(bookKey('Exodus'), 'exodus');
  eq(bookKey('שמות'), 'exodus');
});

runner.test('F-05: verse search exact/gematria/no-false-positive', () => {
  const source = { verses: [
    { book: 'בראשית', chapter: 1, verse: 1, ref: 'בראשית 1:1' },
    { book: 'בראשית', chapter: 1, verse: 4, ref: 'בראשית 1:4' },
    { book: 'בראשית', chapter: 5, verse: 4, ref: 'בראשית 5:4' },
  ] };
  const layout = { lines: [
    { line_index: 1, amud: 1, verse_refs: ['בראשית 1:1'] },
    { line_index: 2, amud: 1, verse_refs: ['בראשית 1:4'] },
    { line_index: 3, amud: 2, verse_refs: ['בראשית 5:4'] },
  ] };
  const exact = searchVerse(source, layout, 'Genesis 1:4');
  eq(exact.results.length, 1);
  eq(exact.results[0].verse_ref, 'בראשית 1:4');
  const gem = searchVerse(source, layout, 'בראשית א:ד');
  eq(gem.results.length, 1, 'gematria 1:4');
  eq(gem.results[0].verse_ref, 'בראשית 1:4');
  const bare = searchVerse(source, layout, '1:4');
  eq(bare.results.length, 1, 'bare 1:4 does not match 5:4');
  eq(bare.results[0].verse_ref, 'בראשית 1:4');
});

// ---- F-18: ketiv-only working view ----------------------------------------

runner.test('F-18: bracketed qere alternative dropped from working tokens', () => {
  const d = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['הוצא [היצא] אתך']] }] }) });
  const consonants = d.verses[0].tokens.map((t) => t.consonant);
  ok(!consonants.includes('[היצא]'), 'bracketed token dropped');
  ok(consonants.includes('הוצא') && consonants.includes('אתך'), 'ketiv tokens kept');
});

// ---- HTTP boundary tests ---------------------------------------------------

const dbPath = fileURLToPath(new URL('../data/_test_fixes.db', import.meta.url));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
const server = await startTestServer(dbPath);
let base;

runner.test('http setup', async () => {
  base = await bootstrap(server);
  ok(base.token, 'token');
});

runner.test('F-02 HTTP: known special passage compute 422 without pattern, 200 with study_preview', async () => {
  const chapters = [];
  for (let i = 0; i < 14; i++) chapters.push([]);
  chapters.push(['אז ישיר משה ובני ישראל את השירה הזאת']);
  const src = await request(server, 'POST', '/api/sources/import', { headers: jsonHeaders(base.token), body: { name: 'ex15', format: 'json', text: { books: [{ name: 'Exodus', chapters }] } } });
  eq(src.status, 200);
  const denied = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: base.geometry_id } });
  eq(denied.status, 422, 'known special passage without pattern -> 422');
  const ok200 = await request(server, 'POST', '/api/layout/compute', { headers: jsonHeaders(base.token), body: { source_id: src.json.id, profile_id: base.profile_id, geometry_id: base.geometry_id, study_preview: true } });
  eq(ok200.status, 200, 'study_preview opt-in -> 200');
  eq(ok200.json.study_preview, true);
  eq(ok200.json.summary.study_preview, true);
});

runner.test('F-04 HTTP: stretch after live-profile change returns 200, edits saved line', async () => {
  const l = await compute(server, base.token, base);
  const line0 = l.lines[0];
  await request(server, 'PUT', '/api/profiles/' + base.profile_id, { headers: jsonHeaders(base.token), body: { letter_height_mm: 7.0 } });
  const st = await request(server, 'POST', '/api/layouts/' + l.layout_id + '/stretch', { headers: jsonHeaders(base.token), body: { line_id: line0.line_id, decisions: [] } });
  eq(st.status, 200, 'stretch after profile change is 200 (no reflow/500)');
  const full = await request(server, 'GET', '/api/layouts/' + l.layout_id);
  const reline = full.json.lines.find((x) => x.line_id === line0.line_id);
  approx(reline.width_mm, line0.width_mm, 1e-6, 'saved line width unchanged (not reflowed)');
});

runner.test('F-17 HTTP: PDF export disabled with 501', async () => {
  const l = await compute(server, base.token, base);
  const r = await request(server, 'GET', '/api/layouts/' + l.layout_id + '/export?format=pdf');
  eq(r.status, 501, 'PDF export is 501');
  ok(String(r.json && r.json.error || '').length > 0, 'honest message');
});

runner.test('F-25 HTTP: GET /api/sources/:id exposes unusual_letters', async () => {
  const src = await request(server, 'POST', '/api/sources/import', { headers: jsonHeaders(base.token), body: { name: 'dots', format: 'json', text: { books: [{ name: 'x', chapters: [['.אבגד']] }] } } });
  const g = await request(server, 'GET', '/api/sources/' + src.json.id);
  eq(g.status, 200);
  ok(Array.isArray(g.json.unusual_letters), 'unusual_letters array');
});

runner.test('F-23 HTTP: profile referenced by locked layout cannot be mutated', async () => {
  const l = await compute(server, base.token, base);
  await request(server, 'POST', '/api/layouts/' + l.layout_id + '/lock', { headers: jsonHeaders(base.token) });
  const put = await request(server, 'PUT', '/api/profiles/' + base.profile_id, { headers: jsonHeaders(base.token), body: { letter_height_mm: 8.0 } });
  eq(put.status, 409, 'PUT profile on locked-referenced profile -> 409');
});

runner.test('F-16 HTTP: paginated line fetch', async () => {
  const l = await compute(server, base.token, base);
  const all = await request(server, 'GET', '/api/layouts/' + l.layout_id);
  const total = all.json.lines.length;
  if (total > 2) {
    const page = await request(server, 'GET', '/api/layouts/' + l.layout_id + '?from=0&limit=2');
    eq(page.status, 200);
    eq(page.json.lines.length, 2, 'page size respected');
    eq(page.json.total_lines, total, 'total_lines reported');
  } else {
    ok(true, 'demo layout too small to paginate; skip');
  }
});

const okAll = await runner.run();
await server.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(okAll ? 0 : 1);
