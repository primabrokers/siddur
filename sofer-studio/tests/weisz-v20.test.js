import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, buildWordUnits } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { processSource } from '../engine/source.js';
import { publicLine } from '../server/handlers.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

const profile = () => normalizeProfile({ ...defaultProfile(), units_per_row: 125 });
const geometry = n => normalizeGeometry({ line_width_mm: 125, lines_per_amud: n, baseline_pitch_mm: 7.5 });
const ids = result => result.lines.flatMap(line => line.letter_occurrence_ids);
const close = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const song = 'אב גדe ' + 'Cאבmגדe '.repeat(10);
const asset = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');

test('e wraps long prose at the configured width before ending the current line, with or without a following song', async () => {
  for (const suffix of ['טיכל מנסע', 'אבmגדe אmבmגe']) {
    const p = profile(), g = geometry(22);
    const source = processSource({ text: 'אב גד '.repeat(100) + 'הוזחe ' + suffix });
    const result = computeLayout(source, p, g);
    assert.deepEqual(result, await computeLayoutAsync(source, p, g));
    assert.deepEqual(ids(result), Array.from({ length: source.letter_count }, (_, i) => 'occ-' + i));
    const prose = result.lines.filter(line => !line.song_layout);
    assert(prose.length > 2, 'long text must wrap before the e');
    assert(prose.every(line => line.width_mm <= (line.column_width_mm || 125) + 1e-6));
    assert.equal(prose.filter(line => line.manual_line_end).length, 1);
    const end = result.lines.findIndex(line => line.manual_line_end);
    assert.equal(result.lines[end].words.at(-1).text, 'הוזח');
    assert.equal(result.lines[end + 1].words[0].text, suffix.startsWith('ט') ? 'טיכל' : 'אב');
    assert(result.lines.every(line => !line.song_page), 'a prose page must not acquire song-only scaling');
  }
});

test('t starts a page without adding blank pages or losing attached words; sync and async keep identical numbering', async () => {
  for (const [text, counts] of [
    ['אבtגד', [1, 1]], ['ttאבtגדttהוtt', [1, 1, 1]],
    ['אבe גדe הוe tזח', [3, 1]], ['אבtlגדtהו', [1, 2, 1]],
    ['tאבmגדe tהוmזחe tטי', [1, 1, 1]],
  ]) {
    const source = processSource({ text }), p = profile(), g = geometry(3);
    const out = computeLayout(source, p, g);
    assert.deepEqual(out, await computeLayoutAsync(source, p, g));
    assert.deepEqual(out.amudim.map(page => page.length), counts, text);
    assert.deepEqual(ids(out), Array.from({ length: source.letter_count }, (_, i) => 'occ-' + i));
    assert.deepEqual(out.lines.map(line => line.line_index), Array.from({ length: out.lines.length }, (_, i) => i + 1));
    out.amudim.forEach((page, index) => {
      assert(page.every(line => line.amud === index + 1));
      assert.deepEqual(page.map(line => line.line_in_amud), Array.from({ length: page.length }, (_, i) => i + 1));
      if (index) assert.equal(page[0].page_start, true);
    });
  }
});

test('an internal 11-row song bounded by t fills 22 rulings, while its adjacent prose pages keep normal size', async () => {
  const p = profile(), g = geometry(22), source = processSource({ text: 'אב גדt' + song + 'tהו זח' });
  const out = computeLayout(source, p, g);
  assert.deepEqual(out, await computeLayoutAsync(source, p, g));
  assert.deepEqual(out.amudim.map(page => page.length), [1, 11, 1]);
  assert(!out.lines[0].song_page); assert(!out.lines.at(-1).song_page);
  assert(out.amudim[1].every(line => line.song_page.scale === 2 && line.song_page.baseline_pitch_mm === 15));
  assert(out.amudim[1][0].page_start); assert(out.amudim[2][0].page_start);
  const regular = computeLayout(processSource({ text: song }), p, geometry(11));
  out.amudim[1].forEach((line, i) => line.words.forEach((word, w) => close(word.width_mm, regular.lines[i].words[w].width_mm * 2)));
  assert.equal(ids(out).length, source.letter_count);
});

test('d annotates the next letter, keeps capital holy annotations distinct, and works in txt detection and saved legacy imports', () => {
  for (const format of ['auto', 'txt', 'stam']) {
    const raw = 'dאב אdב dD .גtדה', source = processSource({ text: raw, format });
    const { units } = buildWordUnits(source);
    const letters = units.filter(unit => unit.type === 'word').flatMap(word => word.letters);
    assert.equal(source.original, raw); assert.equal(source.format, 'stam');
    assert.deepEqual(letters.map(letter => letter.base).join(''), 'אבאבגגדה');
    assert.deepEqual(letters.filter(letter => letter.stam_letter_mark?.type === 'dotted').map(letter => letter.id), ['occ-0', 'occ-3', 'occ-4', 'occ-5']);
    assert.deepEqual(letters.filter(letter => letter.holy).map(letter => letter.id), ['occ-4']);
    assert.equal(units.filter(unit => unit.type === 'page_break').length, 1);
  }
});

test('page breaks, local row numbering and dots survive saving, word moves and locking without rewriting older saved data', async () => {
  const s = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(s));
    async function call(method, path, body) { const r = await request(s, method, path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json; }
    const p = await call('POST', '/api/profiles', profile()), g = await call('POST', '/api/geometries', geometry(22));
    const src = await call('POST', '/api/sources/import', { name: 'Yehuda update.stm', text: 'dאב גדt' + 'אב גד '.repeat(100) + 'tהו זח', format: 'txt' });
    const out = await call('POST', '/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g.id });
    const path = '/api/layouts/' + out.layout_id;
    const before = await call('GET', path);
    assert.equal(before.summary.total_amudim, 3);
    assert.deepEqual(before.lines.map(line => [line.amud, line.line_in_amud, line.page_start]), out.lines.map(line => [line.amud, line.line_in_amud, line.page_start]));
    assert.equal(before.lines[0].words[0].letters[0].stam_letter_mark.type, 'dotted');
    const move = lineIndex => ({ line_id: before.lines[lineIndex].line_id, direction: 'down', line_key: before.lines[lineIndex].line_key, next_line_key: before.lines[lineIndex + 1]?.line_key });
    const blocked = await request(s, 'POST', path + '/move-word', { headers, body: move(0) });
    assert.equal(blocked.status, 409); assert.match(blocked.text, /explicit page start/);
    assert.deepEqual(await call('GET', path), before);
    await call('POST', path + '/move-word', move(1));
    const moved = await call('GET', path);
    assert.equal(moved.summary.total_amudim, 3); assert(moved.lines[1].page_start);
    assert.deepEqual(ids(moved), ids(before));
    await call('POST', path + '/lock', {});
    const locked = await call('GET', path); assert.equal(locked.status, 'locked');
    const rows = () => s.db.prepare('SELECT * FROM layout_lines WHERE layout_id=? ORDER BY line_index').all(out.layout_id);
    const stored = rows();
    await call('POST', '/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g.id });
    assert.deepEqual(rows(), stored); assert.deepEqual(await call('GET', path), locked);
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { await s.close(); }
});

test('preview and print retain t page membership and dotted marks, including reversed lines', async () => {
  const dom = new JSDOM(asset('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(asset('core.js')); const SS = w.SS; SS.toast = () => {};
    w.eval(asset('tikkun.js')); SS.tikkun.init({});
    const p = profile(), g = geometry(22), out = computeLayout(processSource({ text: 'dאבt' + song + 'tגד' }), p, g);
    const layout = { id: 'qa-v20', source_name: 'New commands.stm', geometry: g, snapshot: { profile: p }, lines: out.lines.map(line => publicLine(line, effectiveProfile(p, g))) };
    SS.state.layout = layout; SS.state.active.layoutId = layout.id;
    SS.tikkun.render(layout); await SS.tikkun.preparePrint();
    const pages = [...d.querySelectorAll('.amud')];
    assert.deepEqual(pages.map(page => page.querySelectorAll('.line').length), [1, 11, 1]);
    assert.equal(d.querySelectorAll('.marker-dotted').length, 1);
    const membership = () => [...d.querySelectorAll('.amud')].map(page => [...page.querySelectorAll('.line')].map(line => line.dataset.line));
    const before = membership(); SS.tikkun.setReverseLines(true); assert.deepEqual(membership(), before);
    assert.equal(parseFloat(pages[1].querySelector('.line').style.height), 15);
    SS.tikkun.finishPrint();
  } finally { dom.window.close(); }
});
