// engine/profile.js
// Calibration profile normalization and factory defaults.

import { segmentGraphemes, isHebrewGrapheme, graphemeBaseLetter } from './text.js';

export const HEBREW_LETTERS = [
  'א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ך','ל','מ','ם','נ','ן','ס','ע','פ','ף',
  'צ','ץ','ק','ר','ש','ת',
];

export const DEFAULT_REFERENCE_HEIGHT_MM = 3.0;
export const DEFAULT_UNIT_MM = 0.5;
export const DEFAULT_STROKE_MM = 0.2;
export const DEFAULT_LETTER_HEIGHT_MM = 4.5;
export const DEFAULT_MIN_NIB_MM = 1.0;
export const DEFAULT_MIN_LETTER_HEIGHT_MM = 3.0;

export const DEFAULT_LETTER_WIDTHS_UNITS = {
  'א': 2, 'ב': 2, 'ג': 1, 'ד': 2, 'ה': 2, 'ו': 1, 'ז': 1, 'ח': 2, 'ט': 2,
  'י': 1, 'כ': 2, 'ך': 2, 'ל': 2, 'מ': 2, 'ם': 2, 'נ': 1, 'ן': 1, 'ס': 2,
  'ע': 2, 'פ': 2, 'ף': 2, 'צ': 2, 'ץ': 2, 'ק': 2, 'ר': 2, 'ש': 3, 'ת': 2,
};

export const SPECIAL_MEASUREMENT_KEYS = ['word_space', 'hyphen', 'petucha', 'setuma'];
export const DEFAULT_SPECIAL_WIDTHS_UNITS = Object.freeze({ word_space: 2, hyphen: 1, petucha: 20, setuma: 20 });
export const DEFAULT_STRETCH_PRIORITIES = Object.freeze({
  ...Object.fromEntries(HEBREW_LETTERS.map((ch) => [ch, 'אדהטלמםקרת'.includes(ch) ? 2 : 3])),
  word_space: 3, hyphen: 3, petucha: 1, setuma: 1,
});
export const DEFAULT_STRETCH_POLICY = Object.freeze({
  version: 2,
  caps_percent: Object.freeze(Object.fromEntries(HEBREW_LETTERS.map((ch) => [ch, 'דהרת'.includes(ch) ? 'unlimited' : 50]))),
  distribution: 'equal_mm',
  word_space_percent: 50,
  petucha_percent: 'unlimited',
  setuma_percent: 'unlimited',
  stam_hyphen_units: 1,
});

export const DEFAULT_STRETCHABLE = ['ד','ה','ח','ל','ר','ת','ב','כ','ם','ס'];
export const DEFAULT_NON_STRETCHABLE = ['י','ו','ז','ן','נ','ג','צ','ץ'];

export const DEFAULT_MAX_STRETCH_MM = {
  'ד': 1.5, 'ה': 1.5, 'ח': 1.5, 'ל': 1.5, 'ר': 1.8, 'ת': 1.8,
  'ב': 1.5, 'כ': 1.5, 'ם': 1.5, 'ס': 1.5,
};

export function normalizeProfile(p) {
  const src = p || {};
  const letter_widths = {};
  for (const ch of HEBREW_LETTERS) {
    const v = (src.letter_widths && src.letter_widths[ch] != null)
      ? src.letter_widths[ch] : DEFAULT_LETTER_WIDTHS_UNITS[ch];
    letter_widths[ch] = Number(v);
  }
  const max_stretch = {};
  for (const ch of HEBREW_LETTERS) {
    const v = (src.max_stretch && src.max_stretch[ch] != null)
      ? src.max_stretch[ch] : (DEFAULT_MAX_STRETCH_MM[ch] != null ? DEFAULT_MAX_STRETCH_MM[ch] : 0);
    max_stretch[ch] = Number(v);
  }
  const stroke_factors = {};
  for (const ch of HEBREW_LETTERS) {
    const v = (src.stroke_factors && src.stroke_factors[ch] != null)
      ? src.stroke_factors[ch] : 1.0;
    stroke_factors[ch] = Number(v);
  }
  // An explicitly empty override array must be respected (never reintroduce defaults).
  const non_stretchable = toArray(
    src.non_stretchable != null && Array.isArray(src.non_stretchable)
      ? src.non_stretchable : DEFAULT_NON_STRETCHABLE
  );
  const special_widths_units = Object.fromEntries(SPECIAL_MEASUREMENT_KEYS.map((key) => [
    key,
    Math.max(key === 'petucha' || key === 'setuma' ? 20 : 0, num(src.stretch_policy?.special_widths_units?.[key] ?? src.special_widths_units?.[key], DEFAULT_SPECIAL_WIDTHS_UNITS[key])),
  ]));
  const stretch_priorities = Object.fromEntries([...HEBREW_LETTERS, ...SPECIAL_MEASUREMENT_KEYS].map((key) => [
    key, Math.max(1, Math.round(num(src.stretch_policy?.priorities?.[key] ?? src.stretch_priorities?.[key], DEFAULT_STRETCH_PRIORITIES[key]))),
  ]));

  return {
    id: src.id || null,
    name: src.name || 'unnamed profile',
    reference_height_mm: num(src.reference_height_mm, DEFAULT_REFERENCE_HEIGHT_MM),
    letter_height_mm: num(src.letter_height_mm, DEFAULT_LETTER_HEIGHT_MM),
    stroke_mm: num(src.stroke_mm, DEFAULT_STROKE_MM),
    unit_mm: num(src.unit_mm, DEFAULT_UNIT_MM),
    min_nib_mm: num(src.min_nib_mm, DEFAULT_MIN_NIB_MM),
    min_letter_height_mm: num(src.min_letter_height_mm, DEFAULT_MIN_LETTER_HEIGHT_MM),
    letter_widths,
    stroke_factors,
    gaps: {
      inter_letter: num(src.gaps && src.gaps.inter_letter, 0),
      inter_word: num(src.gaps && src.gaps.inter_word, 1.0),
    },
    non_stretchable,
    max_stretch,
    special_widths_units,
    stretch_priorities,
    stretch_position: src.stretch_position ? String(src.stretch_position) : 'anywhere',
    stretch_policy: src.stretch_policy ? {
      version: src.stretch_policy.version === 2 ? 2 : 1,
      caps_percent: Object.fromEntries(HEBREW_LETTERS.map(ch => [ch, src.stretch_policy.caps_percent?.[ch] ?? 0])),
      distribution: src.stretch_policy.distribution === 'equal_mm' ? 'equal_mm' : 'equal_percent',
      word_space_percent: Number(src.stretch_policy.word_space_percent ?? 50),
      petucha_percent: src.stretch_policy.petucha_percent ?? 'unlimited',
      setuma_percent: src.stretch_policy.setuma_percent ?? 50,
      setuma_first: src.stretch_policy.setuma_first !== false,
      stam_hyphen_units: Math.max(0, Number(src.stretch_policy.stam_hyphen_units ?? 1)),
      special_widths_units,
      priorities: stretch_priorities,
      song_widths_mm: {
        page: Math.max(0, num(src.stretch_policy.song_widths_mm?.page, 0)),
        middle: Math.max(0, num(src.stretch_policy.song_widths_mm?.middle, 0)),
        side: Math.max(0, num(src.stretch_policy.song_widths_mm?.side, 0)),
      },
    } : null,
    units_per_row: src.units_per_row == null ? null : Number(src.units_per_row),
    unit_basis: src.unit_basis === 'average_letter' ? 'average_letter' : 'skeleton',
    layout_mode: src.layout_mode === 'reflow' ? 'reflow' : 'reference',
    ...(src.average_unit_mm != null ? {average_unit_mm:Number(src.average_unit_mm)} : {}),
    ...(src.unit_column_width_mm != null ? { unit_column_width_mm: Number(src.unit_column_width_mm) } : {}),
    ...(src.word_space_limit_mm != null ? { word_space_limit_mm: Number(src.word_space_limit_mm) } : {}),
    created_at: src.created_at || null,
  };
}

export function defaultProfile(name) {
  return normalizeProfile({
    name: name || 'Classic Sefer Torah',
    units_per_row: 62,
    unit_basis: 'average_letter',
    layout_mode: 'reflow',
    non_stretchable: [],
    stretch_policy: DEFAULT_STRETCH_POLICY,
  });
}

export function letterKeyOf(grapheme) {
  return graphemeBaseLetter(grapheme);
}

export function lettersOf(word) {
  return segmentGraphemes(word).filter(isHebrewGrapheme);
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function toArray(arr) {
  return arr.filter((x) => typeof x === 'string');
}

export function nonStretchableArray(profile) {
  return Array.from(profile.non_stretchable || []);
}

export function computeStretchableSet(profile) {
  const stretchable = new Set();
  for (const ch of HEBREW_LETTERS) {
    if (!profile.non_stretchable.includes(ch)) stretchable.add(ch);
  }
  return stretchable;
}
