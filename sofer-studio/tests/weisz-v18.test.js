import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, petuchaGapMm } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { processSource } from '../engine/source.js';
import { publicLine } from '../server/handlers.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

function profile() {
  const p = defaultProfile();
  return normalizeProfile({ ...p, units_per_row: null, letter_height_units: null, reference_height_mm: 3,
    letter_height_mm: 3, unit_mm: 1, stroke_mm: 0, stretch_policy: { ...p.stretch_policy,
      caps_percent: { 'א': 'unlimited', 'ב': 'unlimited', 'ג': 'unlimited', 'ד': 'unlimited' }, word_space_percent: 'unlimited' } });
}
const ids = result => result.lines.flatMap(line => line.letter_occurrence_ids);
const close = (a, b) => assert(Math.abs(a - b) < .01, `${a} != ${b}`);
const asset = file => readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

test('imported song pages reflow surrounding prose at song width with unchanged letter units and exact source order', async () => {
  const p = profile(), g = normalizeGeometry({ line_width_mm: 40, lines_per_amud: 8 });
  const raw = 'אב גד '.repeat(12) + 'l אב גדe אבmגדe אmאב גדmבe אב גד ' + 'אב גד '.repeat(100);
  const source = processSource({ format: 'stam', text: raw });
  const result = computeLayout(source, p, g);
  assert.deepEqual(result, await computeLayoutAsync(source, p, g));
  assert.equal(ids(result).length, source.letter_count);
  assert.deepEqual(ids(result), Array.from({ length: source.letter_count }, (_, i) => 'occ-' + i));
  const songPage = result.amudim.find(page => page.some(line => line.song_layout));
  assert(songPage.some(line => !line.fixed_pattern && !line.blank_line));
  assert(songPage.every(line => line.column_width_mm === 180));
  const prose = songPage.filter(line => !line.fixed_pattern && !line.blank_line);
  assert(prose.some(line => line.width_mm > 40), 'wider page must fit more words, not just widen their boxes');
  const ordinary = computeLayout(processSource({ text: 'אב גד א ב' }), p, g).lines.flatMap(line => line.words);
  const originalWidths = new Map(ordinary.map(word => [word.text, word.width_mm]));
  assert(result.lines.every(line => line.words.every(word => word.width_mm === originalWidths.get(word.text))));
  assert(result.amudim.slice(1).some(page => page.every(line => !line.column_width_mm)), 'ordinary pages return to ordinary width');
  const opening = songPage.find(line => line.manual_line_end && !line.song_layout);
  assert(opening); close(opening.stretched_width_mm, 180); close(opening.leftover_mm, 0);
});

test('song widening preserves paragraph boundaries, blank rows, holy letters and narrower song settings', async () => {
  const p = profile();
  for (const width of [30, 180]) {
    const g = normalizeGeometry({ line_width_mm: 60, lines_per_amud: 5, song_layouts: { hayam: { total_mm: width, right_mm: width / 3, left_mm: width / 3 } } });
    const source = processSource({ text: 'אב גד '.repeat(20) + 'p אבsגד אבl Cאב גדe אmבe אב גד '.repeat(3) + 'אב גד '.repeat(50) });
    const result = computeLayout(source, p, g);
    assert.deepEqual(result, await computeLayoutAsync(source, p, g));
    assert.deepEqual(ids(result), Array.from({ length: source.letter_count }, (_, i) => 'occ-' + i));
    assert.equal(result.lines.filter(line => line.petucha_end).length, 3);
    assert.equal(result.lines.filter(line => line.blank_line).length, 3);
    const holy = new Set(result.lines.flatMap(line => line.words.flatMap(word => word.letters.filter(letter => letter.holy).map(letter => letter.id))));
    assert.equal(holy.size, 3);
    assert(result.lines.every(line => line.stretch_decisions.every(decision => !holy.has(decision.letter_occurrence_id))));
    for (const line of result.lines.filter(line => line.petucha_end)) assert(line.width_mm + petuchaGapMm(effectiveProfile(p, g)) <= (line.column_width_mm || 60) + .01);
    for (const line of result.lines.filter(line => line.has_setuma)) assert.equal(line.setuma_at_edge, false);
  }
});

test('e then l fills exactly one explicit row, adds exactly one blank, and survives save and reload without changing old records', async () => {
  const s = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(s));
    async function call(method, path, body) { const r = await request(s, method, path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json; }
    const p = await call('POST', '/api/profiles', { ...profile(), name: 'QA profile' });
    const g = await call('POST', '/api/geometries', { line_width_mm: 125, baseline_pitch_mm: 7.5 });
    const src = await call('POST', '/api/sources/import', { name: 'Yehuda – שירה.stm', text: 'אב גדel !נ אב', format: 'stam' });
    const out = await call('POST', '/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g.id });
    assert.equal(out.source_name, src.name); assert.equal(out.source_id, src.id);
    assert.equal(out.lines.length, 3); close(out.lines[0].stretched_width_mm, 125); close(out.lines[0].leftover_mm, 0);
    assert.equal(out.lines[1].blank_line, true); assert.equal(out.lines[1].text, '');
    const before = s.db.prepare('SELECT * FROM layout_lines ORDER BY rowid').all();
    const saved = await call('GET', '/api/layouts/' + out.layout_id);
    assert.equal(saved.source_name, 'Yehuda – שירה.stm'); assert.equal(saved.lines[0].manual_line_end, true); assert.equal(saved.lines[1].blank_line, true);
    assert.deepEqual(saved.lines[0].stretch_decisions, out.lines[0].stretch_decisions);
    assert.equal(saved.lines[2].words[0].letters[0].stam_letter_mark.type, 'backward_nun');
    assert.deepEqual(s.db.prepare('SELECT * FROM layout_lines ORDER BY rowid').all(), before);
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { await s.close(); }
});

test('preview and download reverse only each page, keep footer metadata, and render blanks and both forms of backward nun', async () => {
  const dom = new JSDOM(asset('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(asset('core.js')); const SS = w.SS;
    SS.activeGeometry = () => ({ line_width_mm: 999 }); SS.activeSource = () => ({ name: 'Wrong selection' }); SS.toast = () => {};
    w.eval(asset('tikkun.js')); SS.tikkun.init({}); w.eval(asset('export.js')); SS.export.init({ api: {} });
    const p = profile(), g = normalizeGeometry({ line_width_mm: 125, lines_per_amud: 2, baseline_pitch_mm: 7.5 });
    const engine = computeLayout(processSource({ text: '! נel אבmגדe אב גדel אב גד' }), p, g);
    const lines = engine.lines.map(line => publicLine(line, effectiveProfile(p, g)));
    lines[lines.length - 1].items.push({ type: 'nun_hafucha', width_mm: 2 });
    const layout = { id: 'qa', source_name: 'Imported source.stm', source_id: 'source', geometry: g, snapshot: { profile: p }, summary: {}, lines };
    SS.state.layout = layout; SS.state.active.layoutId = layout.id;
    const copy = JSON.stringify(layout); SS.tikkun.render(layout);
    await new Promise(r => setTimeout(r, 50));
    const membership = () => [...d.querySelectorAll('.amud')].map(page => [page.dataset.amud, [...page.querySelectorAll('.line')].map(line => line.dataset.line)]);
    await SS.tikkun.preparePrint(); const before = membership();
    d.getElementById('export-reverse-lines').click();
    assert.equal(SS.tikkun.isReversed(), true); assert.equal(d.getElementById('preview-reverse-lines').checked, true);
    assert(d.querySelector('.sheet.reverse-lines')); assert.deepEqual(membership(), before); assert.equal(JSON.stringify(layout), copy);
    assert([...d.querySelectorAll('.page-footer')].every(footer => /Imported source.stm/.test(footer.textContent) && /Line height: 7.50 mm/.test(footer.textContent)));
    assert.match(d.querySelectorAll('.page-footer')[1].textContent, /Line width: 180.00 mm/);
    assert.equal(d.querySelectorAll('.legacy-note').length, 0);
    assert.equal(d.querySelectorAll('.marker-backward_nun').length, 2);
    assert.equal(d.querySelector('.nun-hafucha .ink-glyph').textContent, 'נ');
    assert.equal(d.querySelector('.nun-hafucha').dataset.widthMm, '2');
    SS.tikkun.finishPrint(); d.getElementById('preview-reverse-lines').click();
    assert.equal(d.getElementById('export-reverse-lines').checked, false); assert.equal(JSON.stringify(layout), copy);
  } finally { dom.window.close(); }
});
