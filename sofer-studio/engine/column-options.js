// Optional geometry settings. Old geometry rows and saved snapshots stay intact.
export const SONG_DEFAULTS = Object.freeze({
  hayam: { total_mm: 180, right_mm: 60, left_mm: 60 },
  haazinu: { total_mm: 170, right_mm: 170 / 3, left_mm: 170 / 3 },
});
export function songSettings(geometry, kind = 'hayam') {
  return { ...SONG_DEFAULTS[kind], ...geometry.song_layouts?.[kind] };
}
export function columnOptionsErrors(input) {
  const errors = [];
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
    ...(input.song_layouts ? { song_layouts: structuredClone(input.song_layouts) } : {}),
    ...(input.tefillin ? { tefillin: structuredClone(input.tefillin) } : {}),
  };
}
