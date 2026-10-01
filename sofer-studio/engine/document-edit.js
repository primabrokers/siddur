import { moveWord } from './line-edit.js';
import { reflowDocument } from './document-flow.js';
import { fillSongPages, unscaleSongPages } from './song-page-scale.js';
import { groupAndAnnotate, computeYerios, computeLineKey, autoSuggestLine, applyStretch } from './layout.js';
import { measurementUnitMm } from './width.js';
import { validateLayout } from './validate.js';

function editable(layout, from) {
  if (layout.status === 'locked') throw new Error('Locked layouts cannot change. Compute a new draft first.');
  if (layout.lines.slice(from).some(line => line.status && line.status !== 'pending')) throw new Error('Recalculation would change written or checked lines. Compute a new draft first.');
  if (layout.snapshot.geometry.tefillin) throw new Error('Tefillin keeps its fixed passage layout');
  if (layout.snapshot.profile.layout_mode !== 'reflow' && layout.lines.slice(from).some(line => line.reference_page)) throw new Error('Choose reflow mode to change reference page widths');
}

function finish(layout, lines, geometry, warnings = []) {
  const profile = layout.snapshot.profile;
  const before = layout.lines.flatMap(line => line.letter_occurrence_ids);
  const after = lines.flatMap(line => line.letter_occurrence_ids);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Recalculation changed source letter order');
  const grouped = groupAndAnnotate(lines, geometry, profile);
  const yerios = computeYerios(grouped.amudim.length, geometry, profile, grouped.amudim.map(page => page[0].column_width_mm || geometry.line_width_mm));
  return { lines, geometry, changed: lines, summary: { ...layout.summary,
    total_lines: lines.length, total_amudim: grouped.amudim.length, total_yerios: yerios.total_yerios,
    klaf_length_m: yerios.klaf_length_m, partial_final_columns: yerios.partial_final_columns,
    manual_line_breaks: true, flow_warnings: warnings,
    overfull_lines: lines.filter(line => line.leftover_mm < -.001).length,
  }, validation: validateLayout(lines, profile, geometry) };
}

function reflowTail(layout, lines, from, frozenThrough, geometry) {
  editable(layout, frozenThrough == null ? from : frozenThrough);
  const profile = layout.snapshot.profile;
  const frozen = frozenThrough == null ? [] : lines.slice(from, frozenThrough + 1);
  const tail = unscaleSongPages(structuredClone(lines.slice(from)), profile, geometry);
  frozen.forEach((line, index) => { tail[index] = { ...line, manual_line_end: false, fixed_pattern: true }; });
  let segmentWidth = geometry.line_width_mm;
  for (const line of lines.slice(0, from + 1)) if (line.page_start) segmentWidth = geometry.document_flow?.starts?.[line.segment_start_id]?.width_mm || geometry.line_width_mm;
  const flowed = reflowDocument(tail, profile, { ...geometry, line_width_mm: segmentWidth });
  frozen.forEach((line, index) => { flowed.lines[index] = line; });
  fillSongPages(flowed.lines, profile, geometry);
  for (const line of flowed.lines.slice(frozen.length)) {
    if (!line.fixed_pattern) {
      const plan = autoSuggestLine(line, profile);
      if (plan.suggestions.length) applyStretch(line, plan.suggestions, profile);
    }
    line.line_key = computeLineKey(line);
  }
  return finish(layout, [...lines.slice(0, from), ...flowed.lines], geometry, flowed.warnings);
}

export function editWordCount(layout, body) {
  const index = layout.lines.findIndex(line => line.line_id === body.line_id), current = layout.lines[index];
  if (!current) throw new Error('Line not found');
  const target = body.word_count == null ? current.words.length + (body.direction === 'up' ? 1 : body.direction === 'down' ? -1 : NaN) : Number(body.word_count);
  if (!Number.isInteger(target) || target < 0 || target > 1000) throw new Error('Choose between 0 and 1000 words');
  if (body.line_key !== current.line_key || (body.next_line_key || null) !== (layout.lines[index + 1]?.line_key || null)) throw new Error('The line changed. Reload the layout before editing.');
  const changed = structuredClone(layout);
  let result;
  const count = Math.abs(target - current.words.length);
  for (let n = 0; n < count; n++) {
    const line = changed.lines[index], next = changed.lines[index + 1];
    result = moveWord(changed, { line_id: line.line_id, direction: target > current.words.length ? 'up' : 'down', line_key: line.line_key, next_line_key: next?.line_key });
    changed.lines = result.lines; changed.summary = result.summary;
  }
  if (body.reflow === true || body.reflow == null && layout.snapshot.geometry.document_flow?.reflow_word_moves) {
    let from = index; while (from > 0 && layout.lines[from - 1].amud === current.amud) from--;
    return reflowTail(layout, changed.lines, from, index, layout.snapshot.geometry);
  }
  return finish(layout, changed.lines, layout.snapshot.geometry);
}

export function editPageWidth(layout, body) {
  const from = layout.lines.findIndex(line => line.amud === Number(body.amud));
  if (from < 0) throw new Error('Page not found');
  const first = layout.lines[from];
  if (!body.line_key || body.line_key !== first.line_key) throw new Error('The page changed. Reload the layout before editing.');
  const width = Number(body.units) * measurementUnitMm(layout.snapshot.profile);
  if (!(Number.isFinite(width) && width > 0 && width <= 1000)) throw new Error('Page width must be between 0 and 1000 mm');
  const anchor = first.words?.[0]?.letters?.[0]?.id;
  if (!anchor) throw new Error('A blank page has no text to resize');
  const geometry = structuredClone(layout.snapshot.geometry);
  geometry.document_flow ||= {};
  geometry.document_flow.page_widths = { ...geometry.document_flow.page_widths, [anchor]: width };
  return reflowTail(layout, layout.lines, from, null, geometry);
}
