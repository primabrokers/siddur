import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStamInput } from '../engine/stam-input.js';
import { processSource } from '../engine/source.js';
import { buildWordUnits, computeLayout, computeLayoutAsync, normalizeGeometry } from '../engine/layout.js';
import { normalizeProfile } from '../engine/profile.js';
import { totalWidth } from '../engine/width.js';
import { publicLine } from '../server/handlers.js';

test('capital keys become exact human-marked Hebrew letters', () => {
  const parsed = parseStamInput('HוV');
  assert.equal(parsed.words[0].text, 'יוה');
  assert.deepEqual(parsed.words[0].holyLetterIndexes, [0, 2]);
});

test('STAM control syntax becomes metadata and never visible Latin text', () => {
  const parsed = parseStamInput('אpבsגlד1ה2ו3+א–ב.ג!');
  assert.deepEqual(parsed.markers.map((m) => m.type), ['p', 's', 'l', '1', '2', '3']);
  assert.deepEqual(parsed.words.at(-1).letterMarks.map((m) => m.type), ['large', 'small', 'dotted', 'backward_nun']);
  const doc = processSource({ format: 'stam', text: 'HוV p א s ב l ג1 ד2 ה3 +א –ב .ג !' });
  const { units } = buildWordUnits(doc);
  assert(units.some((u) => u.type === 'petucha'));
  assert(units.some((u) => u.type === 'setuma'));
  assert(units.some((u) => u.type === 'blank_line'));
  assert.equal(units.filter((u) => u.type === 'song_break').length, 3);
  const holy = units.find((u) => u.type === 'word').letters.filter((l) => l.holy);
  assert.deepEqual(holy.map((l) => l.base), ['י', 'ה']);
});

test('large and small controls change both measured and public preview widths', () => {
  const profile = normalizeProfile({ reference_height_mm: 3, letter_height_mm: 3, stroke_mm: 0, unit_mm: .5, non_stretchable: [] });
  const doc = processSource({ format: 'stam', text: '+א –א' });
  const result = computeLayout(doc, profile, normalizeGeometry({ line_width_mm: 80, lines_per_amud: 42 }));
  const [large, small] = result.lines[0].words;
  const base = totalWidth('א', profile);
  assert.equal(large.width_mm, base * 1.5);
  assert.equal(small.width_mm, base * (2/3));
  const preview = publicLine(result.lines[0], {...profile,small_letter_scale:2/3});
  assert.equal(preview.words[0].letters[0].width_mm, base * 1.5);
  assert.equal(preview.words[1].letters[0].width_mm, base * (2/3));
});

test('ordinary txt upload and paste automatically preserve English markers', () => {
  for (const options of [{}, { format: 'txt' }, { format: 'auto' }, { format: 'stam' }]) {
    const raw = 'בראשית HוV p אלהיםs יוםl שני';
    const doc = processSource({ text: raw, ...options });
    assert.equal(doc.format, 'stam');
    assert.equal(doc.original, raw);
    const { units } = buildWordUnits(doc);
    assert.deepEqual(units.filter(u => u.type !== 'word').map(u => u.type), ['petucha', 'setuma', 'blank_line']);
    assert.equal(units.find(u => u.text === 'אלהים').isShem, false, 'same spelling is not automatically holy');
    const marked = units.find(u => u.text === 'יוה');
    assert.deepEqual(marked.letters.map(l => l.holy), [true, false, true]);
    assert(!/[A-Za-z]/u.test(doc.consonant));
  }
});

test('uppercase P and X are Hebrew letters, not lowercase section commands', () => {
  const doc = processSource({ text: 'P X פ ס p אsב', format: 'stam' });
  const { units } = buildWordUnits(doc);
  assert.deepEqual(units.filter(u => u.type === 'word').map(u => u.text), ['פ', 'ס', 'פ', 'ס', 'א', 'ב']);
  assert.deepEqual(units.filter(u => u.type !== 'word').map(u => u.type), ['petucha', 'setuma']);
  assert.equal(units[0].letters[0].holy, true);
  assert.equal(units[2].letters[0].holy, false);
});

test('async web layout honours lowercase l as an actual blank line, plus p and s', async () => {
  const doc = processSource({ text: 'HוV p אבsגדl הו', format: 'txt' });
  const profile = normalizeProfile({});
  const geometry = normalizeGeometry({ line_width_mm: 100, lines_per_amud: 42 });
  const result = await computeLayoutAsync(doc, profile, geometry);
  assert(result.lines[0].petucha_end);
  assert(result.lines[1].has_setuma);
  assert(result.lines[2].blank_line);
  assert.equal(result.lines[2].words.length, 0);
  assert.equal(result.lines[3].words[0].text, 'הו');
  assert.deepEqual(publicLine(result.lines[0], profile).words[0].letters.map(l => l.holy), [true, false, true]);
});

test('unmarked Hebrew stays unmarked and unknown English input is not silently stripped', () => {
  const plain = processSource({ text: 'יהוה אלהים', format: 'txt' });
  assert.equal(plain.format, 'txt');
  assert(buildWordUnits(plain).units.every(u => !u.isShem));
  assert.throws(() => processSource({ text: 'HV hello אב', format: 'stam' }), /Unsupported STAM character/);
});
