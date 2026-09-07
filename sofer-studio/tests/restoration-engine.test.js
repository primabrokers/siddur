import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, normalizeProfile } from '../engine/profile.js';
import { balancedSuggestions, measuredLetterWidth, letterCap } from '../engine/stretch-policy.js';
import { setumaGapMm } from '../engine/layout.js';
import { totalWidth } from '../engine/width.js';

test('numeric preferences use 2 before 10, rather than sorting as text', () => {
  const suggestions = balancedSuggestions([
    { letter_occurrence_id: 'late', priority: 10, cap_mm: 10, base_width_mm: 1 },
    { letter_occurrence_id: 'first', priority: 2, cap_mm: 10, base_width_mm: 1 },
  ], 5, 'equal_mm');
  assert.deepEqual(suggestions.map(s => s.letter_occurrence_id), ['first']);
});
test('the new 20-unit setumah minimum does not change older profile geometry', () => {
  for (const stretch_policy of [null, { version: 1 }]) {
    const p = normalizeProfile({ unit_mm: .5, stretch_policy });
    assert.equal(setumaGapMm(p, { setuma_gap_mm: 2 }), 2);
    assert.equal(setumaGapMm(p, {}), 9 * totalWidth('א', p));
  }
  assert.equal(setumaGapMm(defaultProfile(), { setuma_gap_mm: 2 }), 10);
});
test('the 50-percent cap uses the actual marked small or large letter width', () => {
  const p = defaultProfile();
  p.stretch_policy.caps_percent['א'] = 50;
  for (const [type, factor] of [['small', .5], ['large', 1.5]]) {
    const letter = { id: 'letter', base: 'א', stam_letter_mark: { type } };
    const width = totalWidth('א', p) * factor;
    assert.equal(measuredLetterWidth({}, letter, p), width);
    assert(letterCap({}, letter, p, 20) <= width / 2 + 1e-9);
    assert(width / 2 - letterCap({}, letter, p, 20) < .001);
  }
});
