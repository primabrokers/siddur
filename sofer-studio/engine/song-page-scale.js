import { composeSongLine } from './song-layout.js';

// A page-local measurement profile. Keep the saved document calibration intact;
// enlarged letters and spaces consume more of its original physical units.
export function songPageProfile(profile, scale = 1) {
  if (!profile || !(scale > 1)) return profile;
  return {
    ...profile,
    unit_mm: profile.unit_mm * scale,
    letter_height_mm: profile.letter_height_mm * scale,
    reference_height_mm: profile.reference_height_mm * scale,
    stroke_mm: profile.stroke_mm * scale,
    ...(profile.unit_column_width_mm ? { unit_column_width_mm: profile.unit_column_width_mm * scale } : {}),
    ...(profile.average_unit_mm ? { average_unit_mm: profile.average_unit_mm * scale } : {}),
    gaps: { ...profile.gaps, inter_letter: profile.gaps.inter_letter * scale, inter_word: profile.gaps.inter_word * scale },
    max_stretch: Object.fromEntries(Object.entries(profile.max_stretch || {}).map(([letter, mm]) => [letter, mm * scale])),
  };
}

// Only a short page made entirely of explicit song rows fills the normal ruling
// height. A full-width e row can be the song's opening/closing row, but e alone
// never classifies prose as a song. Blank and ordinary rows keep mixed pages at
// their original size. Page membership, word order and physical width stay fixed.
export function fillSongPages(lines, profile, geometry) {
  const perPage = Math.max(1, Number(geometry.lines_per_amud) || 42);
  for (let start = 0; start < lines.length; start += perPage) {
    const page = lines.slice(start, start + perPage);
    if (page.length >= perPage || geometry.tefillin) continue;
    const song = page.find(line => line.song_layout);
    if (!song || !page.every(line => line.song_layout ||
      (song.song_layout.kind === 'hayam' && line.manual_line_end && line.words.length && !line.has_setuma))) continue;
    const scale = perPage / page.length;
    const scaled = songPageProfile(profile, scale);
    const metrics = { scale, lines: page.length, baseline_pitch_mm: geometry.baseline_pitch_mm * scale,
      letter_height_mm: profile.letter_height_mm * scale };
    page.forEach((line, index) => {
      const items = line.items.map(item => ({ ...item, width_mm: item.width_mm * scale,
        ...(item.override ? { override: item.override.map(value => ({ ...value, mm: value.mm * scale })) } : {}) }));
      // Rejustify each enlarged segment inside the existing song column. Scaling
      // already-justified coordinates would incorrectly enlarge the whole page.
      const enlarged = composeSongLine(items, scaled, geometry, line.song_layout?.kind || song.song_layout.kind);
      lines[start + index] = { ...line, ...enlarged, petucha_end: line.petucha_end, sefer_end: line.sefer_end,
        line_key: undefined, song_page: { ...metrics } };
    });
  }
  return lines;
}
