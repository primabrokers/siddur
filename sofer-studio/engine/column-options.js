// Optional geometry settings. Old geometry rows and saved snapshots stay intact.
import { documentOptionsErrors } from './document-options.js';
export const SONG_DEFAULTS = Object.freeze({
  hayam: { total_mm: 180, right_mm: 60, left_mm: 60 },
  haazinu: { total_mm: 170, right_mm: 170 / 3, left_mm: 170 / 3 },
});
export function songSettings(geometry, kind = 'hayam') {
  return { ...SONG_DEFAULTS[kind], ...geometry.song_layouts?.[kind] };
}
export function columnOptionsErrors(input) {
  const errors = documentOptionsErrors(input);
  if (input.parsha_mode != null && !['rambam', 'rambam_rosh'].includes(input.parsha_mode)) errors.push('Choose Rambam only or Rambam and Rosh');
  if (input.line_measurement != null) {
    const rules = input.line_measurement;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) errors.push('Line measurements must be an object');
    else {
      for (const key of ['reference_units', 'recommended_units', 'max_units', 'stretch_units']) {
        if (!Number.isFinite(rules[key]) || rules[key] <= 0 || rules[key] > 10000) errors.push(key + ' must be greater than zero and at most 10000');
      }
      if (rules.recommended_units > rules.max_units) errors.push('Recommended units cannot exceed maximum units');
    }
  }
  if (input.song_layouts != null) {
    const songs = input.song_layouts;
    if (!songs || typeof songs !== 'object' || Array.isArray(songs)) return ['Song settings must be an object'];
    if (songs.manual != null && !['hayam', 'haazinu'].includes(songs.manual)) errors.push('Choose Hayam or Haazinu for imported song rows');
    for (const kind of ['hayam', 'haazinu']) {
      const s = songSettings(input, kind);
      for (const key of ['total_mm', 'right_mm', 'left_mm']) if (!(Number.isFinite(s[key]) && s[key] > 0 && s[key] <= 1000)) errors.push(kind + ' ' + key + ' must be between 0 and 1000 mm');
      if (s.right_mm + s.left_mm >= s.total_mm) errors.push(kind + ': right and left columns must leave a middle space');
    }
  }
  if (input.tefillin != null) {
    const t = input.tefillin;
    if (!t || !['rosh', 'yad'].includes(t.kind)) errors.push('Choose rosh or yad Tefillin');
    if (!Array.isArray(t?.widths_mm) || t.widths_mm.length !== 4 || t.widths_mm.some(w => !Number.isFinite(w) || w <= 0 || w > 1000)) errors.push('Enter four positive Tefillin page widths, up to 1000 mm');
    if (t?.paper != null && !['A4', 'A3'].includes(t.paper)) errors.push('Choose A4 or A3 paper');
  }
  return errors;
}
export function copyColumnOptions(input) {
  return {
    ...(input.parsha_mode ? { parsha_mode: input.parsha_mode } : {}),
    ...(input.line_measurement ? { line_measurement: structuredClone(input.line_measurement) } : {}),
    ...(input.song_layouts ? { song_layouts: structuredClone(input.song_layouts) } : {}),
    ...(input.tefillin ? { tefillin: structuredClone(input.tefillin) } : {}),
    ...(input.document_flow ? { document_flow: structuredClone(input.document_flow) } : {}),
    ...(input.initial_margin_mm != null ? { initial_margin_mm: input.initial_margin_mm } : {}),
    ...(input.final_margin_mm != null ? { final_margin_mm: input.final_margin_mm } : {}),
  };
}
