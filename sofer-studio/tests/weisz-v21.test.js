import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStamInput } from '../engine/stam-input.js';
import { processSource } from '../engine/source.js';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { normalizeGeometry, computeLayout, computeLayoutAsync, stretchCandidatesOf, autoSuggestLine, applyStretch } from '../engine/layout.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { sourceControls, customGapWidth } from '../engine/document-options.js';
import { publicLine } from '../server/handlers.js';
import { editWordCount, editPageWidth } from '../engine/document-edit.js';
import { measurementUnitMm } from '../engine/width.js';
import { startTestServer, getToken, jsonHeaders, request } from './helpers.js';

const p = normalizeProfile({ ...defaultProfile(), units_per_row: 125 });
const geom = (n = 6, extra = {}) => normalizeGeometry({ line_width_mm: 125, lines_per_amud: n, baseline_pitch_mm: 7.5, document_flow: {}, ...extra });
const compute = (text, geometry = geom()) => computeLayout(processSource({ text }), p, geometry);
const ids = lines => lines.flatMap(line => line.letter_occurrence_ids);
const layout = (text, geometry = geom()) => {
  const computed = compute(text, geometry);
  return { ...computed, status: 'draft', snapshot: { profile: effectiveProfile(p, geometry), geometry } };
};

test('compound markers and notes remain metadata, a zero holy cap also protects rr letters', () => {
  const result = compute('frב zא nל bת (roof note)מ .ו rrד אב rrC');
  const line = result.lines[0], view = publicLine(line, effectiveProfile(p, geom()));
  assert.equal(view.words.map(word => word.consonant).join(' '), 'ב א ל ת מ ו ד אב ב');
  assert.deepEqual(view.words[0].letters[0].stam_letter_marks.map(m => m.type), ['four_tagin', 'large']);
  assert.equal(view.words[4].letters[0].stam_letter_marks[0].note, 'roof note');
  const protectedProfile = effectiveProfile(p, geom()); protectedProfile.stretch_policy.holy_name_percent = 0;
  const allowed = stretchCandidatesOf(line, protectedProfile);
  assert(allowed.length > 0); assert(allowed.every(c => c.letter === 'ד'));
  assert.equal(ids(result.lines).length, 10);
});

test('all 11-line exceptions and automatic song recognition preserve every letter', async () => {
  for (const [n, scale, overflow] of [[21, 2, 7.5], [28, 2.6, 4.5], [42, 4, 15], [22, 2, 0]]) {
    const g = geom(n), text = 'אבmגדe '.repeat(11), result = compute(text, g);
    assert.deepEqual(result, await computeLayoutAsync(processSource({ text }), p, g));
    assert.equal(result.lines.length, 11); assert.equal(result.amudim.length, 1);
    assert.equal(result.lines[0].song_layout.kind, 'haazinu');
    assert.equal(result.lines[0].song_page.scale, scale);
    assert(Math.abs(result.lines[0].song_page.overflow_mm - overflow) < 1e-8);
    assert.equal(ids(result.lines).length, 44);
  }
  assert(compute('אבmגדe אבmגדmוזe').lines.every(line => line.song_layout.kind === 'hayam'));
});

test('selected t markers set segment widths; ignoring t joins surrounding words; gaps keep adjacent words', () => {
  const source = processSource({ text: 'אבgגדtוזtחט' });
  assert.deepEqual(sourceControls(source), { page_starts: [{ id: 't-0', first_word: 'וז' }, { id: 't-1', first_word: 'חט' }], custom_gaps: [{ id: 'g-0', before: 'אב', after: 'גד' }] });
  const g = geom(6, { document_flow: { starts: { 't-0': { enabled: false }, 't-1': { enabled: true, width_mm: 150 } }, gaps: { 'g-0': { preset: 'custom', units: 5 } } } });
  const result = computeLayout(source, p, g);
  assert.equal(result.amudim.length, 2); assert.equal(result.lines[0].words.length, 3);
  assert.equal(result.lines[1].column_width_mm, 150); assert.equal(result.lines[1].segment_start_id, 't-1');
  assert.equal(result.lines[0].items[1].width_mm, 5);
  const measured = effectiveProfile(p, g);
  for (const preset of ['yod-2.5', 'asher-less-half', 'nine-yods', 'three-asher', 'three-asher-spaced']) assert(customGapWidth({ preset }, measured) > 0);
});

test('last-page fitting rounds page count, changes width without changing base word measurements', () => {
  const regular = compute('אב '.repeat(135));
  for (let count = 50; count <= 180; count += 10) {
    const text = 'אב '.repeat(count), base = compute(text), fitted = compute(text, geom(6, { document_flow: { fit_last_page: true } }));
    const desired = Math.max(1, Math.round(base.lines.length / 6));
    assert.equal(fitted.amudim.length, desired, 'count=' + count);
    assert.equal(fitted.amudim.at(-1).length, 6);
    assert.deepEqual(ids(fitted.lines), ids(base.lines));
    assert.equal(fitted.lines[0].words[0].width_mm, regular.lines[0].words[0].width_mm);
  }
});

test('vav and hamelech move the last qualifying word and refill pages with source order intact', () => {
  for (const [mode, word] of [['vav', 'ואב'], ['hamelech', 'המלך']]) {
    const text = ('אב גד '.repeat(20) + word + ' ').repeat(8);
    const g = geom(4, { document_flow: { column_start: mode, fit_boundary_page: true } });
    const result = compute(text, g), base = compute(text, geom(4));
    assert.deepEqual(ids(result.lines), ids(base.lines));
    assert(result.amudim.slice(1).every(page => mode === 'vav' ? page[0].first_word.startsWith('ו') : page[0].first_word === 'המלך'));
    assert(result.amudim.every(page => page.length === 4));
  }
});

test('word-count and per-page width edits preserve the preceding pages and guard written work', () => {
  const original = layout('אב גד '.repeat(220));
  const current = original.amudim[1][1], next = original.lines[current.line_index];
  const body = { line_id: current.line_id, line_key: current.line_key, next_line_key: next.line_key, word_count: current.words.length - 3, reflow: true };
  const edited = editWordCount(original, body);
  assert.equal(edited.lines[current.line_index - 1].words.length, body.word_count);
  assert.deepEqual(edited.lines.slice(0, current.line_index - 1), original.lines.slice(0, current.line_index - 1));
  assert.deepEqual(ids(edited.lines), ids(original.lines));
  const resized = editPageWidth(original, { amud: 2, line_key: original.amudim[1][0].line_key, units: 140 });
  assert.equal(resized.lines[6].column_width_mm, 140 * measurementUnitMm(original.snapshot.profile));
  assert.deepEqual(resized.lines.slice(0, 6), original.lines.slice(0, 6));
  assert.deepEqual(ids(resized.lines), ids(original.lines));
  original.lines.at(-1).status = 'written';
  assert.throws(() => editWordCount(original, body), /written/);
  assert.throws(() => editPageWidth(original, { amud: 2, line_key: original.amudim[1][0].line_key, units: 140 }), /written/);
});

test('HTTP editing persists page widths and marks, rejects stale edits, and leaves saved profiles intact', async () => {
  const server = await startTestServer(':memory:');
  try {
    const headers = jsonHeaders(await getToken(server));
    const post = async (path, body) => { const r = await request(server, 'POST', '/api/' + path, { headers, body }); assert.equal(r.status, 200, r.text); return r.json; };
    const profile = await post('profiles', p), geometry = await post('geometries', geom());
    const source = await post('sources/import', { name: 'v21', text: 'frב (a note)א nל bת zה .ו gאב ' + 'אב גד '.repeat(220), format: 'stam' });
    const controls = (await request(server, 'GET', '/api/sources/' + source.id)).json.controls;
    assert.equal(controls.custom_gaps.length, 1);
    const result = await post('layout/compute', { profile_id: profile.id, geometry_id: geometry.id, source_id: source.id });
    const get = async () => (await request(server, 'GET', '/api/layouts/' + result.layout_id)).json;
    const before = await get(), first = before.lines.find(line => line.amud === 2);
    const body = { amud: 2, line_key: first.line_key, units: 140 };
    await post('layouts/' + result.layout_id + '/page-width', body);
    const after = await get();
    assert.equal(after.lines.find(line => line.amud === 2).column_width_mm, 140);
    assert.equal(after.lines.find(line => line.amud === 2).flow_page_start, true);
    assert.deepEqual(after.snapshot.profile, before.snapshot.profile);
    assert.deepEqual(ids(after.lines), ids(before.lines));
    assert.equal(after.lines[0].words[0].letters[0].stam_letter_marks.length, 2);
    const stale = await request(server, 'POST', '/api/layouts/' + result.layout_id + '/page-width', { headers, body }); assert.equal(stale.status, 409);
    const line = after.lines[7], next = after.lines[8];
    await post('layouts/' + result.layout_id + '/move-word', { line_id: line.line_id, line_key: line.line_key, next_line_key: next.line_key, word_count: line.words.length - 3, reflow: true });
    const moved = await get(); assert.equal(moved.lines[7].words.length, line.words.length - 3); assert.deepEqual(ids(moved.lines), ids(before.lines));
    assert.equal((await request(server, 'POST', '/api/layouts/' + result.layout_id + '/page-width', { body, headers: { 'Content-Type': 'application/json' } })).status, 401);
  } finally { await server.close(); }
});

test('new imports use r and z; a hyphen is a width marker and + is rejected', () => {
  assert.throws(() => parseStamInput('+א'), /Unsupported/);
  const parsed = parseStamInput('-א zא rא');
  assert.equal(parsed.words[0].hyphens.length, 1); assert.equal(parsed.words[0].letterMarks.length, 0);
  assert.equal(parsed.words[1].letterMarks[0].type, 'small');
  assert.equal(parsed.words[2].letterMarks[0].type, 'large');
  assert.throws(() => parseStamInput('(note)'), /not followed/);
});

test('rr is exclusive even with a legacy profile and manual stretch requests', () => {
  const legacy = { ...effectiveProfile(p, geom()), stretch_policy: null };
  const result = computeLayout(processSource({ text: 'rrא אב' }), legacy, geom()), line = result.lines[0];
  const plan = autoSuggestLine(line, legacy); assert(plan.suggestions.length);
  applyStretch(line, plan.suggestions, legacy);
  assert(line.stretch_decisions.every(d => d.letter_occurrence_id === line.words[0].letters[0].id));
  assert.throws(() => applyStretch(line, [{ letter_occurrence_id: line.words[1].letters[0].id, stretch_mm: .1 }], legacy), /rejected/);
});
