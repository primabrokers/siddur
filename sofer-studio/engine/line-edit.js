import { makeLine, computeLineKey, groupAndAnnotate, computeYerios, autoSuggestLine, applyStretch } from './layout.js';
import { interWordGap } from './width.js';
import { validateLayout } from './validate.js';

// Shift one boundary without reflowing the following text. Explicit paragraph,
// song and written-line boundaries remain protected, including across pages.
export function moveWord(layout, { line_id, direction, line_key, next_line_key }) {
  if (!['up', 'down'].includes(direction)) throw new Error('Choose up or down');
  if (layout.status === 'locked') throw new Error('Locked layouts cannot change line breaks. Compute a new draft first.');
  const lines = layout.lines, index = lines.findIndex(line => line.line_id === line_id);
  if (index < 0) throw new Error('Line not found');
  const current = lines[index], following = lines[index + 1];
  if (!line_key || line_key !== current.line_key || (following?.line_key || null) !== (next_line_key || null)) throw new Error('The line changed. Reload the layout before moving another word.');
  for (const line of [current, following].filter(Boolean)) {
    if (line.status && line.status !== 'pending') throw new Error('Written or checked lines cannot change line breaks');
    if (line.fixed_pattern || line.book_boundary_blank) throw new Error('Song and fixed passage lines keep their assigned words');
  }
  if (current.petucha_end || current.sefer_end) throw new Error('Words cannot be moved across a paragraph or book ending');
  if (direction === 'up' && !following) throw new Error('There is no following line');
  const a = structuredClone(current.items || []), b = structuredClone(following?.items || []);
  if (direction === 'down') {
    if (a.at(-1)?.type !== 'word') throw new Error('The last item must be a word');
    b.unshift(a.pop());
  } else {
    if (b[0]?.type !== 'word') throw new Error('The next line must start with a word');
    if (b.length === 1 && (following.petucha_end || following.sefer_end)) throw new Error('Keep the final word with its paragraph or book ending');
    a.push(b.shift());
  }
  for (const items of [a, b]) {
    if (items[0]?.type === 'setuma_gap' || items.at(-1)?.type === 'setuma_gap') throw new Error('Keep the setumah gap together with its adjacent words');
  }
  const profile = layout.snapshot.profile, geometry = layout.snapshot.geometry;
  const rebuild = (original, items) => {
    let width = 0;
    items.forEach((item, i) => {
      width += Number(item.width_mm) || 0;
      if (i && item.type === 'word' && items[i - 1].type === 'word') width += interWordGap(profile);
    });
    const line = makeLine(items, width, geometry.line_width_mm, profile, { endedBy: original?.petucha_end ? 'petucha' : original?.sefer_end ? 'sefer' : null });
    line.sefer_end = !!original?.sefer_end;
    line.spacing_metadata_complete = true;
    line.line_key = computeLineKey(line);
    if (line.base_leftover_mm >= 0) {
      const plan = autoSuggestLine(line, profile);
      if (plan.suggestions.length) applyStretch(line, plan.suggestions, profile);
    }
    return line;
  };
  const changed = [rebuild(current, a), rebuild(following, b)];
  const output = lines.slice(); output.splice(index, following ? 2 : 1, ...changed);
  groupAndAnnotate(output, geometry, profile);
  const totalAmudim = Math.ceil(output.length / geometry.lines_per_amud);
  const yerios = computeYerios(totalAmudim, geometry, profile);
  const summary = { ...layout.summary, total_lines: output.length, total_amudim: totalAmudim,
    total_yerios: yerios.total_yerios, klaf_length_m: yerios.klaf_length_m,
    partial_final_columns: yerios.partial_final_columns, manual_line_breaks: true,
    overfull_lines: output.filter(line => line.leftover_mm < -0.001).length };
  return { lines: output, changed, summary, validation: validateLayout(output, profile, geometry) };
}
