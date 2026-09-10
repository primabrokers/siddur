// engine/layout.js
// RTL word-by-word line fitting, amud grouping, column-geometry derivation,
// stretch/justification, fixed passage patterns and unusual-letter overrides.
// Chunked computation with a progress callback for large corpora.

import { createHash } from 'node:crypto';
import { totalWidth, interLetterGap, interWordGap, wordWidth, minColumnWidth, measurementUnitMm } from './width.js';
import { lettersOf, letterKeyOf } from './profile.js';
import { stripNekud } from './text.js';
import { letterCap, measuredLetterWidth, baseBudget, spaceCandidatesOf, balancedSuggestions, effectiveProfile, percentageCap } from './stretch-policy.js';

const TOL = 1e-6; // additive comparison tolerance for width/leftover checks (F-01)

// F-31: content-derived line identity. Positional line ids (amud-N-line-M) are
// stable but NOT unique across layouts; the line_key is a hash of the line's
// actual content (tokens + measured word widths + letter occurrence ids) so two
// layouts with the SAME positional line_id but DIFFERENT text/measurement get
// DIFFERENT keys. Progress-carrying decisions key on this, not on line_id.
export function computeLineKey(line) {
  const payload = JSON.stringify({
    tokens: (line.tokens || []).map((t) => String(t)),
    widths: (line.words || []).map((w) => Number(w.width_mm || 0)),
    ids: Array.isArray(line.letter_occurrence_ids) ? line.letter_occurrence_ids : [],
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ---- Geometry derivation ------------------------------------------------

export function deriveGeometry(geometry, profile) {
  const g = geometry;
  const lines_per_amud = int(g.lines_per_amud, 42);
  const pitch = num(g.baseline_pitch_mm);
  const H = profile.letter_height_mm;
  const top = num(g.top_margin_mm);
  const bottom = num(g.bottom_margin_mm);
  const interCol = num(g.inter_column_gap_mm);
  const outer = num(g.outer_margin_mm);
  const lineW = num(g.line_width_mm);

  if (pitch < H) {
    throw new Error(`baseline pitch ${pitch}mm is below letter height ${H}mm (overlap)`);
  }
  const inkExtent = (lines_per_amud - 1) * pitch + H;
  const allocatedRulingHeight = lines_per_amud * pitch;
  const trailingMargin = allocatedRulingHeight - inkExtent;
  const column_height = allocatedRulingHeight;
  const amud_height = column_height + top + bottom;
  const minColWidth = minColumnWidth(profile);

  return {
    lines_per_amud,
    baseline_pitch_mm: pitch,
    letter_height_mm: H,
    top_margin_mm: top,
    bottom_margin_mm: bottom,
    inter_column_gap_mm: interCol,
    outer_margin_mm: outer,
    line_width_mm: lineW,
    inkExtent_mm: inkExtent,
    allocatedRulingHeight_mm: allocatedRulingHeight,
    trailingMargin_mm: trailingMargin,
    column_height_mm: column_height,
    amud_height_mm: amud_height,
    minColumnWidth_mm: minColWidth,
    minColumnWidthViolation: lineW < minColWidth,
  };
}

// Full yeria width for k columns.
export function fullYeriaWidth(k, g, profile) {
  return 2 * num(g.outer_margin_mm) + k * num(g.line_width_mm) + (k - 1) * num(g.inter_column_gap_mm);
}

// Yeria/klaf totals. amudim_per_yeria is a configurable positive integer.
export function computeYerios(totalAmudim, geometry, profile) {
  const k = Math.max(1, int(geometry.amudim_per_yeria, 2));
  const total_yerios = Math.ceil(totalAmudim / k);
  const partial = totalAmudim % k;
  const convention = geometry.partial_final_yeria === 'exact' ? 'exact' : 'round_up';
  const isPartial = partial !== 0;

  let widths = [];
  for (let i = 0; i < total_yerios; i++) {
    const isLast = i === total_yerios - 1;
    let w;
    if (isLast && isPartial && convention === 'exact') {
      w = fullYeriaWidth(partial, geometry, profile);
    } else {
      w = fullYeriaWidth(k, geometry, profile);
    }
    widths.push(w);
  }
  const klaf_length_m = widths.reduce((s, w) => s + w, 0) / 1000;
  return { amudim_per_yeria: k, total_amudim: totalAmudim, total_yerios, partial_final_columns: isPartial ? partial : 0, convention, yeria_widths_mm: widths, klaf_length_m };
}

// ---- Setuma gap ----------------------------------------------------------

export function setumaGapMm(profile, geometry) {
  const minimum = profile.stretch_policy?.version === 2
    ? Number(profile.special_widths_units?.setuma || 20) * measurementUnitMm(profile) : 0;
  if (geometry && geometry.setuma_gap_mm != null && Number.isFinite(Number(geometry.setuma_gap_mm))) {
    return Math.max(Number(geometry.setuma_gap_mm), minimum);
  }
  const ref = (geometry && geometry.setuma_reference_letter) || 'א';
  return Math.max(9 * totalWidth(ref, profile) + 8 * interLetterGap(profile), minimum);
}

// ---- Token stream --------------------------------------------------------

export function buildWordUnits(source) {
  const units = [];
  const verseLetters = []; // [{ ref, letters: [{id,base,grapheme}] }] for override resolution
  let letterIdx = 0;
  let wordIdx = 0;
  let prevBook = null;
  for (const verse of source.verses) {
    if (verse.book !== prevBook && prevBook !== null) {
      units.push({ type: 'sefer', verse: verse.ref, name: verse.book });
    }
    prevBook = verse.book;
    const vl = { ref: verse.ref, letters: [] };
    verseLetters.push(vl);
    for (const t of verse.tokens) {
      if (t.marker) {
        // Inline marker: preserves the gap boundary BETWEEN words (not verse end).
        units.push({ type: t.marker, break_kind: t.break_kind || null, verse: verse.ref });
        continue;
      }
      const graphemes = lettersOf(t.text);
      const marks = new Map();
      for (const mark of t.stam_width_marks || []) {
        const index = Number(mark.letter_index), previous = marks.get(index);
        marks.set(index, previous?.type === 'hyphen' && mark.type === 'hyphen' && previous.mode === 'add' && mark.mode === 'add'
          ? { ...mark, count: Number(previous.count) + Number(mark.count) } : { ...mark });
      }
      const holy = new Set((t.holy_letter_indexes || []).map(Number));
      const letterMarks = new Map((t.stam_letter_marks || []).map((mark) => [Number(mark.letter_index), mark]));
      const letters = graphemes.map((g, letterInWord) => {
        const occ = { id: 'occ-' + letterIdx, base: letterKeyOf(g), grapheme: g, holy: holy.has(letterInWord) };
        if (marks.has(letterInWord)) occ.stam_width_mark = { ...marks.get(letterInWord) };
        if (letterMarks.has(letterInWord)) occ.stam_letter_mark = { ...letterMarks.get(letterInWord) };
        letterIdx += 1;
        return occ;
      });
      for (const l of letters) vl.letters.push(l);
      units.push({
        type: 'word',
        text: t.text,
        consonant: t.consonant,
        isShem: holy.size > 0,
        explicit_shem: !!t.explicit_shem,
        shem: t.shem || null,
        uncertain: !!(t.shem && t.shem.uncertain),
        letters,
        verse: verse.ref,
        ref: verse.ref,
        wordIndex: wordIdx,
      });
      wordIdx += 1;
    }
  }
  return { units, verseLetters, totalLetters: letterIdx, totalWords: wordIdx };
}

// Resolve occurrence-specific unusual-letter overrides once, globally, keyed by
// stable letter occurrence id. Matches by (ref + letter + occurrence_index within,
// the whole verse) or by stable occurrence_id; defaults to the FIRST occurrence,
// and never blanket-applies to all occurrences of a base letter.
// Map value carries {mm, type, occurrence_id} so large/small/dotted/broken/suspended
// annotation types survive to the layout words[].override (F-26).
export function buildOverrideMap(source, verseLetters) {
  const map = new Map();
  const byRef = {};
  for (const ul of source.unusual_letters || []) {
    const mm = Number(ul.width_override_mm);
    if (!Number.isFinite(mm)) continue;
    if (!ul.ref) continue;
    (byRef[ul.ref] = byRef[ul.ref] || []).push(ul);
  }
  const entryFor = (u) => ({ mm: Number(u.width_override_mm), type: u.type || 'large', occurrence_id: u.occurrence_id || null });
  for (const vl of verseLetters || []) {
    const list = byRef[vl.ref] || [];
    if (!list.length) continue;
    const byId = new Map(vl.letters.map((l) => [l.id, l]));
    const basePos = {};
    for (const l of vl.letters) (basePos[l.base] = basePos[l.base] || []).push(l);
    for (const u of list) {
      if (u.occurrence_id) {
        const l = byId.get(u.occurrence_id);
        if (l) { map.set(l.id, entryFor(u)); continue; }
      }
      const targetBase = u.letter;
      const arr = basePos[targetBase] || [];
      const oi = (u.occurrence_index != null && Number.isFinite(Number(u.occurrence_index)))
        ? Math.floor(Number(u.occurrence_index)) : 0;
      if (oi >= 0 && oi < arr.length) map.set(arr[oi].id, entryFor(u));
    }
  }
  return map;
}

// Per-word measured width, applying occurrence-specific overrides from the map.
function stamMarkerUnitMm(profile) {
  if (profile.average_unit_mm != null && Number.isFinite(Number(profile.average_unit_mm))) return Number(profile.average_unit_mm);
  if (profile.units_per_row != null && profile.unit_column_width_mm != null) return Number(profile.unit_column_width_mm) / Number(profile.units_per_row);
  return Number(profile.unit_mm) || 0;
}

function measuredOccurrenceWidth(letter, profile, overrideByOccId) {
  const override = overrideByOccId.get(letter.id);
  let base = override != null ? Number(override.mm) : totalWidth(letter.base, profile);
  if (letter.stam_letter_mark?.type === 'large') base *= 1.5;
  if (letter.stam_letter_mark?.type === 'small') base *= 0.5;
  const mark = letter.stam_width_mark;
  if (!mark) return base;
  const units = Math.max(0, Number(profile.stretch_policy?.version === 2
    ? profile.special_widths_units?.hyphen
    : profile.stretch_policy?.stam_hyphen_units ?? 0));
  const markerWidth = Math.max(0, Number(mark.count) || 0) * units * stamMarkerUnitMm(profile);
  return mark.mode === 'replace' ? markerWidth : base + markerWidth;
}

function measureWord(wordUnit, profile, overrideByOccId) {
  const letters = wordUnit.letters;
  let w = 0;
  for (let i = 0; i < letters.length; i++) {
    w += measuredOccurrenceWidth(letters[i], profile, overrideByOccId);
    if (i > 0) w += interLetterGap(profile);
  }
  return w;
}

function wordOverrides(wordUnit, overrideMap, profile) {
  const entries = [];
  for (const l of wordUnit.letters) {
    const ov = overrideMap.get(l.id);
    if (l.stam_width_mark) {
      const mark = l.stam_width_mark;
      const entry = {
        id: l.id,
        mm: measuredOccurrenceWidth(l, profile, overrideMap),
        type: mark.type || (mark.mode === 'replace' ? 'small' : 'large'),
        occurrence_id: `${mark.source || 'stam'}:${l.id}`,
        stam_hyphens: Number(mark.count) || 0,
        stam_hyphen_units: Number(profile.stretch_policy?.stam_hyphen_units ?? 0),
        width_mode: mark.mode,
      };
      l.width_mm = entry.mm;
      entries.push(entry);
    } else if (ov != null) {
      l.width_mm = Number(ov.mm);
      entries.push({ id: l.id, mm: ov.mm, type: ov.type, occurrence_id: ov.occurrence_id });
    }
  }
  return entries;
}

// ---- Line fitting --------------------------------------------------------

export function fitLines(source, profile, geometry, opts = {}) {
  const g = profile;
  const lineW = num(geometry.line_width_mm);
  const gap_word = interWordGap(profile);
  const sgap = setumaGapMm(profile, geometry);
  const { units, verseLetters } = buildWordUnits(source);
  const overrideMap = buildOverrideMap(source, verseLetters);
  const passageMap = opts.passageMap || null;

  const lines = [];
  let current = [];
  let currentWidth = 0;
  let prevWasWord = false;
  let currentSong = false;

  const pushLine = (flags = {}) => {
    if (current.length === 0 && !flags.force) return;
    const line = makeLine(current, currentWidth, lineW, profile, flags);
    if (currentSong) line.fixed_pattern = true;
    if (flags.blankLine) line.blank_line = true;
    lines.push(line);
    current = [];
    currentWidth = 0;
    prevWasWord = false;
    currentSong = false;
  };

  let progress = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    progress += 1;
    if (opts.onProgress && progress % (opts.progressChunk || 256) === 0) {
      opts.onProgress({ processed: progress, total: units.length, phase: 'fitting' });
    }

    // Fixed-passage diversion: patterned verses are rendered by renderPattern,
    // never silently wrapped by the ordinary fitter.
    if (u.type === 'word' && passageMap && passageMap[u.verse]) {
      const passage = passageMap[u.verse];
      const collected = [];
      while (i < units.length && units[i].type === 'word' && passageMap[units[i].verse] === passage) {
        collected.push(units[i]);
        i += 1;
      }
      i -= 1;
      pushLine();
      const fixed = renderPattern(passage, profile, geometry, collected, overrideMap);
      for (const fl of fixed) lines.push(fl);
      current = []; currentWidth = 0; prevWasWord = false;
      continue;
    }

    if (u.type === 'word') {
      const w = measureWord(u, profile, overrideMap);
      const addGap = prevWasWord ? gap_word : 0;
      const addW = addGap + w;
      if (current.length === 0) {
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth = w;
      } else if (currentWidth + addW <= lineW + 1e-9) {
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth += addW;
      } else {
        pushLine();
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth = w;
      }
      prevWasWord = true;
    } else if (u.type === 'setuma') {
      // Setuma gap measured exactly once; never supplements an extra word gap.
      if (current.length === 0) {
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth = sgap;
      } else if (currentWidth + sgap <= lineW + 1e-9) {
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth += sgap;
      } else {
        pushLine();
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth = sgap;
      }
      prevWasWord = false;
    } else if (u.type === 'petucha' || u.type === 'sefer') {
      pushLine({ endedBy: u.type, endVerse: u.verse });
    } else if (u.type === 'song_break') {
      const song = profile.stretch_policy?.song_widths_mm || {};
      const width = Math.max(0, Number(u.break_kind === '1' ? song.middle : song.side) || 0);
      current.push({ type: 'segment_gap', break_kind: u.break_kind === '1' ? 'middle' : 'side', width_mm: width, verse: u.verse });
      currentWidth += width; prevWasWord = false; currentSong = true;
    } else if (u.type === 'blank_line') {
      pushLine();
      pushLine({ force: true, blankLine: true });
    }
  }
  pushLine({ force: current.length > 0 });

  return { lines, totalLetters: verseLetters.reduce((s, vl) => s + vl.letters.length, 0) };
}

function makeLine(items, width, lineW, profile, flags = {}) {
  const words = items.filter((i) => i.type === 'word');
  const setumaGaps = items.filter((i) => i.type === 'setuma_gap');
  const hasSetuma = setumaGaps.length > 0;
  const lastItem = items.length ? items[items.length - 1] : null;
  const firstItem = items.length ? items[0] : null;
  const setumaAtEdge = hasSetuma && (!words.length || (firstItem && firstItem.type === 'setuma_gap') || (lastItem && lastItem.type === 'setuma_gap'));
  const leftover = lineW - width;
  const wordTokens = words.map((w) => w.text);
  const consonantText = words.map((w) => w.consonant).join(' ');
  const allLetters = [];
  for (const w of words) for (const l of w.letters) allLetters.push(l);

  return {
    words,
    tokens: wordTokens,
    text: wordTokens.join(' '),
    consonant_text: consonantText,
    width_mm: round(width),
    leftover_mm: round(leftover),
    base_leftover_mm: round(leftover),
    items,
    has_setuma: hasSetuma,
    setuma_at_edge: setumaAtEdge,
    petucha_end: !!flags.endedBy && flags.endedBy === 'petucha',
    sefer_end: !!flags.endedBy && flags.endedBy === 'sefer',
    first_word: wordTokens[0] || '',
    last_word: wordTokens[wordTokens.length - 1] || '',
    letters: allLetters,
    letter_occurrence_ids: allLetters.map((l) => l.id),
    shem: words.some((w) => w.isShem),
    uncertain_shem: words.some((w) => w.uncertain),
    verse_refs: [...new Set(words.map((w) => w.verse))],
    start_letter_index: allLetters.length ? allLetters[0].id : null,
    stretch_decisions: [],
    status: 'pending',
  };
}

// ---- Amud grouping & vavei ha'amudim --------------------------------------

export function groupAndAnnotate(lines, geometry, profile) {
  const per = Math.max(1, int(geometry.lines_per_amud, 42));
  const amudim = [];
  for (let i = 0; i < lines.length; i += per) {
    const chunk = lines.slice(i, i + per);
    amudim.push(chunk);
  }
  const needVav = (profile.vavei_haamudim !== false);
  const annotations = [];
  amudim.forEach((chunk, aIdx) => {
    const amud = aIdx + 1;
    chunk.forEach((line, li) => {
      line.line_index = aIdx * per + li + 1;
      line.amud = amud;
      line.line_in_amud = li + 1;
      line.line_id = 'amud-' + amud + '-line-' + (li + 1);
      if (!line.line_key) line.line_key = computeLineKey(line);
    });
    const firstWord = chunk.length ? (chunk[0].first_word || '') : '';
    const beginsWithVav = needVav ? startsWithVav(firstWord) : true;
    annotations.push({ amud, begins_with_vav: beginsWithVav, first_word: firstWord, vav_flag: !beginsWithVav });
  });
  const result = { lines, amudim, amud_annotations: annotations, vavei_flagged: annotations.filter((a) => a.vav_flag) };
  return result;
}

function startsWithVav(word) {
  const letters = lettersOf(word);
  return letters.length > 0 && letterKeyOf(letters[0]) === 'ו';
}

// ---- Stretch candidates & justification ----------------------------------

export function stretchCandidatesOf(line, profile, lettersById) {
  // A paragraph-break line is gap-only. A finite gap cap must never cause
  // fallback stretching of letters or normal spaces on that same line.
  if (profile.stretch_policy && (line.has_setuma || line.petucha_end)) {
    return spaceCandidatesOf(line, profile).filter(c => c.kind === 'setuma_gap' || c.kind === 'petucha_gap');
  }
  const filter = profile.stretch_position || 'anywhere';
  const wordCount = line.words.length;
  const cands = [];
  line.words.forEach((w, wi) => {
    const n = w.letters.length;
    w.letters.forEach((l, li) => {
      if (l.holy || (profile.stretch_policy?.version !== 2 && w.isShem)) return;
      if (profile.non_stretchable.includes(l.base)) return;
      const cap = letterCap(w, l, profile, baseBudget(line));
      let posOk = true;
      if (filter === 'word_final') posOk = li === n - 1;
      else if (filter === 'line_end') posOk = (wi === wordCount - 1) && (li === n - 1);
      if (!posOk) return;
      const mark = (w.override || []).find(o => o.id === l.id && o.stam_hyphens > 0);
      if (profile.stretch_policy?.version === 2 && mark) {
        const base = Number(mark.stam_hyphens) * Number(mark.stam_hyphen_units) * stamMarkerUnitMm(profile);
        const hyphenCap = percentageCap(base, profile.stretch_policy.hyphen_percent ?? 0, baseBudget(line));
        if (hyphenCap > 0) cands.push({letter_occurrence_id:'hyphen-'+l.id, kind:'hyphen', letter:'-', word:w.text,
          base_width_mm:base, cap_mm:hyphenCap, cap_percent:profile.stretch_policy.hyphen_percent,
          priority:profile.stretch_priorities?.hyphen ?? 3});
      }
      if (cap > 0) {
        cands.push({
          letter_occurrence_id: l.id,
          letter: l.base,
          word: w.text,
          word_final: li === n - 1,
          line_end: (wi === wordCount - 1) && (li === n - 1),
          cap_mm: cap,
          base_width_mm: measuredLetterWidth(w, l, profile),
          cap_percent: profile.stretch_policy?.caps_percent[l.base] ?? null,
          kind: 'letter', priority: profile.stretch_policy?.version === 2 ? (profile.stretch_priorities?.[l.base] ?? 3) : 1,
        });
      }
    });
  });
  return cands.concat(spaceCandidatesOf(line, profile));
}

export function autoSuggestLine(line, profile, opts = {}) {
  if (line.fixed_pattern || (line.petucha_end && profile.stretch_policy?.version !== 2) || line.sefer_end || line.setuma_at_edge || (line.has_setuma && !profile.stretch_policy)) {
    return { suggestions: [], unjustifiable: false, shortfall_mm: 0, skipped: 'intentional spacing or fixed passage' };
  }
  const cands = stretchCandidatesOf(line, profile);
  if (profile.stretch_policy) {
    const budget = baseBudget(line);
    const suggestions = balancedSuggestions(cands, budget, profile.stretch_policy.distribution);
    const shortfall = round(Math.max(0, budget - suggestions.reduce((n, d) => n + d.stretch_mm, 0)));
    return { suggestions, unjustifiable: shortfall >= 0.001, shortfall_mm: shortfall };
  }
  // Suggestions replace the decision set. Using the remaining gap here made
  // repeated suggestions shrink or remove previously applied stretching.
  const existing = (line.stretch_decisions || []).reduce((sum, d) => sum + Number(d.stretch_mm || 0), 0);
  const leftover = line.base_leftover_mm != null ? line.base_leftover_mm : computeLeftover(line, profile) + existing;
  const minIncrement = Number(opts.minimum_increment_mm != null ? opts.minimum_increment_mm : 0.05);
  if (leftover <= 0) return { suggestions: [], unjustifiable: false, shortfall_mm: 0 };
  if (cands.length === 0) return { suggestions: [], unjustifiable: true, shortfall_mm: leftover };
  // Rank: line-end (0) > word-final (1) > other (2). Sort by rank asc, then by
  // reverse source index so the line-end-most letters are preferred first.
  const rank = (c) => (c.line_end ? 0 : (c.word_final ? 1 : 2));
  const sorted = cands.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || b.i - a.i).map((x) => x.c);

  const totalCap = sorted.reduce((s, c) => s + c.cap_mm, 0);
  const distributable = Math.min(leftover, totalCap);
  const unjustifiable = leftover > totalCap + 1e-9;
  const shortfall = Math.max(0, leftover - totalCap);

  // Weighted distribution by rank (line-end 3, word-final 2, other 1), spread
  // rather than maxing a single letter, then rebalance capped overflow toward
  // letters with remaining headroom (greedy from line-end outward).
  const weights = sorted.map((c) => rank(c) === 0 ? 3 : (rank(c) === 1 ? 2 : 1));
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  const allocations = sorted.map((c, i) => Math.min(c.cap_mm, distributable * weights[i] / totalWeight));
  let remaining = distributable - allocations.reduce((s, a) => s + a, 0);
  for (let i = 0; i < sorted.length && remaining > 1e-9; i++) {
    const headroom = sorted[i].cap_mm - allocations[i];
    if (headroom > 1e-9) {
      const add = Math.min(headroom, remaining);
      allocations[i] += add;
      remaining -= add;
    }
  }

  const suggestions = [];
  for (let i = 0; i < sorted.length; i++) {
    // Never round several allocations UP beyond the physical line budget.
    const amt = Math.floor((allocations[i] + 1e-10) * 1000) / 1000;
    if (amt < minIncrement) continue; // F-24: never emit sub-useful crumbs
    suggestions.push({ letter_occurrence_id: sorted[i].letter_occurrence_id, stretch_mm: amt, position: i });
  }
  // Reassign discarded rounding/minimum-increment amounts to candidates with
  // capacity. Previously even fillable lines retained a different tiny gap.
  let remainder = Math.max(0, leftover - suggestions.reduce((sum,d)=>sum+d.stretch_mm,0));
  for (let i=0;i<sorted.length && remainder>1e-9;i++) {
    const c=sorted[i],existing=suggestions.find(d=>d.letter_occurrence_id===c.letter_occurrence_id);
    const room=Math.max(0,c.cap_mm-(existing?.stretch_mm||0));
    const add=Math.floor((Math.min(room,remainder)+1e-10)*1000)/1000;
    if(add<=0 || (!existing && add<minIncrement))continue;
    if(existing)existing.stretch_mm=round(existing.stretch_mm+add);
    else suggestions.push({letter_occurrence_id:c.letter_occurrence_id,stretch_mm:add,position:i});
    remainder=Math.max(0,remainder-add);
  }
  const residual = Math.max(0, leftover - suggestions.reduce((sum, d) => sum + d.stretch_mm, 0));
  return { suggestions, unjustifiable: unjustifiable || residual >= minIncrement, shortfall_mm: round(Math.max(shortfall, residual)) };
}

function computeLeftover(line, profile) {
  return line.leftover_mm;
}

// Apply manual stretch decisions. Decisions are aggregated per occurrence BEFORE
// cap checking; leftover is always recomputed from the immutable base; placement
// must obey the active position filter; and any unknown/human-marked/non-stretchable/
// over-cap violation fails ATOMICALLY (throws, no partial mutation).
export function applyStretch(line, decisions, profile) {
  if (line.fixed_pattern) throw new Error('fixed passage stretch is frozen');
  if (profile.stretch_policy) {
    if ((line.petucha_end && profile.stretch_policy.version !== 2) || line.sefer_end || line.setuma_at_edge) throw new Error('intentional line-end spacing is frozen');
    const previous = (line.stretch_decisions || []).reduce((n, d) => n + Number(d.stretch_mm || 0), 0);
    const originalGap = Number(line.base_leftover_mm ?? (Number(line.leftover_mm || 0) + previous));
    if (!Number.isFinite(originalGap) || originalGap < 0) throw new Error('overfull or unmeasured line cannot be stretched');
    const candidates = new Map(stretchCandidatesOf(line, profile).map(c => [c.letter_occurrence_id, c]));
    const sums = new Map();
    for (const d of decisions) {
      const value = Number(d.stretch_mm);
      if (!Number.isFinite(value) || value < 0) throw new Error('invalid stretch amount');
      sums.set(d.letter_occurrence_id, (sums.get(d.letter_occurrence_id) || 0) + value);
    }
    const applied = [];
    for (const [id, value] of sums) {
      const candidate = candidates.get(id);
      if (!candidate) throw new Error('stretch rejected: unknown, holy-name-marked or non-stretchable target ' + id);
      if (value > candidate.cap_mm + 1e-9) throw new Error('stretch rejected: exceeds approved cap for ' + id);
      if (value > 0) applied.push({ letter_occurrence_id: id, stretch_mm: Math.floor((value + 1e-10) * 1000) / 1000, kind: candidate.kind });
    }
    const total = applied.reduce((n, d) => n + d.stretch_mm, 0), budget = baseBudget(line);
    if (total > budget + TOL) throw new Error('stretch rejected: total stretch exceeds line leftover');
    line.stretch_decisions = applied;
    line.leftover_mm = round(budget - total);
    line.stretched_width_mm = round(line.width_mm + total);
    return { decisions: applied, leftover_mm: line.leftover_mm, warnings: [] };
  }
  const byId = new Map();
  const wordOf = new Map();
  const posOf = new Map();
  const wordCount = (line.words || []).length;
  (line.words || []).forEach((w, wi) => {
    let li = 0;
    for (const l of w.letters) {
      byId.set(l.id, l);
      wordOf.set(l.id, w);
      posOf.set(l.id, { wi, li, n: w.letters.length });
      li += 1;
    }
  });

  // Aggregate duplicate decisions per occurrence (sum) BEFORE validation.
  const aggregated = new Map();
  for (const d of decisions) {
    const id = d.letter_occurrence_id;
    const smm = Number(d.stretch_mm);
    if (!Number.isFinite(smm) || smm < 0) throw new Error('invalid stretch amount for ' + id);
    aggregated.set(id, (aggregated.get(id) || 0) + smm);
  }

  const errors = [];
  const applied = [];
  for (const [id, total] of aggregated) {
    const letter = byId.get(id);
    if (!letter) { errors.push('unknown occurrence ' + id); continue; }
    const w = wordOf.get(id);
    if (w && w.isShem) { errors.push('Human-marked holy-name letter ' + id + ' cannot be stretched'); continue; }
    const base = letter.base;
    if ((profile.non_stretchable || []).includes(base)) { errors.push('non-stretchable letter ' + base); continue; }
    const cap = profile.max_stretch[base] || 0;
    if (!(cap > 0)) { errors.push('letter ' + base + ' has no stretch cap'); continue; }
    if (total > cap + 1e-9) { errors.push('stretch ' + round(total) + 'mm exceeds hard cap ' + cap + 'mm for ' + base); continue; }
    const pos = posOf.get(id);
    if (pos && !positionAllowed(pos, wordCount, profile.stretch_position)) {
      errors.push('letter ' + id + ' not at an allowed stretch position (' + profile.stretch_position + ')');
      continue;
    }
    applied.push({ letter_occurrence_id: id, stretch_mm: round(total) });
  }

  if (errors.length) {
    const err = new Error('stretch rejected: ' + errors.join('; '));
    err.atomic = true;
    throw err;
  }

  // Recompute leftover from immutable base (idempotent for repeated replacement).
  const existing = (line.stretch_decisions || []).reduce((s, d) => s + (Number(d.stretch_mm) || 0), 0);
  const base = line.base_leftover_mm != null ? line.base_leftover_mm : ((line.leftover_mm || 0) + existing);
  const totalApplied = applied.reduce((s, d) => s + d.stretch_mm, 0);
  // F-01: summed expansions must never exceed the physical line's remaining width.
  // Reject atomically when totalApplied > base_leftover_mm + TOL.
  if (totalApplied > base + TOL) {
    const err = new Error('stretch rejected: total stretch ' + round(totalApplied) + 'mm exceeds line leftover ' + round(base) + 'mm');
    err.atomic = true;
    throw err;
  }
  const leftover = round(Math.max(base - totalApplied, 0));
  line.stretch_decisions = applied;
  line.leftover_mm = leftover;
  line.stretched_width_mm = round(line.width_mm + totalApplied);
  return { decisions: applied, leftover_mm: leftover, warnings: [] };
}

function positionAllowed(pos, wordCount, filter) {
  if (!filter || filter === 'anywhere') return true;
  if (filter === 'word_final') return pos.li === pos.n - 1;
  if (filter === 'line_end') return pos.wi === wordCount - 1 && pos.li === pos.n - 1;
  return true;
}

// ---- Patterns (fixed passages) -------------------------------------------

function syntheticWord(text) {
  const graphemes = lettersOf(text);
  const letters = graphemes.map((g, i) => ({ id: 'pat-' + text + '-' + i, base: letterKeyOf(g), grapheme: g }));
  return {
    type: 'word', text, consonant: stripNekud(text),
    isShem: false, shem: null, uncertain: false,
    letters, verse: null, ref: null, wordIndex: null,
  };
}

// Render a fixed passage pattern as measured lines, exempt from ordinary wrapping.
// Preserves real source word units (letters, occurrence IDs, Shem flags), slot
// segment geometry (gap_before_mm), and never adds a spurious trailing word gap.
// F-06: consumes tokens strictly from the queue HEAD (source reading order); a
// permutation is rejected rather than silently reordered.
// F-07: emits a segment_gap item for every segment gap (including the first),
// never double-adds interWordGap across a segment boundary, and threads
// occurrence-specific width overrides through measureWord/wordOverrides.
export function renderPattern(pattern, profile, geometry, sourceWords, overrideMap) {
  const lines = [];
  const queue = sourceWords ? sourceWords.map((w) => Object.assign({}, w)) : null;
  const ovMap = overrideMap || null;
  for (const slot of pattern.slots || []) {
    const words = [];
    const items = [];
    let width = 0;
    for (const seg of slot.segments || []) {
      const gap = seg.gap_before_mm != null ? Number(seg.gap_before_mm) : 0;
      // Emit an explicit segment_gap item for every segment gap, including the first.
      if (gap > 0) {
        items.push({ type: 'segment_gap', width_mm: gap });
        width += gap;
      }
      let firstWordInSeg = true;
      for (const tok of seg.tokens || []) {
        let wu = null;
        if (queue) {
          wu = queue.shift();
          // Strict head consumption: the next source word must match the pattern token.
          if (!wu || (wu.consonant || wu.text) !== tok) {
            throw new Error('pattern token "' + tok + '" does not match the next source word — source reading order must be preserved (unsupported pattern data)');
          }
        } else {
          wu = syntheticWord(tok);
        }
        const w = ovMap ? measureWord(wu, profile, ovMap) : wordWidth(wu.consonant || wu.text, profile);
        if (!firstWordInSeg) width += interWordGap(profile);
        width += w;
        const ovEntries = ovMap ? wordOverrides(wu, ovMap, profile) : [];
        const wuFull = Object.assign({}, wu, { width_mm: w, override: ovEntries });
        words.push(wuFull);
        items.push(Object.assign({}, wu, { type: 'word', width_mm: w, override: ovEntries }));
        firstWordInSeg = false;
      }
    }
    const lineW = num(geometry.line_width_mm);
    lines.push({
      tokens: words.map((w) => w.text),
      text: words.map((w) => w.text).join(' '),
      consonant_text: words.map((w) => w.consonant).join(' '),
      width_mm: round(width),
      leftover_mm: round(lineW - width),
      base_leftover_mm: round(lineW - width),
      items,
      pattern_slot: slot.index,
      fixed_pattern: true,
      stretch_decisions: [],
      status: 'pending',
      first_word: words.length ? words[0].text : '',
      last_word: words.length ? words[words.length - 1].text : '',
      letters: words.flatMap((w) => w.letters || []),
      letter_occurrence_ids: words.flatMap((w) => (w.letters || []).map((l) => l.id)),
      shem: words.some((w) => w.isShem),
      uncertain_shem: words.some((w) => w.uncertain || (w.shem && w.shem.uncertain)),
      words,
      verse_refs: [...new Set(words.map((w) => w.verse))].filter(Boolean),
      has_setuma: false,
      setuma_at_edge: false,
      petucha_end: false,
      sefer_end: false,
      start_letter_index: null,
    });
  }
  // Coverage check AFTER all slots: every source word must be consumed in order.
  if (queue && queue.length) {
    throw new Error('pattern does not exactly cover its source passage: ' + queue.length + ' unconsumed source word(s) (unsupported pattern data)');
  }
  return lines;
}

// Known special passages that are EXEMPT from ordinary wrapping. These are fixed
// passages (Shiras HaYam, Ha'azinu, Vayehi Binso'a) whose layout is governed by a
// reviewed scheme — never the ordinary fitter. Data-driven and edit-per-halachic-
// parameter rule. Book values accept both English and Hebrew names.
export const KNOWN_SPECIAL_PASSAGES = [
  { key: 'shiras_hayam', name: 'Shiras HaYam', books: ['Exodus', 'שמות'], chapter: 15, verseStart: 1, verseEnd: 18 },
  { key: 'haazinu', name: "Ha'azinu", books: ['Deuteronomy', 'דברים'], chapter: 32, verseStart: 1, verseEnd: 43 },
  { key: 'vayehi_binsoa', name: "Vayehi Binso'a", books: ['Numbers', 'במדבר'], chapter: 10, verseStart: 35, verseEnd: 36 },
];

function specialPassageKeyFor(passageName) {
  const n = String(passageName || '').toLowerCase();
  for (const k of KNOWN_SPECIAL_PASSAGES) {
    if (n.indexOf(k.key) >= 0 || n.indexOf(k.name.replace(/['’]/g, '').toLowerCase()) >= 0) return k.key;
  }
  return null;
}

// Return the subset of known special passages actually present in this source.
function presentSpecialPassages(source) {
  const byBook = {};
  for (const k of KNOWN_SPECIAL_PASSAGES) {
    for (const b of k.books) byBook[b.toLowerCase()] = k;
  }
  const present = new Map();
  for (const v of source.verses || []) {
    const k = byBook[String(v.book || '').toLowerCase()];
    if (!k) continue;
    if (v.chapter === k.chapter && v.verse >= k.verseStart && v.verse <= k.verseEnd) {
      present.set(k.key, k);
    }
  }
  return Array.from(present.values());
}

// Detect whether a verse belongs to a selected patterned passage. Missing
// authoritative range data is fail-closed (never silently wrapped). F-02: known
// special passages with no selected verified pattern emit an explicit blocker.
export function resolvePatternsForSource(source, patternDefs, annotations = {}) {
  const blockers = [];
  const passageMap = {};
  const coveredKeys = new Set();
  for (const p of (patternDefs || [])) {
    const key = specialPassageKeyFor(p.passage_name);
    if (key && p.status === 'verified') coveredKeys.add(key);
    else if (key) {
      blockers.push({ pattern: p.passage_name, reason: 'unverified pattern data (status "' + (p.status || 'unverified') + '") for known special passage — blocker' });
    }
    const range = (annotations.passages && annotations.passages[p.passage_name]) || p.range;
    if (!range || !Array.isArray(range.verse_refs) || !range.verse_refs.length) {
      if (!key) blockers.push({ pattern: p.passage_name, reason: 'missing authoritative verse range for fixed passage (fail-closed)' });
      continue;
    }
    for (const ref of range.verse_refs) passageMap[ref] = p;
  }
  // Every known special passage present in the source must have a selected verified pattern.
  for (const k of presentSpecialPassages(source)) {
    if (!coveredKeys.has(k.key)) {
      blockers.push({ passage: k.name, reason: 'known special passage (' + k.name + ') without a selected verified pattern — normal wrapping is not permitted (fail-closed)' });
    }
  }
  return { passageMap, blockers };
}

// Fixed reference membership. Dimensions remain calibrated; overfull lines are
// reported rather than moving words to another line or squeezing the text.
function computeReferenceLayout(source, profile, geometry, derived, opts) {
  if(profile.layout_mode!=='reflow'&&Number(geometry.lines_per_amud)!==42)throw new Error('Exact reference mode requires 42 ruling lines; choose Reflow in Measurements to change pagination');
  const reference=source.reference;
  const {units,verseLetters}=buildWordUnits(source),words=units.filter(u=>u.type==='word');
  const verseBooks=new Map(source.verses.map(v=>[v.ref,v.book]));
  const overrides=buildOverrideMap(source,verseLetters),seen=new Set();
  const lineW=Number(geometry.line_width_mm),gap=interWordGap(profile),setuma=setumaGapMm(profile,geometry);
  const songPages=new Set(reference.lines.filter(line=>line.items.some(item=>item.type==='segment_gap')).map(line=>line.page));
  const songWidths=profile.stretch_policy?.song_widths_mm || {};
  const lines=reference.lines.map((ref,li)=>{
    const effectiveLineW=songPages.has(ref.page)&&Number(songWidths.page)>0?Number(songWidths.page):lineW;
    let width=0,prevWord=false;
    const items=ref.items.map(it=>{
      if(it.type==='word') {
        if(!Number.isInteger(it.word_index)||!words[it.word_index]||it.word_index!==seen.size)throw new Error('Invalid, repeated or reordered reference word');
        seen.add(it.word_index);const word=words[it.word_index],w=measureWord(word,profile,overrides);
        width+=w+(prevWord?gap:0);prevWord=true;
        return {...word,width_mm:w,override:wordOverrides(word,overrides,profile)};
      }
      prevWord=false;
      const w=it.type==='setuma_gap'?setuma:it.type==='nun_hafucha'?totalWidth('נ',profile):0;
      width+=w;return {type:it.type,width_mm:w,...(it.break_kind?{break_kind:it.break_kind}:{})};
    });
    // Poetry segments remain side by side in their reference order. Distribute
    // only their explicit blank gaps; never classify song spacing as setumah.
    const gaps=items.filter(it=>it.type==='segment_gap');
    if(gaps.length){
      const fallbackGap = Math.max(0,effectiveLineW-width)/gaps.length;
      for(const item of gaps){
        const chosen=item.break_kind==='middle'||gaps.length===1?Number(songWidths.middle):Number(songWidths.side);
        item.width_mm=chosen>0?chosen:fallbackGap;
        width+=item.width_mm;
      }
    }
    const line=makeLine(items,width,effectiveLineW,profile,{endedBy:ref.petucha_end?'petucha':null});
    const lastIndex=ref.items.filter(it=>it.type==='word').at(-1)?.word_index;
    if(lastIndex!=null && (!words[lastIndex+1] || verseBooks.get(words[lastIndex].verse)!==verseBooks.get(words[lastIndex+1].verse)))line.sefer_end=true;
    line.fixed_pattern=!!ref.fixed_pattern||ref.blank;line.reference_page=ref.page;line.reference_record=ref.source_record;
    line.book_boundary_blank=!!ref.book_boundary_blank;
    if(opts.onProgress&&li%128===0)opts.onProgress({processed:li,total:reference.lines.length,phase:'reference'});
    return line;
  });
  if(seen.size!==words.length)throw new Error('Reference omitted source words');
  const output=profile.layout_mode==='reflow'?reflowMeasuredReference(lines,lineW,profile):lines;
  const result=finalizeLayout(output,verseLetters.reduce((s,v)=>s+v.letters.length,0),geometry,profile,derived,[],false,false);
  const {lines:ignored,...provenance}=reference;
  result.summary.reference=provenance;
  result.summary.reference_review_required=true;
  result.summary.layout_mode=profile.layout_mode||'reference';
  result.summary.units_per_row=profile.units_per_row??null;
  result.summary.unit_basis=profile.unit_basis||'skeleton';
  result.summary.overfull_lines=output.filter(l=>l.leftover_mm< -TOL).length;
  return result;
}

// Tikkun supplies the ordered text and structural markers, not ordinary line
// membership in reflow mode. Preserve fixed song/inverted-nun lines verbatim;
// repaginate ordinary words at physical width. A setumah's adjacent words form
// one indivisible pack so its gap can never drift to an edge during wrapping.
function reflowMeasuredReference(referenceLines,lineW,profile) {
  const output=[],wordGap=interWordGap(profile);let buffer=[];
  const protectedIndexes=new Set();
  const songPages=new Set(referenceLines.filter(line=>line.items.some(item=>item.type==='segment_gap')).map(line=>line.reference_page));
  // Reference padding rows are marked fixed_pattern so exact Tikkun mode can
  // reproduce the source page. They are not textual fixed passages and must
  // disappear when pagination is recalculated. Only protect meaningful fixed
  // rows (songs / inverted-nun passages) and their textual boundary rows.
  referenceLines.forEach((line,index)=>{
    if(profile.stretch_policy?.version === 2 && songPages.has(line.reference_page)) protectedIndexes.add(index);
    if(line.fixed_pattern&&line.items.length){
      protectedIndexes.add(index);
      if(index&&referenceLines[index-1].items.length)protectedIndexes.add(index-1);
      if(index+1<referenceLines.length&&referenceLines[index+1].items.length)protectedIndexes.add(index+1);
    }
  });
  function widthOf(items){let n=0;items.forEach((item,i)=>{n+=Number(item.width_mm)||0;if(i&&item.type==='word'&&items[i-1].type==='word')n+=wordGap;});return n;}
  function flush(endedBy){
    if(!buffer.length)return;
    const packs=[];
    for(const item of buffer){
      if(item.type==='setuma_gap'){
        if(!packs.length||packs.at(-1).at(-1).type!=='word')throw new Error('Reflow blocked: setumah lacks a preceding word');
        packs.at(-1).push(item);
      }else if(packs.length&&packs.at(-1).at(-1).type==='setuma_gap')packs.at(-1).push(item);
      else packs.push([item]);
    }
    if(packs.at(-1)?.at(-1).type==='setuma_gap')throw new Error('Reflow blocked: setumah lacks a following word');
    let current=[];
    for(const pack of packs){
      const together=current.concat(pack);
      if(current.length&&widthOf(together)>lineW+1e-9){output.push(makeLine(current,widthOf(current),lineW,profile));current=[];}
      current.push(...pack);
    }
    if(current.length){const line=makeLine(current,widthOf(current),lineW,profile,{endedBy});line.sefer_end=endedBy==='sefer';output.push(line);}
    buffer=[];
  }
  for(const [index,line] of referenceLines.entries()){
    // Blank rows belong to the reference pagination, not the Torah text. In
    // reflow mode they neither consume a line nor force a wrap boundary.
    if(line.book_boundary_blank){flush();output.push(line);continue;}
    if(line.fixed_pattern&&!line.items.length)continue;
    if(protectedIndexes.has(index)){
      flush();
      // Fixed song/inverted-nun blocks and their immediate boundary rows keep
      // exact reference membership. This prevents a setumah adjacent to a
      // fixed passage being detached from either neighbouring word.
      output.push(line);
      continue;
    }
    buffer.push(...line.items);
    if(line.petucha_end||line.sefer_end){
      flush(line.petucha_end?'petucha':'sefer');
      // A book boundary can also be a petuchah. Retain both facts rather than
      // dropping the paragraph marker when protecting the end-of-book space.
      if(line.sefer_end && output.length) output.at(-1).sefer_end=true;
    }
  }
  flush();
  const before=referenceLines.flatMap(l=>l.words.flatMap(w=>w.letters.map(x=>x.id)));
  const after=output.flatMap(l=>l.words.flatMap(w=>w.letters.map(x=>x.id)));
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Reflow changed source letter order');
  return output;
}

// ---- Top-level compute ----------------------------------------------------

export function computeLayout(source, profile, geometry, opts = {}) {
  profile = effectiveProfile(profile, geometry);
  const g = deriveGeometry(geometry, profile);
  if(source.reference)return computeReferenceLayout(source,profile,geometry,g,opts);
  const patternDefs = opts.patterns || [];
  const { passageMap, blockers } = resolvePatternsForSource(source, patternDefs, opts.annotations || {});
  if (blockers.length && !opts.study_preview) {
    throw new Error('pattern data blocker: ' + blockers.map((b) => b.reason).join('; '));
  }
  const fitted = fitLines(source, profile, geometry, { ...opts, passageMap });
  return finalizeLayout(fitted.lines, fitted.totalLetters, geometry, profile, g, blockers, source.excerpt, opts.study_preview);
}

function finalizeLayout(lines, totalLetters, geometry, profile, g, blockers = [], excerpt = false, studyPreview = false) {
  const grouped = groupAndAnnotate(lines, geometry, profile);
  const total_amudim = grouped.amudim.length;
  const yerias = computeYerios(total_amudim, geometry, profile);
  return {
    lines: grouped.lines,
    amudim: grouped.amudim,
    amud_annotations: grouped.amud_annotations,
    vavei_flagged: grouped.vavei_flagged,
    geometry: g,
    summary: {
      total_lines: grouped.lines.length,
      total_amudim,
      amudim_per_yeria: yerias.amudim_per_yeria,
      total_yerios: yerias.total_yerios,
      klaf_length_m: round(yerias.klaf_length_m, 3),
      partial_final_columns: yerias.partial_final_columns,
      convention: yerias.convention,
      total_letters: totalLetters,
      min_column_width_mm: round(g.minColumnWidth_mm),
      min_column_width_violation: g.minColumnWidthViolation,
      is_excerpt: !!excerpt,
      study_preview: !!studyPreview,
    },
    yerias: yerias.yeria_widths_mm.map((w) => round(w)),
    pattern_blockers: blockers || [],
  };
}

// Async compute that actually yields the event loop (setImmediate) so long
// workloads never block concurrent health/UI requests; progress reflects real
// advance, not a timer animation.
export async function computeLayoutAsync(source, profile, geometry, opts = {}) {
  profile = effectiveProfile(profile, geometry);
  const g = deriveGeometry(geometry, profile);
  if(source.reference) {
    // Reference membership is fixed, not a normal fit with wrapping enabled.
    await new Promise(resolve=>setImmediate(resolve));
    return computeReferenceLayout(source,profile,geometry,g,opts);
  }
  const patternDefs = opts.patterns || [];
  const { passageMap, blockers } = resolvePatternsForSource(source, patternDefs, opts.annotations || {});
  if (blockers.length && !opts.study_preview) {
    throw new Error('pattern data blocker: ' + blockers.map((b) => b.reason).join('; '));
  }
  const { units, verseLetters } = buildWordUnits(source);
  const overrideMap = buildOverrideMap(source, verseLetters);
  const lineW = num(geometry.line_width_mm);
  const gap_word = interWordGap(profile);
  const sgap = setumaGapMm(profile, geometry);

  const lines = [];
  let current = [];
  let currentWidth = 0;
  let prevWasWord = false;
  const pushLine = (flags = {}) => {
    if (current.length === 0 && !flags.force) return;
    const line = makeLine(current, currentWidth, lineW, profile, flags);
    if (current.some(item => item.type === 'segment_gap')) line.fixed_pattern = true;
    lines.push(line);
    current = []; currentWidth = 0; prevWasWord = false;
  };

  const yieldEvery = opts.progressChunk || 256;
  const yieldControl = () => new Promise((r) => setImmediate(r));

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    // Yield the event loop every chunk REGARDLESS of onProgress so every async
    // caller (compare, candidate creation) lets a concurrent health/UI probe be
    // served even when it does not subscribe to progress (F-15).
    if ((i + 1) % yieldEvery === 0) {
      if (opts.onProgress) opts.onProgress({ processed: i + 1, total: units.length, phase: 'fitting' });
      await yieldControl();
    }
    if (u.type === 'word' && passageMap && passageMap[u.verse]) {
      const passage = passageMap[u.verse];
      const collected = [];
      while (i < units.length && units[i].type === 'word' && passageMap[units[i].verse] === passage) {
        collected.push(units[i]); i += 1;
      }
      i -= 1;
      pushLine();
      for (const fl of renderPattern(passage, profile, geometry, collected, overrideMap)) lines.push(fl);
      current = []; currentWidth = 0; prevWasWord = false;
      continue;
    }
    if (u.type === 'word') {
      const w = measureWord(u, profile, overrideMap);
      const addGap = prevWasWord ? gap_word : 0;
      if (current.length === 0) {
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth = w;
      } else if (currentWidth + (addGap + w) <= lineW + 1e-9) {
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth += addGap + w;
      } else {
        pushLine();
        current.push({ ...u, width_mm: w, override: wordOverrides(u, overrideMap, profile) });
        currentWidth = w;
      }
      prevWasWord = true;
    } else if (u.type === 'setuma') {
      if (current.length === 0) {
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth = sgap;
      } else if (currentWidth + sgap <= lineW + 1e-9) {
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth += sgap;
      } else {
        pushLine();
        current.push({ type: 'setuma_gap', width_mm: sgap, verse: u.verse });
        currentWidth = sgap;
      }
      prevWasWord = false;
    } else if (u.type === 'petucha' || u.type === 'sefer') {
      pushLine({ endedBy: u.type, endVerse: u.verse });
    } else if (u.type === 'song_break') {
      const song = profile.stretch_policy?.song_widths_mm || {};
      const width = Math.max(0, Number(u.break_kind === '1' ? song.middle : song.side) || 0);
      current.push({ type: 'segment_gap', break_kind: u.break_kind === '1' ? 'middle' : 'side', width_mm: width, verse: u.verse });
      currentWidth += width; prevWasWord = false;
    } else if (u.type === 'blank_line') {
      pushLine();
      const blank = makeLine([], 0, lineW, profile, { force: true });
      blank.blank_line = true;
      lines.push(blank);
    }
  }
  pushLine({ force: current.length > 0 });
  return finalizeLayout(lines, verseLetters.reduce((s, vl) => s + vl.letters.length, 0), geometry, profile, g, blockers, source.excerpt, opts.study_preview);
}

function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (d == null ? 0 : d);
}
function round(x, p) {
  const e = Math.pow(10, p == null ? 3 : p);
  return Math.round(x * e) / e;
}

// ---- Geometry normalization ----------------------------------------------

export function normalizeGeometry(g) {
  const src = g || {};
  return {
    id: src.id || null,
    name: src.name || 'unnamed geometry',
    lines_per_amud: int(src.lines_per_amud, 42),
    baseline_pitch_mm: num(src.baseline_pitch_mm, 8.0),
    top_margin_mm: num(src.top_margin_mm, 10),
    bottom_margin_mm: num(src.bottom_margin_mm, 10),
    inter_column_gap_mm: num(src.inter_column_gap_mm, 12),
    outer_margin_mm: num(src.outer_margin_mm, 10),
    line_width_mm: num(src.line_width_mm, 160),
    // Zero explicitly disables the old character-count warning. It is not a
    // unit limit: the measured line_width_mm is the real wrapping budget.
    max_letters_per_line: Number(src.max_letters_per_line) === 0 ? 0 : int(src.max_letters_per_line, 15),
    amudim_per_yeria: int(src.amudim_per_yeria, 2),
    partial_final_yeria: src.partial_final_yeria === 'exact' ? 'exact' : 'round_up',
    setuma_gap_mm: src.setuma_gap_mm != null ? num(src.setuma_gap_mm) : null,
    setuma_reference_letter: src.setuma_reference_letter || 'א',
    min_inter_letter_gap_mm: num(src.min_inter_letter_gap_mm, 0),
    min_inter_word_gap_mm: num(src.min_inter_word_gap_mm, 1.0),
    max_inter_word_gap_mm: src.max_inter_word_gap_mm != null ? num(src.max_inter_word_gap_mm) : null,
    max_inter_word_gap_factor: src.max_inter_word_gap_factor != null ? num(src.max_inter_word_gap_factor) : null,
    small_letter_reference: src.small_letter_reference || 'י',
    vavei_haamudim: src.vavei_haamudim !== false,
    created_at: src.created_at || null,
  };
}
