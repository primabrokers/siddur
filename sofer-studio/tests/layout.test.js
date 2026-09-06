// tests/layout.test.js — threshold, geometry, petucha/setuma, vavei, stretch caps,
// Shem atomicity, patterns, unusual letters, progress.

import { normalizeProfile } from '../engine/profile.js';
import { normalizeGeometry, deriveGeometry, fullYeriaWidth, computeYerios, computeLayout, computeLayoutAsync, groupAndAnnotate, applyStretch, autoSuggestLine, renderPattern } from '../engine/layout.js';
import { minColumnWidth } from '../engine/width.js';
import { processSource } from '../engine/source.js';
import { validateLayout, validateSpacingBounds } from '../engine/validate.js';
import { createRunner, ok, eq, approx } from './harness.js';

const runner = createRunner();
const P = normalizeProfile({ letter_height_mm: 4.5 });

// ---- geometry -------------------------------------------------------------

runner.test('geometry: inkExtent = (L-1)*P + H; allocated = L*P; trailing margin', () => {
  const g = normalizeGeometry({ baseline_pitch_mm: 8.0, lines_per_amud: 42 });
  const d = deriveGeometry(g, P);
  approx(d.inkExtent_mm, 41 * 8 + 4.5);
  approx(d.allocatedRulingHeight_mm, 42 * 8);
  approx(d.trailingMargin_mm, 42 * 8 - (41 * 8 + 4.5));
  eq(d.trailingMargin_mm, 3.5);
});

runner.test('geometry: reject baseline pitch below letter height (overlap)', () => {
  let threw = false;
  try {
    deriveGeometry(normalizeGeometry({ baseline_pitch_mm: 4.0, lines_per_amud: 42 }), P);
  } catch (e) { threw = true; }
  ok(threw, 'expected overlap rejection');
});

runner.test('yeria widths: full = 2*outer + k*line + (k-1)*gap', () => {
  const g = normalizeGeometry({ outer_margin_mm: 10, line_width_mm: 160, inter_column_gap_mm: 12, amudim_per_yeria: 2 });
  approx(fullYeriaWidth(2, g, P), 2 * 10 + 2 * 160 + 1 * 12); // 352
});

runner.test('klaf length: round_up uses full width for every yeria', () => {
  const g = normalizeGeometry({ outer_margin_mm: 10, line_width_mm: 160, inter_column_gap_mm: 12, amudim_per_yeria: 2 });
  const y = computeYerios(5, g, P);
  eq(y.total_yerios, 3);
  eq(y.convention, 'round_up');
  approx(y.klaf_length_m, (352 * 3) / 1000);
});

runner.test('klaf length: exact-final-sheet uses remaining columns on final yeria', () => {
  const g = normalizeGeometry({ outer_margin_mm: 10, line_width_mm: 160, inter_column_gap_mm: 12, amudim_per_yeria: 2, partial_final_yeria: 'exact' });
  const y = computeYerios(5, g, P);
  eq(y.convention, 'exact');
  eq(y.partial_final_columns, 1);
  const finalW = 2 * 10 + 1 * 160 + 0 * 12; // 180
  approx(y.klaf_length_m, (352 + 352 + finalW) / 1000);
});

runner.test('klaf length: sum of sheet WIDTHS / 1000, not height x count', () => {
  const g = normalizeGeometry({ outer_margin_mm: 10, line_width_mm: 160, inter_column_gap_mm: 12, amudim_per_yeria: 3 });
  const y = computeYerios(6, g, P); // 2 full yerias
  const w3 = 2 * 10 + 3 * 160 + 2 * 12; // 524
  approx(y.klaf_length_m, (w3 * 2) / 1000);
});

// ---- threshold -------------------------------------------------------------

runner.test('min column width: below threshold is flagged', () => {
  const mcw = minColumnWidth(P);
  const low = normalizeGeometry({ line_width_mm: mcw * 0.9 });
  eq(deriveGeometry(low, P).minColumnWidthViolation, true);
  const high = normalizeGeometry({ line_width_mm: mcw * 1.1 });
  eq(deriveGeometry(high, P).minColumnWidthViolation, false);
});

// ---- petucha / setuma -----------------------------------------------------

runner.test('petucha ends the line (rest blank)', () => {
  const src = processSource({ text: 'אבגדה {פ}\nוזחטי {פ}\nיכלמנ' });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  ok(L.lines.length >= 3);
  eq(L.lines[0].petucha_end, true);
  eq(L.lines[0].tokens.join(' '), 'אבגדה');
});

runner.test('setuma gap is interior (mid-line), not at edge', () => {
  const src = processSource({ text: 'אבגדה {ס}\nוזחטי' });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  eq(L.lines[0].has_setuma, true);
  eq(L.lines[0].setuma_at_edge, false);
});

runner.test('setuma at line edge is a validation error', () => {
  const src = processSource({ text: 'אבגדה {ס}' });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  const V = validateLayout(L.lines, P, g);
  eq(V.lines[0].valid, false);
  ok(V.lines[0].errors.some((e) => e.includes('setuma')), JSON.stringify(V.lines[0].errors));
});

// ---- vavei ha'amudim ------------------------------------------------------

runner.test('vavei haamudim: flags columns not beginning with vav', () => {
  const lines = [{ first_word: 'ויאמר' }, { first_word: 'בראשית' }, { first_word: 'ויהי' }];
  const r = groupAndAnnotate(lines, normalizeGeometry({ lines_per_amud: 1 }), P);
  eq(r.amud_annotations[0].vav_flag, false);
  eq(r.amud_annotations[1].vav_flag, true);
  eq(r.amud_annotations[2].vav_flag, false);
  eq(r.vavei_flagged.length, 1);
});

// ---- stretch caps ---------------------------------------------------------

runner.test('stretch: decisions above hard cap fail atomically', () => {
  const line = { words: [{ text: 'דה', isShem: false, letters: [{ id: 'o0', base: 'ד' }, { id: 'o1', base: 'ה' }] }], letters: [], leftover_mm: 3, base_leftover_mm: 3, stretch_decisions: [] };
  let threw = false;
  try { applyStretch(line, [{ letter_occurrence_id: 'o0', stretch_mm: 9 }], P); } catch (e) { threw = true; }
  ok(threw, 'over-cap stretch must throw atomically');
  eq(line.stretch_decisions.length, 0, 'no partial application');
});

runner.test('stretch: Shem letters fail atomically (never stretched)', () => {
  const line = { words: [{ text: 'יהוה', isShem: true, letters: [{ id: 'o9', base: 'י' }, { id: 'o10', base: 'ה' }] }], letters: [], leftover_mm: 3, base_leftover_mm: 3, stretch_decisions: [] };
  let threw = false;
  try { applyStretch(line, [{ letter_occurrence_id: 'o9', stretch_mm: 0.5 }], P); } catch (e) { threw = true; }
  ok(threw, 'Shem letter stretch must throw atomically');
  eq(line.stretch_decisions.length, 0, 'no partial application');
});

runner.test('stretch: duplicate decisions for one occurrence aggregate then enforce cap', () => {
  const line = { words: [{ text: 'ד', isShem: false, letters: [{ id: 'd0', base: 'ד' }] }], letters: [], leftover_mm: 3, base_leftover_mm: 3, stretch_decisions: [] };
  // Two 1mm decisions on the same ד (cap 1.5) must aggregate to 2.0 -> over cap -> atomic reject.
  let threw = false;
  try {
    applyStretch(line, [{ letter_occurrence_id: 'd0', stretch_mm: 1 }, { letter_occurrence_id: 'd0', stretch_mm: 1 }], P);
  } catch (e) { threw = true; }
  ok(threw, 'duplicate 1mm+1mm (2mm) exceeds 1.5mm cap and must reject');
  eq(line.stretch_decisions.length, 0, 'atomic');
});

runner.test('stretch: leftover always recomputed from immutable base (idempotent)', () => {
  const line = { words: [{ text: 'ד', isShem: false, letters: [{ id: 'd1', base: 'ד' }] }, { text: 'ה', isShem: false, letters: [{ id: 'd2', base: 'ה' }] }], letters: [], leftover_mm: 3, base_leftover_mm: 3, stretch_decisions: [] };
  const r1 = applyStretch(line, [{ letter_occurrence_id: 'd1', stretch_mm: 0.5 }], P);
  approx(r1.leftover_mm, 2.5, 1e-6);
  // Same decision set applied again must not subtract twice.
  const r2 = applyStretch(line, [{ letter_occurrence_id: 'd1', stretch_mm: 0.5 }], P);
  approx(r2.leftover_mm, 2.5, 1e-6, 'recompute from base — idempotent');
  // Replacing the decision set recomputes from base (not from already-reduced leftover).
  const r3 = applyStretch(line, [{ letter_occurrence_id: 'd2', stretch_mm: 1.0 }], P);
  approx(r3.leftover_mm, 2.0, 1e-6, 'replacement recomputed from base');
  eq(line.stretch_decisions.length, 1);
});

runner.test('stretch: manual requests obey active position filter (line_end)', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, stretch_position: 'line_end' });
  const line = {
    words: [
      { text: 'ד', isShem: false, letters: [{ id: 'p0', base: 'ד' }] },
      { text: 'רה', isShem: false, letters: [{ id: 'p1', base: 'ר' }, { id: 'p2', base: 'ה' }] },
    ],
    letters: [], leftover_mm: 5, base_leftover_mm: 5, stretch_decisions: [],
  };
  // p0 is word 0 (not line-end) -> must reject atomically.
  let threw = false;
  try { applyStretch(line, [{ letter_occurrence_id: 'p0', stretch_mm: 0.5 }], p); } catch (e) { threw = true; }
  ok(threw, 'non-line-end letter rejected under line_end filter');
  // p2 is the last letter of the last word -> allowed.
  const r = applyStretch(line, [{ letter_occurrence_id: 'p2', stretch_mm: 0.5 }], p);
  eq(r.decisions.length, 1);
});

runner.test('auto-suggest: never exceeds cap, never includes Shem letters', () => {
  const line = {
    words: [
      { text: 'ד', isShem: false, letters: [{ id: 's0', base: 'ד' }], },
      { text: 'יהוה', isShem: true, letters: [{ id: 's1', base: 'י' }, { id: 's2', base: 'ה' }] },
    ],
    letters: [], leftover_mm: 10, stretch_decisions: [],
  };
  const r = autoSuggestLine(line, P);
  const suggestions = r.suggestions;
  ok(suggestions.length >= 1);
  ok(r.unjustifiable === true, 'leftover exceeds cap -> unjustifiable flagged');
  ok(r.shortfall_mm > 0, 'shortfall reported');
  const ids = suggestions.map((s) => s.letter_occurrence_id);
  ok(!ids.includes('s1') && !ids.includes('s2'), 'no Shem letters');
  for (const s of suggestions) {
    const cap = P.max_stretch['ד'];
    ok(s.stretch_mm <= cap + 1e-9, 'suggestion within cap: ' + s.stretch_mm);
  }
});

// ---- Shem atomicity & unsatisfiable ---------------------------------------

runner.test('shem: token never split across lines', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אבגד יהוה וזחטי']] }] }) });
  const g = normalizeGeometry({ line_width_mm: 60 });
  const L = computeLayout(src, P, g);
  const flat = L.lines.flatMap((l) => l.tokens);
  ok(flat.includes('יהוה'), 'full Shem token present in a single line');
});

runner.test('shem: too-wide token is an unsatisfiable error, never truncated', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['יהוה']] }] }) });
  src.verses[0].tokens[0].isShem = true;
  src.verses[0].tokens[0].holy_letter_indexes = [0, 1, 2, 3];
  const g = normalizeGeometry({ line_width_mm: 2 });
  const L = computeLayout(src, P, g);
  const V = validateLayout(L.lines, P, g);
  ok(V.lines.some((l) => l.errors.some((e) => e.includes('unsatisfiable'))), 'unsatisfiable flagged');
});

// ---- patterns -------------------------------------------------------------

runner.test('fixed passage pattern renders fixed lines', () => {
  const pattern = { passage_name: 'x', scheme_name: 's', slots: [{ index: 0, segments: [{ tokens: ['אב', 'גד'], gap_before_mm: 0 }], gap_after_mm: 0 }] };
  const g = normalizeGeometry({ line_width_mm: 200 });
  const lines = renderPattern(pattern, P, g);
  eq(lines.length, 1);
  eq(lines[0].fixed_pattern, true);
  eq(lines[0].tokens.length, 2);
});

// ---- unusual letters ------------------------------------------------------

runner.test('unusual letter width override changes measured width', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אב']] }] }), unusual_letters: [{ ref: 'x 1:1', letter: 'א', width_override_mm: 120 }] });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  ok(L.lines[0].width_mm > 120, 'override applied: ' + L.lines[0].width_mm);
});

// ---- progress -------------------------------------------------------------

runner.test('chunked computation reports progress', () => {
  const src = processSource({ text: 'א ב ג ד ה ו ז ח ט י כ ל מ נ ס ע פ צ ק ר ש ת' });
  const g = normalizeGeometry({ line_width_mm: 400 });
  let calls = 0;
  computeLayout(src, P, g, { onProgress: () => { calls += 1; }, progressChunk: 1 });
  ok(calls > 0, 'progress callback fired ' + calls + ' times');
});

// ---- E4/E5/E8 regression tests ----

// ---- E4: inline marker positioning ----

runner.test('E4: setuma marker stays BETWEEN words, not at verse end', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אב {ס} גד']] }] }) });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  const line = L.lines[0];
  ok(line.words.length === 2, 'two words: אב and גד');
  eq(line.words[0].text, 'אב');
  eq(line.words[1].text, 'גד');
  const idx = line.items.map((i) => i.type);
  eq(idx[0], 'word');
  eq(idx[1], 'setuma_gap', 'setuma gap between אב and גד');
  eq(idx[2], 'word');
  ok(line.has_setuma === true);
  ok(line.setuma_at_edge === false, 'setuma is interior');
});

runner.test('E4: leading setuma gap measured exactly once', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['{ס} אבגדה']] }] }) });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  const line = L.lines[0];
  // width must equal setuma gap + single word (no extra inter-word gap).
  const sgap = line.items.find((i) => i.type === 'setuma_gap');
  ok(sgap, 'setuma gap present');
  const wordW = line.words[0].width_mm;
  approx(line.width_mm, sgap.width_mm + wordW, 1e-3, 'gap measured once, no extra word gap');
});

// ---- E5: occurrence-specific override ----

runner.test('E5: override affects only the selected occurrence (repeated letters)', () => {
  // Two verses, two א occurrences in one verse.
  const src = processSource({
    format: 'json',
    text: JSON.stringify({ books: [{ name: 'x', chapters: [['אבא']] }] }),
    unusual_letters: [{ ref: 'x 1:1', letter: 'א', occurrence_index: 1, width_override_mm: 120 }],
  });
  const g = normalizeGeometry({ line_width_mm: 400 });
  const L = computeLayout(src, P, g);
  const letters = [];
  L.lines.forEach((ln) => ln.words.forEach((w) => w.letters.forEach((l) => letters.push(l))));
  const occs = letters.filter((l) => l.base === 'א');
  eq(occs.length, 2, 'two א occurrences in אבא');
  // Only the second א (occurrence_index 1) carries the override.
  const word = L.lines[0].words[0];
  const overridden = (word.override || []);
  eq(overridden.length, 1, 'exactly one occurrence overridden');
  // F-26: override entries carry {id, mm, type}.
  eq(overridden[0].mm, 120, 'override mm recorded');
  ok(typeof overridden[0].id === 'string' && overridden[0].id.length > 0, 'override carries occurrence id');
});

runner.test('E8: configured max inter-word gap strictly below small-letter width', () => {
  const p = normalizeProfile({ letter_height_mm: 4.5, unit_mm: 0.5, reference_height_mm: 3.0, letter_widths: { 'א': 8, 'י': 2 }, stroke_mm: 0.3, gaps: { inter_letter: 0, inter_word: 0.4 } });
  const g = normalizeGeometry({ max_inter_word_gap_mm: 99, small_letter_reference: 'י' });
  const errs = validateSpacingBounds(p, g);
  ok(errs.some((e) => e.includes('strictly below')), '99mm max vs 1.2mm small letter must error: ' + errs.join(' | '));
});


// ---- E3: pattern integration through computeLayout ----

runner.test('E3: computeLayout routes patterned verses through renderPattern', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אב גד'], ['הו זו']] }] }) });
  const pattern = {
    passage_name: 'testp', scheme_name: 's', status: 'verified',
    slots: [{ index: 0, segments: [{ tokens: ['אב', 'גד'], gap_before_mm: 0 }], gap_after_mm: 0 }],
  };
  const annotations = { passages: { testp: { verse_refs: ['x 1:1'] } } };
  const g = normalizeGeometry({ line_width_mm: 400, lines_per_amud: 4 });
  const L = computeLayout(src, P, g, { patterns: [pattern], annotations });
  const fixed = L.lines.filter((l) => l.fixed_pattern);
  eq(fixed.length, 1, 'one fixed-pattern line (x 1:1), not silently wrapped');
  eq(fixed[0].words[0].text, 'אב');
  eq(fixed[0].words[1].text, 'גד');
  ok(fixed[0].words.every((w) => w.letters.length > 0), 'real occurrence IDs preserved');
  eq(fixed[0].words.some((w) => w.isShem), false);
  // the other verse wraps normally
  ok(L.lines.some((l) => !l.fixed_pattern && l.text.indexOf('הו') >= 0), 'second verse wraps normally');
});

runner.test('E3: renderPattern rejects unsupported token data clearly', () => {
  const src = processSource({ format: 'json', text: JSON.stringify({ books: [{ name: 'x', chapters: [['אב גד']] }] }) });
  const pattern = {
    passage_name: 'testp', scheme_name: 's', status: 'verified',
    slots: [{ index: 0, segments: [{ tokens: ['אב', 'חט'] }], gap_after_mm: 0 }],
  };
  const annotations = { passages: { testp: { verse_refs: ['x 1:1'] } } };
  const g = normalizeGeometry({ line_width_mm: 400, lines_per_amud: 4 });
  let threw = false;
  try { computeLayout(src, P, g, { patterns: [pattern], annotations }); } catch (e) { threw = true; }
  ok(threw, 'unsupported pattern substitution must be rejected, not silently wrapped');
});

// ---- E7: async compute yields the event loop ----

runner.test('E7: async compute yields and reports real progress', async () => {
  const words = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת','א','ב','ג','ד','ה','ו'];
  const src = processSource({ text: words.join(' ') });
  const g = normalizeGeometry({ line_width_mm: 60 });
  let calls = 0;
  let maxProcessed = 0;
  const result = await computeLayoutAsync(src, P, g, {
    progressChunk: 3,
    onProgress: (p) => { calls += 1; maxProcessed = p.processed; },
  });
  ok(calls > 0, 'async progress callback fired ' + calls + ' times');
  ok(Array.isArray(result.lines) && result.lines.length > 0, 'async result shape matches computeLayout');
  ok(result.summary && result.summary.total_letters > 0, 'async summary present');
});

const okAll = await runner.run();
process.exit(okAll ? 0 : 1);
