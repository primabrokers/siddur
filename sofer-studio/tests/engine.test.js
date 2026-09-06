// tests/engine.test.js — width, stroke, scaling, 27 letters, invalid inputs, shem, source.

import { normalizeProfile, defaultProfile, HEBREW_LETTERS } from '../engine/profile.js';
import { referenceSkeletonWidthMm, skeletonWidth, strokeContribution, totalWidth, wordWidth, lineWidth, minColumnWidth, unitsToMm, mmToUnits, THRESHOLD_WORD } from '../engine/width.js';
import { analyzeToken } from '../engine/shem.js';
import { processSource } from '../engine/source.js';
import { createRunner, ok, eq, approx } from './harness.js';

const runner = createRunner();

runner.test('classic profile uses the requested units and stretch preferences', () => {
  const p = defaultProfile();
  for (const ch of Array.from('פםטארקךלחעכדץתצמהבסף')) eq(p.letter_widths[ch], 2);
  eq(p.letter_widths['ש'], 3);
  for (const ch of Array.from('ןויזנג')) eq(p.letter_widths[ch], 1);
  eq(p.units_per_row, 62);
  eq(p.stretch_priorities.petucha, 1); eq(p.stretch_priorities.setuma, 1);
  eq(p.special_widths_units.petucha, 20); eq(p.special_widths_units.setuma, 20);
});

runner.test('frozen fixture: 2.0mm ref skeleton at 3.0mm -> 3.0mm at 4.5mm; +0.2 stroke = 3.2; +0.3 = 3.3; scale unchanged', () => {
  const p = normalizeProfile({ reference_height_mm: 3.0, letter_height_mm: 4.5, unit_mm: 0.5, stroke_mm: 0.2, letter_widths: { 'א': 4 } });
  approx(referenceSkeletonWidthMm('א', p), 2.0);
  approx(skeletonWidth('א', p), 3.0);
  approx(totalWidth('א', p), 3.2);
  p.stroke_mm = 0.3;
  approx(totalWidth('א', p), 3.3);
  approx(skeletonWidth('א', p), 3.0, 1e-9, 'skeleton unchanged by stroke change');
});

runner.test('stroke added exactly once (total = skeleton + stroke)', () => {
  const p = normalizeProfile({ unit_mm: 0.5, reference_height_mm: 3.0, letter_height_mm: 3.0, stroke_mm: 0.5, letter_widths: { 'א': 4 } });
  approx(strokeContribution('א', p), 0.5);
  approx(totalWidth('א', p) - skeletonWidth('א', p), 0.5, 1e-9);
  approx(totalWidth('א', p), 2.0 + 0.5);
});

runner.test('proportional scaling with height', () => {
  const s1 = skeletonWidth('א', normalizeProfile({ unit_mm: 0.5, reference_height_mm: 3.0, letter_height_mm: 3.0, stroke_mm: 0, letter_widths: { 'א': 4 } }));
  const s2 = skeletonWidth('א', normalizeProfile({ unit_mm: 0.5, reference_height_mm: 3.0, letter_height_mm: 6.0, stroke_mm: 0, letter_widths: { 'א': 4 } }));
  approx(s2, s1 * 2, 1e-9);
});

runner.test('all 27 letters have widths', () => {
  const p = normalizeProfile({});
  eq(HEBREW_LETTERS.length, 27);
  for (const ch of HEBREW_LETTERS) ok(Number.isFinite(p.letter_widths[ch]), 'width for ' + ch);
});

runner.test('unit <-> mm conversion', () => {
  const p = normalizeProfile({ unit_mm: 0.5 });
  eq(unitsToMm(4, p), 2.0);
  eq(mmToUnits(2.0, p), 4);
});

runner.test('minColumnWidth = 3 * wordWidth(threshold) + 2 * interWordGap', () => {
  const p = normalizeProfile({});
  const ww = wordWidth(THRESHOLD_WORD, p);
  const gap = p.gaps.inter_word;
  approx(minColumnWidth(p), 3 * ww + 2 * gap, 1e-9);
});

runner.test('invalid inputs are safe (non-finite)', () => {
  const p = normalizeProfile({ unit_mm: 0.5, reference_height_mm: 3.0, letter_height_mm: NaN, stroke_mm: 0, letter_widths: { 'א': 4 } });
  // NaN height falls back to default via normalizeProfile
  ok(Number.isFinite(p.letter_height_mm));
  ok(Number.isFinite(totalWidth('א', p)));
  const pneg = normalizeProfile({ unit_mm: 0.5, reference_height_mm: 3.0, letter_height_mm: 4.5, stroke_mm: -1, letter_widths: { 'א': 4 } });
  ok(Number.isFinite(totalWidth('א', pneg)));
});

runner.test('lineWidth sums letter widths + gaps', () => {
  const p = normalizeProfile({ gaps: { inter_letter: 0, inter_word: 1.0 } });
  const toks = ['אב', 'גד', 'הו'];
  const expected = wordWidth('אב', p) + wordWidth('גד', p) + wordWidth('הו', p) + 2 * 1.0;
  approx(lineWidth(toks, p), expected, 1e-9);
});

// ---- holy-name safety ------------------------------------------------------

runner.test('holy names: spelling is never classified by the program', () => {
  for (const spelling of ['יהוה', 'אלהים', 'אל', 'אדני', 'עליון']) {
    eq(analyzeToken(spelling), null, 'human decision required for ' + spelling);
  }
});

// ---- source ---------------------------------------------------------------

runner.test('source: counts, hash, markers, excerpt label', () => {
  const d = processSource({ name: 'x', text: 'בראשית ברא אלהים את השמים {ס}\nוהארץ היתה תהו {פ}' });
  eq(d.verse_count, 2);
  ok(d.letter_count > 0);
  ok(d.word_count > 0);
  eq(d.revision_hash.length, 64);
  eq(d.verses[0].after, 'setuma');
  eq(d.verses[1].after, 'petucha');
  eq(d.excerpt, true);
  ok(d.warnings.some((w) => w.includes('excerpt')));
});

runner.test('source: json structure with book/verse refs', () => {
  const d = processSource({ name: 'x', format: 'json', text: JSON.stringify({ books: [{ name: 'בראשית', chapters: [['בראשית', 'והארץ']] }] }) });
  eq(d.book_count, 1);
  eq(d.verse_count, 2);
  eq(d.excerpt, false);
  eq(d.verses[0].ref, 'בראשית 1:1');
});

runner.test('source: hash stable for identical input', () => {
  const a = processSource({ name: 'x', text: 'בראשית' });
  const b = processSource({ name: 'x', text: 'בראשית' });
  eq(a.revision_hash, b.revision_hash);
});


// ---- E5/E6: source object import + dots + qere ----

runner.test('E5: processSource preserves dot metadata from RAW text (U+05C4)', () => {
  const d = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אׄב']] }] }) });
  ok(d.unusual_letters.length > 0, 'dot detected and preserved');
  eq(d.unusual_letters[0].letter, 'א');
  eq(d.unusual_letters[0].type, 'dotted');
});

runner.test('E5: processSource preserves occurrence_index on imported unusual letters', () => {
  const d = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אב']] }] }), unusual_letters: [{ ref: 'x 1:1', letter: 'א', occurrence_index: 3, width_override_mm: 120 }] });
  eq(d.unusual_letters[0].occurrence_index, 3, 'occurrence_index preserved');
});

runner.test('E6: source object import retains transport string + canonical object', () => {
  const obj = { books: [{ name: 'x', chapters: [['אב'], ['גד']] }] };
  const d = processSource({ format: 'json', text: obj });
  eq(typeof d.original, 'string', 'original is the transport string');
  eq(d.canonical.books[0].name, 'x', 'canonical complete object retained');
  eq(d.canonical.books[0].chapters.length, 2, 'structured chapter array retained');
});

runner.test('E6: bracketed alternatives produce a qere/ketiv warning, not certified', () => {
  const d = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['הוצא [היצ]']] }] }) });
  eq(d.has_qere_ketiv, true);
  ok(d.warnings.some((w) => w.includes('ketiv/qere')), 'qere/ketiv warning present');
  ok(!/certified scribal/.test(d.source_label), 'never labelled certified scribal text');
});

const okAll = await runner.run();
process.exit(okAll ? 0 : 1);
