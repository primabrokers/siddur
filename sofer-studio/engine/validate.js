// engine/validate.js
// Line validation: underfull/overfull, conflicting bounds, human-marked holy name too-wide,
// minimum column width, letter count and spacing limits. Every line is validated.

import { countHebrewLetters } from './text.js';
import { totalWidth, interWordGap, interLetterGap } from './width.js';
import { applyStretch } from './layout.js';

const TOL = 1e-6;

// F-08: the DEFAULT max inter-word gap is strictly BELOW the small-letter reference
// width (defaulting to 95% of it), never an exact equality. The factor is
// configurable per geometry via `max_inter_word_gap_factor` and documented here as
// a halachic-parameter edit point.
export const DEFAULT_MAX_INTER_WORD_GAP_FACTOR = 0.95;

export function maxInterWordGap(profile, geometry) {
  if (geometry.max_inter_word_gap_mm != null && Number.isFinite(Number(geometry.max_inter_word_gap_mm))) {
    return Number(geometry.max_inter_word_gap_mm);
  }
  const ref = geometry.small_letter_reference || 'י';
  const factor = Number(geometry.max_inter_word_gap_factor) || DEFAULT_MAX_INTER_WORD_GAP_FACTOR;
  return totalWidth(ref, profile) * factor;
}

// Validate spacing-limit bounds for impossible combinations.
export function validateSpacingBounds(profile, geometry) {
  const errors = [];
  const minL = Number(geometry.min_inter_letter_gap_mm) || 0;
  const minW = Number(geometry.min_inter_word_gap_mm) || 0;
  const maxW = maxInterWordGap(profile, geometry);
  const ref = geometry.small_letter_reference || 'י';
  const smallLetterWidth = totalWidth(ref, profile);
  if (minW > maxW) errors.push(`min inter-word gap ${minW}mm exceeds max inter-word gap ${maxW}mm`);
  if (maxW < 0) errors.push('max inter-word gap is negative');
  // A max (explicit OR default) must be strictly below the calibrated small-letter
  // width; a max >= the smallest letter width is an impossible combination in ALL
  // paths (rejected even when the current word gap itself is smaller than the max).
  if (maxW >= smallLetterWidth) {
    errors.push(`max inter-word gap ${round(maxW)}mm must be strictly below small-letter width ${round(smallLetterWidth)}mm`);
  }
  if (interLetterGap(profile) < minL) errors.push(`inter-letter gap ${interLetterGap(profile)}mm below minimum ${minL}mm`);
  if (interWordGap(profile) < minW) errors.push(`inter-word gap ${interWordGap(profile)}mm below minimum ${minW}mm`);
  if (interWordGap(profile) > maxW) errors.push(`inter-word gap ${interWordGap(profile)}mm exceeds maximum ${maxW}mm`);
  return errors;
}

export function validateLine(line, profile, geometry) {
  const errors = [];
  const warnings = [];
  const lineW = Number(geometry.line_width_mm);

  // Setuma at a line edge is impossible by definition.
  if (line.setuma_at_edge || (line.has_setuma && !line.words.length)) {
    errors.push('setuma gap at line edge');
  }

  const letterCount = countHebrewLetters(line.consonant_text || '');
  if (geometry.max_letters_per_line && letterCount > geometry.max_letters_per_line) {
    warnings.push(`line has ${letterCount} Hebrew letters, exceeding maximum ${geometry.max_letters_per_line}`);
  }

  // Overfull (cannot stretch away). Uses the STRETCHED width when a stretch has
  // been applied so a line justified past its remaining width is re-flagged.
  const effWidth = line.stretched_width_mm != null ? Number(line.stretched_width_mm) : line.width_mm;
  if (effWidth - lineW > TOL) {
    errors.push(`overfull: width ${round(effWidth)}mm exceeds line width ${round(lineW)}mm by ${round(effWidth - lineW)}mm`);
  }

  // Applying some stretching does not imply a full line. Keep the unresolved
  // shortfall visible, but never flag intentional section/book/song spaces.
  if (line.leftover_mm >= 0.001 && !line.petucha_end && !line.fixed_pattern && !line.sefer_end && (!line.has_setuma || profile.stretch_policy)) {
    warnings.push(`underfull: ${round(line.leftover_mm)}mm leftover${line.stretch_decisions?.length ? ' after stretching' : ', not justified'}`);
  }

  // A human-marked holy name that is too wide is unsatisfiable.
  for (const w of line.words || []) {
    if (w.isShem && w.width_mm > lineW + TOL) {
      errors.push(`unsatisfiable: human-marked holy-name token "${w.text}" is wider than the line (${round(w.width_mm)}mm > ${round(lineW)}mm)`);
    }
  }

  // Override validation: no stretch decision may exceed its per-letter cap.
  if (profile.stretch_policy && line.stretch_decisions?.length) {
    try { applyStretch({...line}, line.stretch_decisions, profile); }
    catch (error) { errors.push(error.message); }
  }
  for (const d of line.stretch_decisions || []) {
    if (profile.stretch_policy) break;
    const base = findBase(line, d.letter_occurrence_id);
    if (base) {
      const cap = profile.max_stretch[base] || 0;
      if (d.stretch_mm > cap + TOL) errors.push(`stretch ${d.stretch_mm}mm exceeds cap ${cap}mm for ${base}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function findBase(line, occId) {
  for (const w of line.words || []) for (const l of w.letters) if (l.id === occId) return l.base;
  return null;
}

export function validateLayout(lines, profile, geometry) {
  const spacingErrors = validateSpacingBounds(profile, geometry);
  const perLine = lines.map((line) => {
    const v = validateLine(line, profile, geometry);
    return { line_id: line.line_id || line.start_letter_index || '', valid: v.valid, errors: v.errors, warnings: v.warnings };
  });
  const allValid = spacingErrors.length === 0 && perLine.every((l) => l.valid);
  return { valid: allValid, spacing_errors: spacingErrors, lines: perLine };
}

function round(x) {
  const e = 1000;
  return Math.round(x * e) / e;
}
