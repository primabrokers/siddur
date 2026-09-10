import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { effectiveProfile } from '../engine/stretch-policy.js';
import { computeLayout, normalizeGeometry, setumaGapMm } from '../engine/layout.js';
import { processSource } from '../engine/source.js';
import { totalWidth, unitsToMm, mmToUnits } from '../engine/width.js';
import { validateProfileInput } from '../server/validation.js';
import { validateLine } from '../engine/validate.js';

const geometry = normalizeGeometry({ line_width_mm: 186, max_letters_per_line: 0 });
const profile = (patch = {}) => normalizeProfile({ ...defaultProfile(), letter_height_units: null, stroke_mm: 0,
  stretch_policy: null, gaps: { inter_letter: 0, inter_word: 0 }, ...patch });
const flow = (text, p = profile(), g = geometry) => computeLayout(processSource({ text }), p, g);
const count = line => line.words.reduce((n, w) => n + w.letters.length, 0);

test('62 row units fit at most 31 two-unit letters, independent of vertical height', () => {
  for (const height of [3, 4.5, 7]) {
    const p = profile({ letter_height_mm: height });
    const result = flow(Array(80).fill('א').join(' '), p);
    assert.deepEqual(result.lines.map(count), [31, 31, 18]);
    const resolved = effectiveProfile(p, geometry);
    assert.equal(totalWidth('א', resolved), 6);
    assert.equal(mmToUnits(186, resolved), 62);
    assert.equal(unitsToMm(2, resolved), 6);
    assert.deepEqual(effectiveProfile(resolved, geometry), resolved);
    assert.deepEqual(validateProfileInput(resolved), []);
  }
});

test('three-unit and mixed letters consume their actual widths from the same 62-unit budget', () => {
  assert.deepEqual(flow(Array(45).fill('ש').join(' ')).lines.map(count), [20, 20, 5]);
  const mixed = flow(Array(80).fill(0).map((_, i) => i % 2 ? 'ש' : 'א').join(' '));
  assert.equal(count(mixed.lines[0]), 25); // 13 x 2 + 12 x 3 = 62.
  for (const line of mixed.lines) {
    const units = line.words.flatMap(w => w.letters).reduce((n, l) => n + (l.base === 'ש' ? 3 : 2), 0);
    assert(units <= 62);
    assert(Math.abs(line.width_mm - units * 3) < 1e-9);
  }
});

test('unused letters never rescale the letters being fitted, and column width never changes the unit budget', () => {
  const p = profile({ letter_widths: { ...defaultProfile().letter_widths, 'ש': 100 } });
  for (const width of [124, 186, 248]) {
    assert.deepEqual(flow(Array(64).fill('א').join(' '), p, { ...geometry, line_width_mm: width }).lines.map(count), [31, 31, 2]);
  }
});

test('word spaces, stroke and inter-letter gaps consume additional width', () => {
  const requested = defaultProfile();
  const p = profile({ stretch_policy: requested.stretch_policy });
  assert.deepEqual(flow(Array(33).fill('א').join(' '), p).lines.map(count), [21, 12]); // 21*2 + 20*1 = 62.
  assert.equal(count(flow(Array(64).fill('א').join(' '), profile({ stroke_mm: .2 })).lines[0]), 30);
  assert.equal(count(flow(Array(50).fill('אא').join(' '), profile({ gaps: { inter_letter: 1, inter_word: 0 } })).lines[0]), 28);
  const resolved = effectiveProfile(p, geometry);
  assert.equal(resolved.gaps.inter_word, 3);
  assert.equal(setumaGapMm(resolved, { setuma_gap_mm: 0 }), 60);
});

test('large and small letter marks count their scaled widths before fitting', () => {
  const result = flow(Array(50).fill('+א').join(' '));
  assert.equal(count(result.lines[0]), 20); // each marked letter is 3 units.
  const small = flow(Array(80).fill('–א').join(' '));
  assert.equal(count(small.lines[0]), 62); // each marked letter is 1 unit.
});

test('reflow preserves whole words and flags an indivisible overfull word', () => {
  const result = flow(Array(20).fill('א'.repeat(10)).join(' '));
  assert.equal(count(result.lines[0]), 30);
  assert(result.lines.every(l => l.words.every(w => w.letters.length === 10)));
  const overfull = flow('א'.repeat(32));
  assert.equal(overfull.lines.length, 1);
  assert.equal(count(overfull.lines[0]), 32);
  assert(overfull.lines[0].leftover_mm < 0);
  assert(validateLine(overfull.lines[0], effectiveProfile(profile(), geometry), geometry).errors.some(e => e.includes('overfull')));
});
