import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { processSource } from '../engine/source.js';
import { parseStamInput } from '../engine/stam-input.js';
import { computeLayout, computeLayoutAsync, normalizeGeometry, autoSuggestLine, applyStretch, stretchCandidatesOf } from '../engine/layout.js';
import { moveWord } from '../engine/line-edit.js';
import { validateProfileInput } from '../server/validation.js';
const asset = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function profile() {
  return normalizeProfile({ ...defaultProfile(), units_per_row: null, letter_height_units: null,
    reference_height_mm: 3, letter_height_mm: 3, unit_mm: 1,
    stretch_policy: { ...defaultProfile().stretch_policy,
      caps_percent: { 'ב': 50 }, word_space_percent: 0,
      secondary: { caps_percent: { 'ב': 200 }, priorities: { 'ב': 1 } } } });
}
function ui() {
  const dom = new JSDOM(asset('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.eval(asset('core.js')); w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = function() {};
  const SS = w.SS; SS.toast = () => {}; SS.activeProfile = () => null; SS.activeGeometry = () => null; SS.activeSource = () => null;
  return { dom, w, SS, d: w.document };
}

test('ASCII minus and plus are single-letter size commands, retaining exact holy marks and legacy width markers', () => {
  const parsed = parseStamInput('+א -ב -C אב--גד הו-');
  assert.deepEqual(parsed.words.slice(0, 3).map(w => w.letterMarks[0].type), ['large', 'small', 'small']);
  assert.deepEqual(parsed.words[2].holyLetterIndexes, [0]);
  assert.equal(parsed.words[3].hyphens.length, 2);
  assert.equal(parsed.words[4].hyphens.length, 1);
  const doc = processSource({ text: '+א -א א' });
  assert.equal(doc.format, 'stam');
  const line = computeLayout(doc, profile(), normalizeGeometry({ line_width_mm: 80 })).lines[0];
  assert.deepEqual(line.words.map(w => w.width_mm), [3, 1, 2]);
});

test('m/e gives two or three complete song segments, identical through the web and sync fitters', async () => {
  const doc = processSource({ text: 'אב גדmהוe זחmטיmכלe מנ' });
  const p = profile(), g = normalizeGeometry({ line_width_mm: 40 });
  const result = computeLayout(doc, p, g), web = await computeLayoutAsync(doc, p, g);
  assert.deepEqual(web.lines.map(l => [l.text, l.width_mm, l.fixed_pattern]), result.lines.map(l => [l.text, l.width_mm, l.fixed_pattern]));
  assert.deepEqual(result.lines.map(l => l.text), ['אב גד הו', 'זח טי כל', 'מנ']);
  assert.deepEqual(result.lines.slice(0, 2).map(l => l.items.filter(i => i.type === 'segment_gap').length), [1, 2]);
  for (const line of result.lines.slice(0, 2)) { assert(line.fixed_pattern); assert.equal(line.width_mm, 40); assert.equal(autoSuggestLine(line, p).suggestions.length, 0); }
  const overfull = await computeLayoutAsync(processSource({ text: 'אב אב אבmאבe' }), p, normalizeGeometry({ line_width_mm: 5 }));
  assert.equal(overfull.lines.length, 1); assert(overfull.lines[0].leftover_mm < 0);
});

test('secondary caps fill only a first-pass shortfall, remain total caps, and preserve holy letters', () => {
  const p = profile(), source = processSource({ text: 'בב' });
  let line = computeLayout(source, p, normalizeGeometry({ line_width_mm: 10 })).lines[0];
  let plan = autoSuggestLine(line, p);
  assert.deepEqual(plan.suggestions.map(d => d.stretch_mm), [3, 3]); assert.equal(plan.shortfall_mm, 0);
  applyStretch(line, plan.suggestions, p); assert.equal(line.stretched_width_mm, 10);
  assert.deepEqual(autoSuggestLine(line, p), plan, 'reapplying does not shrink or compound the two passes');
  assert.throws(() => applyStretch(line, [{ letter_occurrence_id: line.words[0].letters[0].id, stretch_mm: 4.1 }], p), /cap/);
  line = computeLayout(source, p, normalizeGeometry({ line_width_mm: 5 })).lines[0];
  assert(stretchCandidatesOf(line, p).every(c => c.cap_mm === 1));
  assert.deepEqual(autoSuggestLine(line, p).suggestions.map(d => d.stretch_mm), [.5, .5]);
  line = computeLayout(processSource({ text: 'Cב', format: 'stam' }), p, normalizeGeometry({ line_width_mm: 8 })).lines[0];
  plan = autoSuggestLine(line, p); assert.equal(plan.suggestions.length, 1);
  assert.equal(plan.suggestions[0].letter_occurrence_id, line.words[0].letters[1].id);
  assert.deepEqual(validateProfileInput(p), []);
  p.stretch_policy.secondary.caps_percent['ב'] = -1;
  assert(validateProfileInput(p).some(e => e.includes('secondary')));
});

test('manual arrows retain text, exact letter identities and measured overflow, including across pages', () => {
  const p = profile(), g = normalizeGeometry({ line_width_mm: 9, lines_per_amud: 1 });
  const computed = computeLayout(processSource({ text: 'אב גד הו זח טי כל מנ' }), p, g);
  const layout = { id: 'x', status: 'draft', ...computed, snapshot: { profile: p, geometry: g } };
  const original = JSON.stringify(layout), ids = layout.lines.flatMap(l => l.letter_occurrence_ids);
  const request = { line_id: layout.lines[0].line_id, direction: 'up', line_key: layout.lines[0].line_key, next_line_key: layout.lines[1].line_key };
  const moved = moveWord(layout, request);
  assert(moved.lines[0].leftover_mm < 0); assert.equal(moved.lines[0].stretch_decisions.length, 0);
  assert.deepEqual(moved.lines.flatMap(l => l.letter_occurrence_ids), ids);
  assert.equal(JSON.stringify(layout), original, 'planning leaves original untouched');
  const restored = moveWord({ ...layout, lines: moved.lines }, { line_id: moved.lines[0].line_id, direction: 'down', line_key: moved.lines[0].line_key, next_line_key: moved.lines[1].line_key });
  assert.deepEqual(restored.lines.map(l => l.text), layout.lines.map(l => l.text));
  assert.throws(() => moveWord({ ...layout, status: 'locked' }, request), /Locked/);
  assert.throws(() => moveWord(layout, { ...request, line_key: 'stale' }), /Reload/);
});

test('profile preset and both fallback columns save the supplied measurements and separate row preferences', async () => {
  const f = ui(); let body;
  try {
    const preset = JSON.parse(asset('profiles/4mm-yad.profile.json'));
    f.w.fetch = async () => ({ ok: true, json: async () => preset });
    f.w.eval(asset('calibration.js'));
    f.SS.calibration.init({ api: { createProfile: async p => (body = structuredClone(p), { ...p, id: 'saved' }), listProfiles: async () => [] } });
    const select = f.d.getElementById('cal-preset'); select.value = '4mm-yad'; select.dispatchEvent(new f.w.Event('change')); await tick();
    assert.equal(f.SS.calibration.getDraft().name, '4mm yad'); assert.equal(f.SS.calibration.getDraft().units_per_row, 73.3);
    assert.deepEqual(JSON.parse(JSON.stringify(f.SS.calibration.getDraft().letter_widths)), preset.letter_widths);
    const units = f.d.querySelector('[aria-label="skeleton units for א"]'); units.stepUp(); units.dispatchEvent(new f.w.Event('input'));
    assert.equal(f.SS.calibration.getDraft().letter_widths['א'], 2.4);
    for (const [letter, value] of [['א', 150], ['ב', 200]]) {
      const cap = f.d.querySelector('[aria-label="stretch cap for second ' + letter + '"]'); cap.value = value; cap.dispatchEvent(new f.w.Event('input'));
    }
    f.d.querySelector('#calibration-body .grid-crud .btn-primary').click(); await tick();
    assert.equal(body.stretch_policy.secondary.caps_percent['א'], 150); assert.equal(body.stretch_policy.secondary.caps_percent['ב'], 200);
    assert.deepEqual(validateProfileInput(body), []);
  } finally { f.dom.window.close(); }
});

test('preview rounds only the Hebrew shortage, hides intentional gaps, shows Arabic line numbers and bottom page counts', () => {
  const f = ui(); try {
    f.w.eval(asset('tikkun.js')); f.SS.tikkun.init({});
    const lines = [2.4, 2.6, -3.2, 4, -4].map((gap, i) => ({ line_id: 'line-' + i, amud: 1, line_index: i + 1, text: 'אב', base_leftover_mm: gap, leftover_mm: gap, petucha_end: i >= 3, words: [] }));
    f.SS.tikkun.render({ id: 'preview', lines, geometry: { line_width_mm: 100, lines_per_amud: 42 }, snapshot: { profile: { units_per_row: 100 } } });
    assert.deepEqual([...f.d.querySelectorAll('.lnum')].map(x => x.textContent), ['1', '2', '3', '4', '5']);
    assert.deepEqual([...f.d.querySelectorAll('.side')].map(x => x.textContent), ['ח״ב', 'ח״ג', 'י״ג', '', 'י״ד']);
    assert.equal(f.d.querySelector('.side').dataset.missingUnits, '2.4');
    assert.equal(f.d.querySelector('.sheet-head'), null); assert.equal(f.d.querySelector('.page-footer').textContent, '1 of 1');
    assert.equal(f.d.querySelectorAll('[data-move-word]').length, 10);
  } finally { f.dom.window.close(); }
});

test('deleting a layout requires the user confirmation and clears the selected layout after success', async () => {
  const f = ui(); let deleted = 0;
  try {
    f.w.eval(asset('layouts.js')); f.SS.state.layouts = [{ id: 'target', name: 'Draft' }];
    f.SS.state.active.layoutId = 'target'; f.SS.state.layout = { id: 'target' };
    f.SS.layouts.init({ api: { deleteLayout: async id => { assert.equal(id, 'target'); deleted++; }, listLayouts: async () => [] } });
    const button = f.d.querySelector('[aria-label="Delete layout Draft"]');
    f.w.confirm = () => false; button.click(); await tick(); assert.equal(deleted, 0);
    f.w.confirm = () => true; button.click(); await tick(); assert.equal(deleted, 1); assert.equal(f.SS.state.layout, null);
  } finally { f.dom.window.close(); }
});
