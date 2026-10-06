import { measurementUnitMm } from './width.js';
import { petuchaGapMm } from './layout.js';

// New wrapping is opt-in on a Klaf. Earlier geometries keep their exact fitter.
export function lineLimits(profile, geometry, width) {
  const rules = geometry.line_measurement;
  if (!rules) return null;
  const ratio = width / geometry.line_width_mm, unit = measurementUnitMm(profile);
  return { recommended: rules.recommended_units * ratio * unit,
    maximum: rules.max_units * ratio * unit, reference: rules.reference_units * ratio,
    stretch: rules.stretch_units * ratio };
}

export function shouldWrap(current, together, limit, rules) {
  if (together > (rules?.maximum ?? limit) + 1e-9) return true;
  return !!rules && Math.abs(together - rules.recommended) > Math.abs(current - rules.recommended) + 1e-9;
}

export function scaleItems(items, factor) {
  return items.map(item => ({ ...item, width_mm: item.width_mm * factor,
    ...(item.override ? { override: item.override.map(value => ({ ...value, mm: value.mm * factor })) } : {}),
    ...(item.letters ? { letters: item.letters.map(letter => ({ ...letter,
      ...(letter.width_mm != null ? { width_mm: letter.width_mm * factor } : {}) })) } : {}) }));
}

// Width fitting never changes the font's height. Only horizontal dimensions,
// including spaces and manual width overrides, share the same scale factor.
export function lineMeasurementProfile(profile, line) {
  const scale = line.line_measurement?.scale ?? 1;
  if (scale === 1 || profile._line_measurement_scale === scale) return profile;
  return { ...profile, _line_measurement_scale: scale,
    unit_mm: profile.unit_mm * scale, stroke_mm: profile.stroke_mm * scale,
    ...(profile.unit_column_width_mm ? { unit_column_width_mm: profile.unit_column_width_mm * scale } : {}),
    gaps: { inter_letter: profile.gaps.inter_letter * scale, inter_word: profile.gaps.inter_word * scale },
    max_stretch: Object.fromEntries(Object.entries(profile.max_stretch || {}).map(([key, value]) => [key, value * scale])) };
}

export function measureFinishedLine(line, profile, geometry, width) {
  const limits = lineLimits(profile, geometry, width);
  if (!limits || line.fixed_pattern || line.blank_line || !line.words.length) return line;
  const units = line.width_mm / measurementUnitMm(profile);
  const intentional = line.petucha_end || line.sefer_end || line.has_setuma;
  const endGap = line.petucha_end ? petuchaGapMm(profile) : 0;
  const naturalWidth = line.width_mm + endGap;
  const uniform = naturalWidth > width + .001 || (!intentional && units > limits.stretch + 1e-6);
  const scale = uniform && naturalWidth > 0 ? width / naturalWidth : 1;
  const fittedWidth = line.width_mm * scale, leftover = width - fittedWidth;
  const items = scale === 1 ? line.items : scaleItems(line.items, scale);
  const words = items.filter(item => item.type === 'word');
  return { ...line, items, words, letters: words.flatMap(word => word.letters),
    width_mm: uniform ? fittedWidth : line.width_mm,
    stretched_width_mm: uniform ? fittedWidth : line.stretched_width_mm,
    base_leftover_mm: uniform ? leftover : line.base_leftover_mm, leftover_mm: uniform ? leftover : line.leftover_mm,
    line_measurement: { original_units: units, reference_units: limits.reference, scale, uniform } };
}
