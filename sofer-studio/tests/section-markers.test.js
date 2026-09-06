import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processSource, splitSourceTokens, sectionBreakSummary } from '../engine/source.js';
import { buildWordUnits, computeLayout, autoSuggestLine, normalizeGeometry } from '../engine/layout.js';
import { normalizeProfile } from '../engine/profile.js';

test('attached section markers split after the preceding word without changing the original', () => {
  for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
    const text = 'אבגד' + open + 'פ' + close + 'דהוז' + open + 'ס' + close + 'חטיכל';
    const doc = processSource({ text });
    assert.equal(doc.original, text);
    assert.deepEqual(doc.verses[0].tokens.map(t => t.marker || t.text), ['אבגד', 'petucha', 'דהוז', 'setuma', 'חטיכל']);
    assert.equal(doc.word_count, 3);
    assert.equal(doc.letter_count, 13);
    assert.equal(doc.consonant, 'אבגד דהוז חטיכל');
    assert.equal(doc.has_qere_ketiv, false, 'bracketed section markers are not qere alternatives');
    const units = buildWordUnits(doc);
    assert.deepEqual(units.units.map(u => u.type), ['word', 'petucha', 'word', 'setuma', 'word']);
    assert.equal(units.totalLetters, 13);
    assert.deepEqual(units.units.flatMap(u => u.letters || []).map(l => l.id), Array.from({ length: 13 }, (_, i) => 'occ-' + i));
  }
});

test('separated, space-padded and Tikkun hash-prefixed markers are recognised', () => {
  assert.deepEqual(splitSourceTokens('אב { פ } גד#(ס) הו [ס] זח'), ['אב', '{ פ }', 'גד', '(ס)', 'הו', '[ס]', 'זח']);
  const doc = processSource({ text: 'אב { פ } גד#(ס) הו [ס] זח' });
  assert.deepEqual(sectionBreakSummary(doc.verses), { petucha: 1, setuma: 2, present: true, verified: false });
});

test('normal word letters and markers inside qere alternatives are not section breaks', () => {
  const text = 'כעס אסף אב[גד {פ} הו [ס]] זח';
  const doc = processSource({ text });
  assert.equal(doc.consonant, 'כעס אסף אב זח');
  assert.equal(doc.has_qere_ketiv, true);
  assert.deepEqual(sectionBreakSummary(doc.verses), { petucha: 0, setuma: 0, present: false, verified: false });
});

test('JSON verse imports preserve attached marker placement and chapter references', () => {
  const doc = processSource({ format: 'json', text: { books: [{ name: 'Genesis', chapters: [['אב{פ}', 'גד(ס)הו']] }] } });
  assert.equal(doc.verses[0].ref, 'Genesis 1:1');
  assert.equal(doc.verses[1].ref, 'Genesis 1:2');
  assert.deepEqual(sectionBreakSummary(doc.verses), { petucha: 1, setuma: 1, present: true, verified: false });
});

test('attached boundaries produce real line-end/internal gaps, excluded from auto stretch', () => {
  const profile = normalizeProfile({});
  const doc = processSource({ text: 'אבגד{פ}דהוז(ס)חטיכל' });
  const layout = computeLayout(doc, profile, normalizeGeometry({ line_width_mm: 150, lines_per_amud: 42 }));
  assert.equal(layout.lines.length, 2);
  assert.equal(layout.lines[0].last_word, 'אבגד');
  assert.equal(layout.lines[0].petucha_end, true);
  assert.equal(layout.lines[1].has_setuma, true);
  assert.deepEqual(layout.lines[1].items.map(i => i.type), ['word', 'setuma_gap', 'word']);
  assert(layout.lines[1].items[1].width_mm > 0);
  for (const line of layout.lines) {
    assert.deepEqual(autoSuggestLine(line, profile).suggestions, []);
    assert(!/[{}()[\]]/u.test(line.text));
  }
});
