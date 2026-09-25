import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { measurementUnitMm } from '../engine/width.js';
import { processSource } from '../engine/source.js';
import { publicLine } from '../server/handlers.js';
import { validateLayout } from '../engine/validate.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

const close = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const profile = () => normalizeProfile({ ...defaultProfile(), units_per_row: 125 });
const geometry = n => normalizeGeometry({ line_width_mm: 125, lines_per_amud: n, baseline_pitch_mm: 7.5, small_letter_reference: 'א' });
const song = Array.from({ length: 11 }, (_, i) => i === 0 ? 'אב גדe' : i % 2 ? 'Cאב גדmאב גדe' : 'אm+ב -גm!נe').join(' ');
const ids = result => result.lines.flatMap(line => line.letter_occurrence_ids);
const asset = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');

test('11 song rows fill 22 rulings with twice the letter height and base width, preserving column, source and holy markings', async () => {
  const p = profile(), g = geometry(22), source = processSource({ text: song });
  const unchanged = JSON.stringify({ p, g, source });
  const regular = computeLayout(source, p, geometry(11)), result = computeLayout(source, p, g);
  assert.deepEqual(result, await computeLayoutAsync(source, p, g));
  assert.equal(JSON.stringify({ p, g, source }), unchanged);
  assert.equal(result.amudim.length, 1); assert.equal(result.lines.length, 11);
  assert.deepEqual(ids(result), ids(regular));
  const baseProfile = effectiveProfile(p, g), unit = measurementUnitMm(baseProfile);
  result.lines.forEach((line, i) => {
    assert.equal(line.song_page.scale, 2); assert.equal(line.song_page.lines, 11);
    close(line.song_page.baseline_pitch_mm, 15);
    close(line.song_page.baseline_pitch_mm * 11, result.geometry.column_height_mm);
    close(line.song_page.letter_height_mm, baseProfile.letter_height_mm * 2);
    assert.equal(line.column_width_mm, 180); assert.equal(line.song_layout.total_mm, 180);
    assert.equal(line.line_in_amud, i + 1); assert.notEqual(line.line_key, regular.lines[i].line_key);
    const view = publicLine(line, baseProfile), normal = publicLine(regular.lines[i], baseProfile);
    view.words.forEach((word, wi) => {
      close(word.width_mm, normal.words[wi].width_mm * 2);
      word.letters.forEach((letter, li) => {
        close(letter.width_mm / unit, normal.words[wi].letters[li].width_mm / unit * 2);
        assert.equal(letter.holy, normal.words[wi].letters[li].holy);
        assert.deepEqual(letter.stam_letter_mark, normal.words[wi].letters[li].stam_letter_mark);
      });
    });
    close(view.inter_letter_gap_mm, normal.inter_letter_gap_mm * 2);
    close(view.inter_word_gap_mm, normal.inter_word_gap_mm * 2);
    const holy = new Set(view.words.flatMap(word => word.letters.filter(letter => letter.holy).map(letter => letter.id)));
    assert(view.stretch_decisions.every(d => !holy.has(d.letter_occurrence_id)));
  });
  const validation = validateLayout(result.lines, baseProfile, g);
  assert.equal(validation.valid, true, JSON.stringify(validation));
});

test('fractional scaling changes only a short song-only page and retains all regular page membership', () => {
  const p = profile(), g = geometry(22), prefix = 'אב גדe '.repeat(22);
  const result = computeLayout(processSource({ text: prefix + song }), p, g);
  assert.equal(result.amudim.length, 2); assert.equal(result.amudim[0].length, 22); assert.equal(result.amudim[1].length, 11);
  assert(result.amudim[0].every(line => !line.song_page));
  assert(result.amudim[1].every(line => line.song_page.scale === 2 && line.amud === 2));
  const regular = computeLayout(processSource({ text: prefix }), p, g);
  assert.deepEqual(result.amudim[0], regular.lines);
  const fractional = computeLayout(processSource({ text: 'אבmגדe '.repeat(10) }), p, g);
  fractional.lines.forEach(line => { close(line.song_page.scale, 2.2); close(line.song_page.baseline_pitch_mm * 10, 165); });
  for (const text of ['אבp ' + song, song + ' אב', song + 'l', 'אב גדe '.repeat(11), 'אבmגדe '.repeat(22)]) {
    const unscaled = computeLayout(processSource({ text }), p, g);
    assert(unscaled.lines.every(line => !line.song_page), text);
  }
});

test('Haazinu scales proportionally, and oversized song text is reported without shrinking or dropping letters', () => {
  const p = profile(), g = { ...geometry(22), song_layouts: { manual: 'haazinu' } };
  const source = processSource({ text: 'אבmגדe '.repeat(11) });
  const result = computeLayout(source, p, g);
  assert(result.lines.every(line => line.song_page.scale === 2 && line.column_width_mm === 170));
  const overflowSource = processSource({ text: ('א'.repeat(90) + 'm' + 'ב'.repeat(90) + 'e ').repeat(11) });
  const overflow = computeLayout(overflowSource, p, g);
  assert.equal(ids(overflow).length, overflowSource.letter_count);
  assert(overflow.lines.every(line => line.leftover_mm < 0));
  assert.equal(validateLayout(overflow.lines, effectiveProfile(p, g), g).valid, false);
});

test('physical stroke, legacy calibration and explicit letter overrides enlarge once, keeping occurrence identity', () => {
  const p = normalizeProfile({ ...defaultProfile(), units_per_row: null, letter_height_units: null,
    letter_height_mm: 3, reference_height_mm: 4, unit_mm: 0.75, stroke_mm: 0.2, gaps: { inter_letter: 0.1, inter_word: 0.8 } });
  const source = processSource({ text: 'אבmג--דe '.repeat(11) });
  source.unusual_letters = [{ ref: source.verses[0].ref, occurrence_id: 'occ-0', type: 'large', width_override_mm: 3.25 }];
  const full = computeLayout(source, p, geometry(11)), scaled = computeLayout(source, p, geometry(22));
  const view = publicLine(scaled.lines[0], effectiveProfile(p, geometry(22)));
  close(view.words[0].letters[0].width_mm, 6.5);
  close(view.words[0].override[0].mm, 6.5);
  scaled.lines.forEach((line, i) => line.words.forEach((word, j) => close(word.width_mm, full.lines[i].words[j].width_mm * 2)));
  assert.deepEqual(ids(full), ids(scaled));
});

test('a short reflowed reference song retains its book ending and provenance when enlarged', () => {
  const source = processSource({ text: 'אב גד '.repeat(11) });
  source.reference = { lines: Array.from({ length: 11 }, (_, i) => ({ page: 243, source_record: i + 1, fixed_pattern: true,
    items: [{ type: 'word', word_index: i * 2 }, { type: 'segment_gap' }, { type: 'word', word_index: i * 2 + 1 }] })) };
  const result = computeLayout(source, { ...profile(), layout_mode: 'reflow' }, geometry(22));
  assert(result.lines.every(line => line.song_page.scale === 2 && line.reference_page === 243));
  assert.equal(result.lines.at(-1).sefer_end, true); assert.equal(result.lines.at(-1).reference_record, 11);
  assert.equal(ids(result).length, source.letter_count);
});

test('page scaling survives API save, reload and locking while an existing saved layout stays byte-for-byte unchanged', async () => {
  const s = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(s));
    async function call(method, path, body) { const r = await request(s, method, path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json; }
    const p = await call('POST', '/api/profiles', profile());
    const g11 = await call('POST', '/api/geometries', geometry(11));
    const src = await call('POST', '/api/sources/import', { name: 'Song page.stm', text: song, format: 'stam' });
    const old = await call('POST', '/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g11.id });
    const stored = () => s.db.prepare('SELECT * FROM layout_lines WHERE layout_id=? ORDER BY line_index').all(old.layout_id);
    const before = stored();
    const oldSaved = await call('GET', '/api/layouts/' + old.layout_id);
    const g22 = await call('POST', '/api/geometries', geometry(22));
    const out = await call('POST', '/api/layout/compute', { source_id: src.id, profile_id: p.id, geometry_id: g22.id });
    const reload = await call('GET', '/api/layouts/' + out.layout_id);
    assert(reload.lines.every(line => line.song_page.scale === 2));
    assert.deepEqual(reload.lines.map(line => line.song_page), out.lines.map(line => line.song_page));
    assert.deepEqual(reload.lines.map(line => line.words), out.lines.map(line => line.words));
    close(reload.snapshot.profile.letter_height_mm, oldSaved.snapshot.profile.letter_height_mm);
    await call('POST', '/api/layouts/' + out.layout_id + '/lock', {});
    const locked = await call('GET', '/api/layouts/' + out.layout_id);
    assert.equal(locked.status, 'locked'); assert.deepEqual(locked.lines.map(line => line.song_page), reload.lines.map(line => line.song_page));
    const lineId = locked.lines[0].line_id;
    await call('POST', '/api/layouts/' + out.layout_id + '/progress', { line_id: lineId, status: 'written', lock: true });
    const candidate = await call('POST', '/api/layouts/' + out.layout_id + '/candidate', { profile_id: p.id, geometry_id: g11.id });
    assert(candidate.diff.some(change => change.deltas?.some(delta => delta.field === 'song_page_scale')));
    const adopted = await call('POST', '/api/layouts/' + out.layout_id + '/adopt-candidate', { candidate_id: candidate.candidate_id, verified_unchanged_lines: [lineId] });
    assert(adopted.refused_line_ids.includes(lineId));
    const revised = await call('GET', '/api/layouts/' + adopted.new_layout_id);
    assert.equal(revised.lines[0].status, 'pending'); assert.equal(revised.lines[0].song_page, null);
    assert.deepEqual(stored(), before);
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { await s.close(); }
});

test('preview and print use the scaled pitch, glyph height, footer and reverse ruler position at unchanged page height', async () => {
  const dom = new JSDOM(asset('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.eval(asset('core.js')); const SS = w.SS; SS.toast = () => {}; SS.activeGeometry = () => null; SS.activeSource = () => null;
    w.eval(asset('tikkun.js')); SS.tikkun.init({});
    const p = profile(), g = geometry(22), result = computeLayout(processSource({ text: 'אב גדe '.repeat(22) + song }), p, g);
    const snapshot = { profile: effectiveProfile(p, g), geometry: g };
    const layout = { id: 'qa-song', geometry: g, snapshot, summary: result.summary, lines: result.lines.map(line => publicLine(line, snapshot.profile)) };
    SS.state.layout = layout; SS.tikkun.render(layout); await new Promise(r => setTimeout(r, 40));
    await SS.tikkun.preparePrint();
    const pages = d.querySelectorAll('.amud'); assert.equal(pages.length, 2);
    const normal = pages[0].querySelector('.lines'), enlarged = pages[1].querySelector('.lines');
    assert.equal(normal.style.minHeight, '165mm'); assert.equal(enlarged.style.minHeight, '165mm');
    close(parseFloat(enlarged.style.fontSize), parseFloat(normal.style.fontSize) * 2);
    assert([...enlarged.querySelectorAll('.line')].every(line => line.style.height === '15mm'));
    assert.match(pages[1].querySelector('.page-footer').textContent, /Line width: 180.00 mm · Line height: 15.00 mm/);
    const copy = JSON.stringify(layout), order = [...enlarged.querySelectorAll('.line')].map(line => line.dataset.line);
    let tick; SS.bus.on('sargel:tick', value => { tick = value; });
    SS.tikkun.setReverseLines(true);
    enlarged.querySelector('.line').dispatchEvent(new w.MouseEvent('mouseenter'));
    close(tick, 150); assert.equal(JSON.stringify(layout), copy);
    assert.deepEqual([...enlarged.querySelectorAll('.line')].map(line => line.dataset.line), order);
    SS.tikkun.finishPrint();
  } finally { dom.window.close(); }
});
