import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { defaultProfile, normalizeProfile, HEBREW_LETTERS } from '../engine/profile.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { totalWidth } from '../engine/width.js';

const source = name => readFileSync(process.env.SOFER_TEST_PUBLIC_DIR
  ? resolve(process.env.SOFER_TEST_PUBLIC_DIR, name) : new URL('../public/' + name, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture(profile = null) {
  const dom = new JSDOM(source('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(source('core.js'));
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const SS = w.SS;
  SS.toast = () => {};
  SS.activeProfile = () => profile;
  SS.activeGeometry = () => null;
  SS.activeSource = () => null;
  return { dom, w, SS, d: w.document };
}
function input(f, selector, value, event = 'input') {
  const el = f.d.querySelector(selector);
  assert(el, 'Missing control: ' + selector);
  el.value = String(value);
  el.dispatchEvent(new f.w.Event(event, { bubbles: true }));
}

test('measurement table follows column width and row units and matches the engine including stroke factors', () => {
  const f = fixture();
  try {
    f.w.eval(source('calibration.js')); f.SS.calibration.init({ api: {} });
    f.w.eval(source('geometry.js')); f.SS.geometry.init({ api: {} });
    const check = (width, units) => {
      input(f, '#cal-units-per-row', units);
      input(f, '#geometry-body [data-field="line_width_mm"]', width);
      const draft = f.SS.calibration.getDraft();
      const calculated = effectiveProfile(normalizeProfile(draft), { line_width_mm: width });
      assert(Math.abs(draft.unit_mm - calculated.unit_mm) < 1e-10);
      assert(Math.abs(totalWidth('א', calculated) - (2 * width / units + calculated.stroke_mm * calculated.stroke_factors['א'])) < 1e-10);
      const row = f.d.querySelector('[data-letter="א"]');
      assert(Math.abs(Number(row.children[4].textContent) - totalWidth('א', calculated)) < .006);
      const space = f.d.querySelector('[data-measurement="word_space"]');
      assert(Math.abs(Number(space.children[4].textContent) - calculated.gaps.inter_word) < .006);
      assert.equal(calculated.units_per_row, units);
    };
    check(180, 62); check(180, 80); check(140, 80);
    f.SS.calibration.getDraft().stroke_factors['א'] = 2;
    check(160, 70);
  } finally { f.dom.window.close(); }
});

for (const policyKind of ['manual', 'percentage']) {
  test('opening and saving a ' + policyKind + ' profile preserves its saved rules and measurements', async () => {
    const original = normalizeProfile({ ...defaultProfile(), id: 'saved', name: 'Saved calibration', units_per_row: null,
      unit_basis: 'skeleton', layout_mode: 'reference', unit_mm: .37, stroke_factors: { 'א': 1.75 },
      non_stretchable: ['א', 'ב'], gaps: { inter_word: 2.75, inter_letter: .13 },
      stretch_policy: policyKind === 'manual' ? null : { version: 1, caps_percent: { 'א': 0, 'ב': 17, 'ר': 'unlimited' },
        word_space_percent: 23, setuma_percent: 12, setuma_first: true, distribution: 'equal_percent', stam_hyphen_units: 2.5 } });
    const before = structuredClone(original);
    const f = fixture(original);
    let body;
    try {
      f.w.eval(source('calibration.js'));
      f.SS.calibration.init({ api: { getProfile: async () => original, updateProfile: async (_, p) => (body = p, { ...p, id: 'saved' }), listProfiles: async () => [original] } });
      await tick();
      f.d.querySelector('#calibration-body .grid-crud .btn-primary').click();
      await tick();
      assert(body, 'Save did not submit the profile');
      for (const field of ['units_per_row', 'unit_basis', 'layout_mode', 'unit_mm', 'stretch_policy', 'non_stretchable', 'stroke_factors', 'letter_widths', 'gaps', 'max_stretch']) {
        assert.deepEqual(JSON.parse(JSON.stringify(body[field])), before[field], field + ' changed without an edit');
      }
      assert.deepEqual(original, before, 'Source profile was mutated');
    } finally { f.dom.window.close(); }
  });
}

test('restored measured glyphs retain exact holy marks, large/small letters and line-edge lamed', async () => {
  const f = fixture();
  try {
    f.w.eval(source('tikkun.js')); f.SS.tikkun.init({});
    const letters = [
      { id: 'a', base: 'ל', width_mm: 2 },
      { id: 'b', base: 'ה', width_mm: 2, holy: true },
      { id: 'c', base: 'ד', width_mm: 3, stam_letter_mark: { type: 'large' } },
      { id: 'd', base: 'ר', width_mm: 1, stam_letter_mark: { type: 'small' } },
      { id: 'e', base: 'ל', width_mm: 2 }
    ];
    const line = { line_id: 'line', amud: 1, line_index: 1, text: 'להדרל', width_mm: 10, leftover_mm: 0,
      words: [{ text: 'להדרל', width_mm: 10, letters }], items: [{ type: 'word' }],
      stretch_decisions: [{ letter_occurrence_id: 'c', stretch_mm: 1.5 }], inter_letter_gap_mm: 0 };
    f.SS.tikkun.render({ id: 'test', lines: [line], geometry: { line_width_mm: 11.5, lines_per_amud: 42, baseline_pitch_mm: 8 } });
    await tick();
    assert.equal(f.d.querySelectorAll('.ink-glyph').length, 5);
    assert.equal(f.d.querySelectorAll('.ink-glyph.holy-letter').length, 1);
    assert.equal(f.d.querySelector('.ink-glyph.holy-letter').textContent, 'ה');
    assert.equal(f.d.querySelector('.marker-large').style.width, '4.5mm');
    assert.equal(f.d.querySelector('.marker-small').style.width, '1mm');
    assert(f.d.querySelector('.lamed-line-start > .ink-glyph'));
    assert(f.d.querySelector('.lamed-line-end > .ink-glyph'));
    assert.equal(f.d.querySelector('.word-box').style.width, '11.5mm');
    assert.equal(line.words[0].width_mm, 10);
  } finally { f.dom.window.close(); }
});
