import { makeLine, autoSuggestLine, applyStretch, petuchaGapMm } from './layout.js';
import { interWordGap } from './width.js';

// An e ends a complete, justified row. Freeze its word membership only AFTER
// stretching, so the ordinary fixed-passage guard cannot skip justification.
function explicitRow(line, width, profile) {
  if (line.blank_line) return { ...makeLine([], 0, width, profile), blank_line: true };
  if (!line.manual_line_end || line.song_layout) return line;
  const result = makeLine(line.items, line.width_mm, width, profile);
  const plan = autoSuggestLine(result, profile);
  if (plan.suggestions.length) applyStretch(result, plan.suggestions, profile);
  result.manual_line_end = true;
  result.fixed_pattern = true;
  return result;
}

// Reuse measured words/occurrence IDs: widening a song page must increase its
// word capacity, never change the document's unit size or letter measurements.
// Yield one page at a time so asynchronous full-book computes remain responsive.
export function* fitManualSongPages(lines, profile, geometry) {
  const normalWidth = Number(geometry.line_width_mm);
  if (!lines.some(line => line.song_layout)) {
    for (let start = 0; start < lines.length; start += 42) {
      yield lines.slice(start, start + 42).map(line => explicitRow(line, normalWidth, profile));
    }
    return;
  }
  const stream = [];
  for (const line of lines) {
    if (line.blank_line || line.fixed_pattern) stream.push({ type: 'row', line });
    else {
      stream.push(...line.items);
      if (line.petucha_end || line.sefer_end) stream.push({ type: line.petucha_end ? 'petucha' : 'sefer' });
    }
  }
  const perPage = Math.max(1, Number(geometry.lines_per_amud) || 42);
  const gap = interWordGap(profile), modern = profile.stretch_policy?.version === 2;
  function reserve(index) {
    if (!modern) return 0;
    let width = 0;
    while (stream[index + 1]?.type === 'setuma_gap') {
      width += stream[index + 1].width_mm;
      if (stream[index + 2]?.type !== 'word') return width;
      width += stream[index + 2].width_mm;
      index += 2;
    }
    return width + (stream[index + 1]?.type === 'petucha' ? petuchaGapMm(profile) : 0);
  }
  function pageFrom(start, width) {
    const page = [];
    let cursor = start, items = [], used = 0;
    function flush(flags = {}) {
      if (!items.length) return;
      page.push(makeLine(items, used, width, profile, flags));
      items = []; used = 0;
    }
    while (cursor < stream.length && page.length < perPage) {
      const item = stream[cursor];
      if (item.type === 'row') {
        flush();
        if (page.length === perPage) break;
        page.push(explicitRow(item.line, width, profile));
        cursor++;
      } else if (item.type === 'petucha' || item.type === 'sefer') {
        flush({ endedBy: item.type });
        cursor++;
      } else {
        const previous = items.at(-1);
        const add = item.width_mm + (previous?.type === 'word' && item.type === 'word' ? gap : 0);
        const joined = modern && (item.type === 'setuma_gap' || previous?.type === 'setuma_gap');
        if (items.length && !joined && used + add + reserve(cursor) > width + 1e-9) {
          flush();
          if (page.length === perPage) break;
        }
        used += item.width_mm + (items.at(-1)?.type === 'word' && item.type === 'word' ? gap : 0);
        items.push(item);
        cursor++;
      }
    }
    flush();
    return { page, cursor };
  }
  let cursor = 0;
  while (cursor < stream.length) {
    let candidate = pageFrom(cursor, normalWidth);
    const songWidth = Math.max(0, ...candidate.page.filter(line => line.song_layout).map(line => line.column_width_mm));
    if (songWidth) {
      candidate = pageFrom(cursor, songWidth);
      candidate.page = candidate.page.map(line => ({ ...line, column_width_mm: songWidth }));
    }
    if (candidate.cursor <= cursor) throw new Error('Song page fitting did not advance');
    cursor = candidate.cursor;
    yield candidate.page;
  }
}
