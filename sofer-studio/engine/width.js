// engine/width.js
// Width calculation (frozen convention).
//   skeletonWidth(letter, profile)      = referenceSkeletonWidth * (letter_height_mm / reference_height_mm)
//   strokeContribution(letter, profile) = stroke_mm * strokeFactor(letter)
//   totalWidth(letter, profile)         = skeletonWidth + strokeContribution
// Skeleton EXCLUDES stroke. Stroke added ONCE, never double-counted.
//
// Letter widths are stored in UNITS (sofer-editable). 1 unit = unit_mm mm.
// referenceSkeletonWidth(letter) = letter_widths[letter] (units) * unit_mm (mm at reference height).

import { lettersOf, letterKeyOf } from './profile.js';

// reference skeleton width in mm, at the reference height
export function referenceSkeletonWidthMm(letter, profile) {
  const units = Number(profile.letter_widths[letter]);
  return (Number.isFinite(units) ? units : 0) * profile.unit_mm;
}

export function skeletonWidth(letter, profile) {
  const ref = referenceSkeletonWidthMm(letter, profile);
  if (!(profile.reference_height_mm > 0)) return 0;
  return ref * (profile.letter_height_mm / profile.reference_height_mm);
}

export function strokeFactor(letter, profile) {
  const f = profile.stroke_factors && profile.stroke_factors[letter];
  const n = Number(f);
  return Number.isFinite(n) ? n : 1.0;
}

export function strokeContribution(letter, profile) {
  return profile.stroke_mm * strokeFactor(letter, profile);
}

export function totalWidth(letter, profile) {
  return skeletonWidth(letter, profile) + strokeContribution(letter, profile);
}

export function interLetterGap(profile) {
  return Number(profile.gaps.inter_letter) || 0;
}

export function interWordGap(profile) {
  const n = Number(profile.gaps.inter_word);
  return Number.isFinite(n) ? n : 1.0;
}

// Width of a single word: sum of total letter widths + (n-1) inter-letter gaps.
export function wordWidth(word, profile) {
  if (!word) return 0;
  const letters = lettersOf(word);
  let w = 0;
  for (const g of letters) w += totalWidth(letterKeyOf(g), profile);
  if (letters.length > 1) w += (letters.length - 1) * interLetterGap(profile);
  return w;
}

// Width of a list of tokens (words): word widths + inter-word gaps between tokens.
export function lineWidth(tokens, profile) {
  if (!tokens || tokens.length === 0) return 0;
  let w = 0;
  for (const t of tokens) w += wordWidth(t, profile);
  if (tokens.length > 1) w += (tokens.length - 1) * interWordGap(profile);
  return w;
}

// Measurement-table units become physical row units in the corrected mode.
// Legacy saved layouts retain their original reference-height unit conversion.
export function measurementUnitMm(profile) {
  if (profile.unit_basis === 'line_units' && profile.units_per_row > 0 && profile.unit_column_width_mm > 0) {
    return profile.unit_column_width_mm / profile.units_per_row;
  }
  return Number(profile.unit_mm) || 0;
}

// Unit <-> mm conversion.
export function unitsToMm(units, profile) {
  return units * measurementUnitMm(profile);
}

export function mmToUnits(mm, profile) {
  const unit = measurementUnitMm(profile);
  if (!(unit > 0)) return 0;
  return mm / unit;
}

// Minimum column width: 3 repetitions of the threshold word + 2 inter-word gaps.
export const THRESHOLD_WORD = 'למשפחותיכם';

export function minColumnWidth(profile) {
  return 3 * wordWidth(THRESHOLD_WORD, profile) + 2 * interWordGap(profile);
}

// F-35: warn when the master letter height falls below the sofer's configurable
// minimum practical LETTER HEIGHT (a dimension distinct from the kav/nib stroke).
export function nibSizeWarning(profile) {
  const min = Number(profile.min_letter_height_mm);
  if (Number.isFinite(min) && min > 0 && profile.letter_height_mm < min) {
    return `letter height ${profile.letter_height_mm}mm is below minimum practical letter height ${min}mm`;
  }
  return null;
}

// Warn when the kav/stroke width falls below the sofer's minimum practical nib size.
export function strokeWarning(profile) {
  const min = Number(profile.min_nib_mm);
  if (Number.isFinite(min) && min > 0 && profile.stroke_mm < min) {
    return `stroke ${profile.stroke_mm}mm is below minimum practical nib size ${min}mm`;
  }
  return null;
}
