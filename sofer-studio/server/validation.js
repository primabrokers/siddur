import { columnOptionsErrors } from '../engine/column-options.js';
// server/validation.js
// Strict input validation for mutation bodies. Rejects negative, non-finite and
// out-of-range physical inputs with a clear 400 message instead of silently
// coercing them to defaults.

function num(v) { return v === '' ? NaN : Number(v); }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// A field that must be a finite non-negative number when provided.
function checkNonNegative(errs, body, key, label, opts = {}) {
  if (!(key in body) || body[key] == null) return;
  const v = num(body[key]);
  const allowZero = opts.allowZero !== false;
  if (!Number.isFinite(v)) { errs.push(label + ' must be a finite number'); return; }
  if (allowZero ? (v < 0) : (v <= 0)) errs.push(label + ' must be ' + (allowZero ? 'non-negative' : 'greater than zero'));
}

export function validateProfileInput(body) {
  const errs = [];
  checkNonNegative(errs, body, 'letter_height_units', 'Letter height in units', { allowZero: false });
  checkNonNegative(errs, body, 'letter_height_mm', 'letter_height_mm', { allowZero: false });
  checkNonNegative(errs, body, 'stroke_mm', 'stroke_mm');
  checkNonNegative(errs, body, 'unit_mm', 'unit_mm', { allowZero: false });
  checkNonNegative(errs, body, 'min_nib_mm', 'min_nib_mm');
  checkNonNegative(errs, body, 'reference_height_mm', 'reference_height_mm', { allowZero: false });
  checkNonNegative(errs, body, 'min_letter_height_mm', 'min_letter_height_mm');
  checkNonNegative(errs, body, 'units_per_row', 'units_per_row', { allowZero: false });
  if(body.unit_basis!=null&&!['line_units','average_letter','skeleton'].includes(body.unit_basis))errs.push('unit_basis must be line_units, average_letter or skeleton');
  if(body.layout_mode!=null&&!['reflow','reference'].includes(body.layout_mode))errs.push('layout_mode must be reflow or reference');
  if (body.stretch_policy != null) {
    const policy = body.stretch_policy;
    if (typeof policy !== 'object' || Array.isArray(policy)) errs.push('stretch_policy must be an object');
    else {
      const validPercent = value => value === 'unlimited' || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
      if (![1, 2].includes(policy.version)) errs.push('stretch_policy.version must be 1 or 2');
      if (!policy.caps_percent || typeof policy.caps_percent !== 'object' || Array.isArray(policy.caps_percent)) errs.push('caps_percent must be an object');
      else for (const [letter, value] of Object.entries(policy.caps_percent)) {
        if (!validPercent(value)) errs.push('caps_percent[' + letter + '] must be a non-negative percentage or unlimited');
      }
      if (!['equal_percent', 'equal_mm'].includes(policy.distribution)) errs.push('Choose equal_percent or equal_mm distribution');
      if (policy.secondary != null) {
        const secondary = policy.secondary;
        if (policy.version !== 2 || typeof secondary !== 'object' || Array.isArray(secondary)) errs.push('Secondary stretching requires version 2 rules');
        else {
          for (const field of ['caps_percent', 'priorities']) {
            const values = secondary[field];
            if (!values || typeof values !== 'object' || Array.isArray(values)) errs.push('Secondary ' + field + ' must be an object');
            else for (const [key, value] of Object.entries(values)) {
              if (field === 'caps_percent' ? !validPercent(value) : !Number.isInteger(value) || value < 1) errs.push('Invalid secondary ' + field + ' for ' + key);
            }
          }
        }
      }
      if (policy.version === 2) {
        if (!validPercent(policy.word_space_percent)) errs.push('Word-space cap must be a non-negative percentage or unlimited');
        if (policy.hyphen_percent != null && !validPercent(policy.hyphen_percent)) errs.push('Hyphen cap must be a non-negative percentage or unlimited');
      } else if (typeof policy.word_space_percent !== 'number' || !Number.isFinite(policy.word_space_percent) || policy.word_space_percent < 0 || policy.word_space_percent > 50) errs.push('Ordinary word-space stretching must be between 0 and 50 percent');
      if (policy.version === 2 && !validPercent(policy.petucha_percent)) errs.push('Petuchah gap cap must be a non-negative percentage or unlimited');
      if (!validPercent(policy.setuma_percent)) errs.push('Setumah gap cap must be a non-negative percentage or unlimited');
      if (policy.version === 1 && typeof policy.setuma_first !== 'boolean') errs.push('setuma_first must be a boolean');
      if (policy.stam_hyphen_units != null && (typeof policy.stam_hyphen_units !== 'number' || !Number.isFinite(policy.stam_hyphen_units) || policy.stam_hyphen_units < 0)) errs.push('STAM hyphen units must be a non-negative finite number');
      if (policy.version === 2) {
        const widths = policy.special_widths_units;
        if (!widths || typeof widths !== 'object' || Array.isArray(widths)) errs.push('stretch_policy.special_widths_units must be an object');
        else for (const key of ['word_space', 'hyphen', 'petucha', 'setuma']) {
          const value = num(widths[key]);
          const minimum = key === 'petucha' || key === 'setuma' ? 20 : 0;
          if (!Number.isFinite(value) || value < minimum) errs.push(`stretch_policy.special_widths_units.${key} must be at least ${minimum}`);
        }
        const priorities = policy.priorities;
        if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)) errs.push('stretch_policy.priorities must be an object');
        else for (const [key, value] of Object.entries(priorities)) {
          if (!Number.isInteger(Number(value)) || Number(value) < 1) errs.push(`stretch_policy.priorities.${key} must be a positive integer`);
        }
        const song = policy.song_widths_mm;
        if (!song || typeof song !== 'object' || Array.isArray(song)) errs.push('stretch_policy.song_widths_mm must be an object');
        else for (const key of ['page', 'middle', 'side']) {
          if (!Number.isFinite(Number(song[key])) || Number(song[key]) < 0) errs.push(`stretch_policy.song_widths_mm.${key} must be a non-negative number`);
        }
      }
    }
  }

  if (body.special_widths_units != null) {
    const widths = body.special_widths_units;
    if (typeof widths !== 'object' || Array.isArray(widths)) errs.push('special_widths_units must be an object');
    else for (const key of ['word_space', 'hyphen', 'petucha', 'setuma']) {
      const value = num(widths[key]);
      if (!Number.isFinite(value) || value < (key === 'petucha' || key === 'setuma' ? 20 : 0)) {
        errs.push(`special_widths_units.${key} must be at least ${key === 'petucha' || key === 'setuma' ? 20 : 0}`);
      }
    }
  }
  if (body.stretch_priorities != null) {
    if (typeof body.stretch_priorities !== 'object' || Array.isArray(body.stretch_priorities)) errs.push('stretch_priorities must be an object');
    else for (const [key, value] of Object.entries(body.stretch_priorities)) {
      if (!Number.isInteger(Number(value)) || Number(value) < 1) errs.push(`stretch_priorities.${key} must be a positive integer`);
    }
  }

  if (body.letter_widths != null) {
    if (typeof body.letter_widths !== 'object' || Array.isArray(body.letter_widths)) {
      errs.push('letter_widths must be an object keyed by Hebrew letter');
    } else {
      for (const [ch, v] of Object.entries(body.letter_widths)) {
        const n = num(v);
        if (!Number.isFinite(n) || n < 0) errs.push('letter_widths["' + ch + '"] must be a non-negative finite number');
      }
    }
  }

  if (body.max_stretch != null) {
    if (typeof body.max_stretch !== 'object' || Array.isArray(body.max_stretch)) errs.push('max_stretch must be an object');
    else for (const [ch, v] of Object.entries(body.max_stretch)) {
      const n = num(v);
      if (!Number.isFinite(n) || n < 0) errs.push('max_stretch["' + ch + '"] must be a non-negative finite number');
    }
  }

  if (body.gaps != null) {
    if (typeof body.gaps !== 'object' || Array.isArray(body.gaps)) errs.push('gaps must be an object');
    else {
      checkNonNegative(errs, body.gaps, 'inter_letter', 'gaps.inter_letter');
      checkNonNegative(errs, body.gaps, 'inter_word', 'gaps.inter_word');
    }
  }

  if (body.non_stretchable != null && !Array.isArray(body.non_stretchable)) {
    errs.push('non_stretchable must be an array');
  }
  if (body.stretch_position != null && !['anywhere', 'word_final', 'line_end'].includes(String(body.stretch_position))) {
    errs.push('stretch_position must be one of: anywhere, word_final, line_end');
  }
  return errs;
}

export function validateGeometryInput(body) {
  const errs = columnOptionsErrors(body);
  checkNonNegative(errs, body, 'line_width_mm', 'line_width_mm', { allowZero: false });
  checkNonNegative(errs, body, 'baseline_pitch_mm', 'baseline_pitch_mm', { allowZero: false });
  checkNonNegative(errs, body, 'top_margin_mm', 'top_margin_mm');
  checkNonNegative(errs, body, 'bottom_margin_mm', 'bottom_margin_mm');
  checkNonNegative(errs, body, 'inter_column_gap_mm', 'inter_column_gap_mm');
  checkNonNegative(errs, body, 'outer_margin_mm', 'outer_margin_mm');
  checkNonNegative(errs, body, 'min_inter_letter_gap_mm', 'min_inter_letter_gap_mm');
  checkNonNegative(errs, body, 'min_inter_word_gap_mm', 'min_inter_word_gap_mm');
  checkNonNegative(errs, body, 'max_inter_word_gap_mm', 'max_inter_word_gap_mm');
  checkNonNegative(errs, body, 'setuma_gap_mm', 'setuma_gap_mm');
  // N-04: the max inter-word gap factor must be a finite number strictly between
  // 0 and 1 — it scales the calibrated small-letter reference width downward.
  if (body.max_inter_word_gap_factor != null) {
    const f = num(body.max_inter_word_gap_factor);
    if (!Number.isFinite(f) || f <= 0 || f >= 1) {
      errs.push('max_inter_word_gap_factor must be greater than 0 and less than 1');
    }
  }
  if (body.lines_per_amud != null) {
    const n = num(body.lines_per_amud);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) errs.push('lines_per_amud must be a positive integer');
  }
  if (body.max_letters_per_line != null) {
    const n = num(body.max_letters_per_line);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) errs.push('max_letters_per_line must be a non-negative integer (0 disables the legacy warning)');
  }
  if (body.amudim_per_yeria != null) {
    const n = num(body.amudim_per_yeria);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) errs.push('amudim_per_yeria must be a positive integer');
  }
  if (body.partial_final_yeria != null && !['round_up', 'exact'].includes(String(body.partial_final_yeria))) {
    errs.push('partial_final_yeria must be one of: round_up, exact');
  }
  return errs;
}

export function validatePatternInput(body) {
  const errs = [];
  if (!Array.isArray(body.slots)) { errs.push('slots must be an array'); return errs; }
  body.slots.forEach((slot, si) => {
    if (!Array.isArray(slot.segments)) { errs.push('slot ' + si + ': segments must be an array'); return; }
    slot.segments.forEach((seg, sgi) => {
      if (!Array.isArray(seg.tokens)) { errs.push('slot ' + si + ' segment ' + sgi + ': tokens must be an array'); return; }
      const gb = num(seg.gap_before_mm);
      if (seg.gap_before_mm != null && (!Number.isFinite(gb) || gb < 0)) errs.push('slot ' + si + ' segment ' + sgi + ': gap_before_mm must be a non-negative number');
    });
    if (slot.gap_after_mm != null) {
      const ga = num(slot.gap_after_mm);
      if (!Number.isFinite(ga) || ga < 0) errs.push('slot ' + si + ': gap_after_mm must be a non-negative number');
    }
  });
  return errs;
}
