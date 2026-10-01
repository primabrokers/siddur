import { makeLine, autoSuggestLine, applyStretch, petuchaGapMm } from './layout.js';
import { interWordGap } from './width.js';
import { composeSongLine } from './song-layout.js';
import { songSettings } from './column-options.js';

const gapItem = item => ['setuma_gap', 'custom_gap'].includes(item?.type);
const firstId = line => line.words?.[0]?.letters?.[0]?.id;
const widthOf = (items, profile) => items.reduce((sum, item, index) => sum + item.width_mm +
  (index && item.type === 'word' && items[index - 1].type === 'word' ? interWordGap(profile) : 0), 0);

// Preserve measured occurrence IDs and semantic boundaries, discarding only
// ordinary wrapping. Stored snapshots are never mutated by reflow.
export function measuredStream(lines, overrides = {}) {
  const stream = [];
  for (const line of lines) {
    if (line.page_start) stream.push({ type: 'section_start', marker_id: line.segment_start_id });
    if (line.blank_line || line.book_boundary_blank || line.song_layout || (line.fixed_pattern && !line.manual_line_end)) {
      if (overrides[firstId(line)]) stream.push({ type: 'width_break', width_mm: overrides[firstId(line)] });
      stream.push({ type: 'row', line }); continue;
    }
    for (const item of line.items) {
      const override = item.type === 'word' && overrides[item.letters?.[0]?.id];
      if (override) stream.push({ type: 'width_break', width_mm: override });
      stream.push(item);
    }
    if (line.manual_line_end) stream.push({ type: 'line_end' });
    if (line.petucha_end || line.sefer_end) stream.push({ type: 'end', petucha: !!line.petucha_end, sefer: !!line.sefer_end });
  }
  return stream;
}

function row(items, width, profile, end = {}) {
  const result = makeLine(items, widthOf(items, profile), width, profile, { endedBy: end.petucha ? 'petucha' : end.sefer ? 'sefer' : null });
  result.sefer_end = !!end.sefer; result.column_width_mm = width;
  if (end.explicit) {
    const plan = autoSuggestLine(result, profile);
    if (plan.suggestions.length) applyStretch(result, plan.suggestions, profile);
    result.manual_line_end = true; result.fixed_pattern = true;
  }
  return result;
}

function fit(stream, start, stop, width, profile, geometry, maxRows = Infinity, resizeSongs = false) {
  const lines = []; let cursor = start, items = [];
  const flush = flags => { if (items.length) { lines.push(row(items, width, profile, flags)); items = []; } };
  const reserve = index => {
    let reserved = 0;
    while (gapItem(stream[index + 1]) && index + 1 < stop) {
      reserved += stream[index + 1].width_mm;
      if (stream[index + 2]?.type !== 'word' || index + 2 >= stop) return reserved;
      reserved += stream[index + 2].width_mm; index += 2;
    }
    return reserved + (stream[index + 1]?.petucha ? petuchaGapMm(profile) : 0);
  };
  while (cursor < stop && lines.length < maxRows) {
    const item = stream[cursor];
    if (item.type === 'section_start' || item.type === 'width_break') break;
    if (item.type === 'row') {
      flush(); if (lines.length >= maxRows) break;
      let fixed = { ...item.line };
      if (resizeSongs && fixed.song_layout) {
        const kind = fixed.song_layout.kind, config = songSettings(geometry, kind), ratio = width / config.total_mm;
        fixed = { ...fixed, ...composeSongLine(fixed.items, profile, { ...geometry, song_layouts: {
          ...geometry.song_layouts, [kind]: { total_mm: width, right_mm: config.right_mm * ratio, left_mm: config.left_mm * ratio },
        } }, kind) };
      }
      fixed.column_width_mm = fixed.song_layout?.total_mm || width; lines.push(fixed); cursor++; continue;
    }
    if (item.type === 'line_end' || item.type === 'end') { flush({ ...item, explicit: item.type === 'line_end' }); cursor++; continue; }
    const together = [...items, item];
    if (items.length && !gapItem(item) && !gapItem(items.at(-1)) && widthOf(together, profile) + reserve(cursor) > width + 1e-9) {
      flush(); if (lines.length >= maxRows) break;
    }
    items.push(item); cursor++;
  }
  flush(); return { lines, cursor, width };
}

// Pick the narrowest width that can hold these words in the requested rows.
// Where equal word widths skip a row count, split an ordinary row at a safe
// word boundary; never split a fixed song, paragraph gap or individual word.
function fillRows(stream, profile, geometry, target, originalWidth) {
  if (stream.some(item => item.type === 'row' || item.type === 'section_start' || item.type === 'width_break')) return null;
  if (stream.filter(item => item.type === 'word').length < target) return null;
  let low = Math.max(.01, ...stream.filter(item => item.type === 'word').map(item => item.width_mm)), high = 1000;
  if (low > high || fit(stream, 0, stream.length, high, profile, geometry).lines.length > target) return null;
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2;
    if (fit(stream, 0, stream.length, middle, profile, geometry).lines.length > target) low = middle;
    else high = middle;
  }
  const width = Math.ceil(high * 1000) / 1000;
  const result = fit(stream, 0, stream.length, width, profile, geometry);
  while (result.lines.length < target) {
    const candidates = result.lines.map((line, index) => ({ line, index })).sort((a, b) => b.line.words.length - a.line.words.length);
    let split = false;
    for (const { line, index } of candidates) {
      if (line.song_layout || line.blank_line) continue;
      const cuts = line.items.map((item, i) => i).filter(i => i > 0 && line.items[i].type === 'word' && line.items[i - 1].type === 'word');
      if (!cuts.length) continue;
      const cut = cuts.reduce((a, b) => Math.abs(a - line.items.length / 2) < Math.abs(b - line.items.length / 2) ? a : b);
      result.lines.splice(index, 1, row(line.items.slice(0, cut), width, profile),
        row(line.items.slice(cut), width, profile, { explicit: line.manual_line_end, petucha: line.petucha_end, sefer: line.sefer_end }));
      split = true; break;
    }
    if (!split) return null;
  }
  if (result.lines.some(line => line.width_mm + (line.petucha_end ? petuchaGapMm(profile) : 0) > width + .001)) return null;
  return { ...result, width, previous_width_mm: originalWidth };
}

export function reflowDocument(lines, profile, geometry, options = {}) {
  const settings = geometry.document_flow || {}, maxRows = Math.max(1, Number(geometry.lines_per_amud));
  const stream = measuredStream(lines, settings.page_widths), pages = [], warnings = [];
  let cursor = 0, sectionWidth = geometry.line_width_mm, sectionStart = null, segmentPages = [];
  const finishSegment = () => {
    const last = segmentPages.at(-1);
    if (last && !last.manual_width && last.lines.length < maxRows && (settings.fit_last_page || settings.fit_boundary_page)) {
      const merge = settings.fit_last_page && last.lines.length / maxRows < .5 && segmentPages.length > 1 && !segmentPages.at(-2).manual_width;
      const first = merge ? segmentPages.at(-2) : last;
      const fitted = fillRows(stream.slice(first.start, last.end), profile, geometry, maxRows, first.width);
      if (fitted) {
        if (first.lines[0]?.page_start) { fitted.lines[0].page_start = true; fitted.lines[0].segment_start_id = first.lines[0].segment_start_id; }
        segmentPages.splice(merge ? -2 : -1, merge ? 2 : 1, { ...first, ...fitted, end: last.end });
      } else if (!last.lines.some(line => line.song_layout)) warnings.push('This segment cannot fill a full page without changing its explicit line endings or fixed passages.');
    }
    pages.push(...segmentPages); segmentPages = [];
  };
  while (cursor < stream.length) {
    if (stream[cursor].type === 'section_start') {
      finishSegment(); sectionStart = stream[cursor].marker_id || true;
      sectionWidth = settings.starts?.[sectionStart]?.width_mm || geometry.line_width_mm; cursor++; continue;
    }
    let width = sectionWidth, manual = false;
    if (stream[cursor].type === 'width_break') { width = stream[cursor++].width_mm; manual = true; }
    if (cursor >= stream.length) break;
    const start = cursor;
    let page = fit(stream, start, stream.length, width, profile, geometry, maxRows, manual);
    const songWidth = Math.max(0, ...page.lines.filter(line => line.song_layout).map(line => line.song_layout.total_mm));
    if (songWidth && !manual) { width = songWidth; page = fit(stream, start, stream.length, width, profile, geometry, maxRows); }
    let nextContent = false;
    for (let i = page.cursor; i < stream.length && !['section_start', 'width_break'].includes(stream[i].type); i++) {
      if (stream[i].type === 'word' || stream[i].type === 'row') { nextContent = true; break; }
    }
    if (nextContent && ['vav', 'hamelech'].includes(settings.column_start) && !page.lines.some(line => line.fixed_pattern)) {
      let cut = -1;
      for (let i = page.cursor - 1; i > start; i--) {
        const item = stream[i];
        if (item.type !== 'word' || gapItem(stream[i - 1]) || gapItem(stream[i + 1])) continue;
        if (settings.column_start === 'vav' ? item.consonant?.startsWith('ו') : item.consonant === 'המלך') { cut = i; break; }
      }
      if (cut > start) {
        page = fit(stream, start, cut, width, profile, geometry); page.cursor = cut;
        if (settings.fit_boundary_page) {
          const filled = fillRows(stream.slice(start, cut), profile, geometry, maxRows, width);
          if (filled) page = { ...filled, cursor: cut }; else warnings.push('A column-start boundary has too little text or fixed spacing to fill every line.');
        }
      }
    }
    if (page.cursor <= start) {
      // A boundary immediately after another boundary has no content to print.
      if (['section_start', 'width_break'].includes(stream[start]?.type)) continue;
      throw new Error('Document reflow did not advance');
    }
    cursor = page.cursor;
    if (!page.lines.length) continue;
    if (sectionStart) { page.lines[0].page_start = true; page.lines[0].segment_start_id = sectionStart; sectionStart = null; }
    segmentPages.push({ ...page, start, end: cursor, manual_width: manual });
  }
  finishSegment();
  const output = pages.flatMap((page, index) => page.lines.map((line, rowIndex) => ({ ...line,
    flow_page_start: rowIndex === 0, column_width_mm: page.width,
    ...(rowIndex === 0 && page.previous_width_mm ? { page_fit: { previous_width_mm: page.previous_width_mm, width_mm: page.width } } : {}),
  })));
  const ids = rows => rows.flatMap(line => line.words.flatMap(word => word.letters.map(letter => letter.id)));
  if (JSON.stringify(ids(lines)) !== JSON.stringify(ids(output))) throw new Error('Document reflow changed source letter order');
  return { lines: output, warnings: [...new Set(warnings)] };
}
