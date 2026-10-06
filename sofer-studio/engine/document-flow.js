import { makeLine, autoSuggestLine, applyStretch, petuchaGapMm } from './layout.js';
import { interWordGap, measurementUnitMm } from './width.js';
import { composeSongLine } from './song-layout.js';
import { songSettings } from './column-options.js';
import { lineLimits, shouldWrap, scaleItems, measureFinishedLine } from './line-measurement.js';

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
    for (const item of line.line_measurement?.scale && line.line_measurement.scale !== 1 ? scaleItems(line.items, 1 / line.line_measurement.scale) : line.items) {
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
  const rules = lineLimits(profile, geometry, width);
  const flush = flags => { if (items.length) { lines.push(row(items, width, profile, flags)); items = []; } };
  const reserve = index => {
    let reserved = 0;
    while (gapItem(stream[index + 1]) && index + 1 < stop) {
      if (stream[index + 1].type === 'setuma_gap' && profile.parsha_mode === 'rambam') break;
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
    const rambamGap = item.type === 'setuma_gap' && profile.parsha_mode === 'rambam';
    const reserved = rambamGap ? Number(stream[cursor + 1]?.width_mm || 0) : reserve(cursor);
    if (items.length && (!gapItem(item) || rambamGap) && !gapItem(items.at(-1)) && shouldWrap(widthOf(items, profile), widthOf(together, profile) + reserved, width, rules)) {
      flush(); if (lines.length >= maxRows) break;
    }
    if (rules && !items.length && Number(item.width_mm || 0) + reserved > rules.maximum + .001) {
      throw Object.assign(new Error('A whole word or paragraph group exceeds the maximum units per line. Increase the maximum or adjust the Kulmus widths.'), {code:'MAX_LINE_UNITS'});
    }
    items.push(item); cursor++;
  }
  flush(); return { lines, cursor, width };
}

// Pick the narrowest width that can hold these words in the requested rows.
// Keep every row greedily packed, including the last row of a page. Equal word
// widths can skip a row count; do not manufacture short rows just to fill it.
function fillRows(stream, profile, geometry, target, originalWidth) {
  if (stream.some(item => item.type === 'row' || item.type === 'section_start' || item.type === 'width_break')) return null;
  if (stream.filter(item => item.type === 'word').length < target) return null;
  let low = Math.max(.01, ...stream.filter(item => item.type === 'word').map(item => item.width_mm)), high = 1000;
  if (low > high || fit(stream, 0, stream.length, high, profile, geometry).lines.length > target) return null;
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2;
    try {
      if (fit(stream, 0, stream.length, middle, profile, geometry).lines.length > target) low = middle;
      else high = middle;
    } catch(error) { if(error.code!=='MAX_LINE_UNITS')throw error;low=middle; }
  }
  const width = Math.ceil(high * 1000) / 1000;
  const result = fit(stream, 0, stream.length, width, profile, geometry);
  if (!geometry.line_measurement && result.lines.some(line => line.width_mm + (line.petucha_end ? petuchaGapMm(profile) : 0) > width + .001)) return null;
  return { ...result, width, previous_width_mm: originalWidth };
}

// Search integral row-unit widths against cumulative source measurements. Each
// chosen endpoint is a whole-word boundary; the next target uses what remains.
function balancePages(stream, original, profile, geometry, maxRows) {
  if (original.some(page => page.manual_width)) return null;
  const start = original[0].start, end = original.at(-1).end;
  const count = Math.max(1, Math.round(original.reduce((sum, page) => sum + page.lines.length, 0) / maxRows));
  const unit = measurementUnitMm(profile), prefix = [0];
  for (let i = start; i < end; i++) {
    const item = stream[i];
    const width = item.type === 'row' ? widthOf(item.line.items, profile) : Number(item.width_mm) || 0;
    const gap = item.type === 'word' && stream[i - 1]?.type === 'word' ? interWordGap(profile) : 0;
    prefix.push(prefix.at(-1) + width + gap);
  }
  const at = cursor => prefix[cursor - start];
  const pages = []; let cursor = start;
  for (let remaining = count; remaining > 0 && cursor < end; remaining--) {
    const target = at(cursor) + (at(end) - at(cursor)) / remaining;
    const cache = new Map();
    const candidate = units => {
      if (cache.has(units)) return cache.get(units);
      let page;
      try { page = fit(stream, cursor, end, units * unit, profile, geometry, maxRows); }
      catch(error) {
        if(error.code!=='MAX_LINE_UNITS')throw error;
        const invalid={lines:[],cursor,width:units*unit,score:Infinity,units};cache.set(units,invalid);return invalid;
      }
      const mode = geometry.document_flow?.column_start;
      if (remaining > 1 && ['vav', 'hamelech'].includes(mode) && !page.lines.some(line => line.fixed_pattern)) {
        for (let cut = page.cursor - 1; cut > cursor; cut--) {
          const item = stream[cut];
          if (item.type === 'word' && !gapItem(stream[cut - 1]) && !gapItem(stream[cut + 1]) &&
              (mode === 'vav' ? item.consonant?.startsWith('ו') : item.consonant === 'המלך')) {
            page = fit(stream, cursor, cut, units * unit, profile, geometry, maxRows); break;
          }
        }
      }
      const overfull = page.lines.some(line => (!geometry.line_measurement || line.fixed_pattern) && line.width_mm + (line.petucha_end ? petuchaGapMm(profile) : 0) > units * unit + .001);
      const score = overfull || page.cursor <= cursor || (remaining > 1 && page.cursor >= end) ? Infinity : Math.abs(at(page.cursor) - target);
      const result = { ...page, score, units }; cache.set(units, result); return result;
    };
    let low = 1, high = Math.max(1, Math.floor(1000 / unit));
    while (low < high) {
      const middle = Math.floor((low + high) / 2), page = candidate(middle);
      if (at(page.cursor) < target) low = middle + 1; else high = middle;
    }
    // Inspect either side of the endpoint jump. In the final page, choose the
    // narrowest integral width that fits everything without splitting words.
    for (let n = Math.max(1, low - 2); n <= Math.min(Math.floor(1000 / unit), low + 2); n++) candidate(n);
    candidate(Math.max(1, Math.round(original[0].width / unit)));
    const best = [...cache.values()].filter(page => Number.isFinite(page.score) && (remaining !== 1 || page.cursor === end))
      .sort((a, b) => a.score - b.score || a.units - b.units)[0];
    if (!best) return null;
    pages.push({ ...best, start: cursor, end: best.cursor, previous_width_mm: original[0].width }); cursor = best.cursor;
  }
  if (cursor !== end || pages.length !== count) return null;
  if (original[0].lines[0]?.page_start) {
    pages[0].lines[0].page_start = true; pages[0].lines[0].segment_start_id = original[0].lines[0].segment_start_id;
  }
  return pages;
}

export function reflowDocument(lines, profile, geometry, options = {}) {
  const settings = geometry.document_flow || {}, maxRows = Math.max(1, Number(geometry.lines_per_amud));
  const stream = measuredStream(lines, settings.page_widths), pages = [], warnings = [];
  let cursor = 0, sectionWidth = geometry.line_width_mm, sectionStart = null, segmentPages = [];
  const finishSegment = () => {
    if (settings.balance_segments && segmentPages.length) {
      const balanced = balancePages(stream, segmentPages, profile, geometry, maxRows);
      if (balanced) segmentPages = balanced;
      else warnings.push('This segment keeps its existing widths because fixed rows, page-width edits or paragraph gaps prevent balanced whole-word pages.');
    }
    const last = segmentPages.at(-1);
    if (!settings.balance_segments && last && !last.manual_width && last.lines.length < maxRows && (settings.fit_last_page || settings.fit_boundary_page)) {
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
  const output = pages.flatMap((page, index) => page.lines.map((line, rowIndex) => ({ ...measureFinishedLine(line, profile, geometry, page.width),
    flow_page_start: rowIndex === 0, column_width_mm: page.width,
    ...(rowIndex === 0 && page.previous_width_mm ? { page_fit: { previous_width_mm: page.previous_width_mm, width_mm: page.width } } : {}),
  })));
  const ids = rows => rows.flatMap(line => line.words.flatMap(word => word.letters.map(letter => letter.id)));
  if (JSON.stringify(ids(lines)) !== JSON.stringify(ids(output))) throw new Error('Document reflow changed source letter order');
  return { lines: output, warnings: [...new Set(warnings)] };
}
