import { makeLine, autoSuggestLine, applyStretch } from './layout.js';
import { interWordGap, measurementUnitMm } from './width.js';
import { songSettings } from './column-options.js';

// All positions are physical millimetres from the RIGHT edge. Measurement
// units come from the document profile, never from the wider song column.
export function composeSongLine(items, profile, geometry, kind = 'hayam') {
  const config = songSettings(geometry, kind), total = config.total_mm;
  const groups = [[]];
  for (const item of items) {
    if (item.type === 'segment_gap') groups.push([]);
    else groups.at(-1).push(item);
  }
  if (![1, 2, 3].includes(groups.length) || groups.some(g => !g.length)) throw new Error('A song row needs non-empty parts');
  if (kind === 'haazinu' && groups.length !== 2) throw new Error('Haazinu rows need two parts and one m break');
  const gap = interWordGap(profile), unit = measurementUnitMm(profile);
  const middle = total - config.right_mm - config.left_mm;
  const segments = [], decisions = []; let wordIndex = 0;
  let minimumStart = 0, maximumEnd = total;
  groups.forEach((group, index) => {
    const width = group.reduce((n, item, i) => n + Number(item.width_mm || 0) + (i && item.type === 'word' && group[i - 1].type === 'word' ? gap : 0), 0);
    const three = groups.length === 3;
    const target = groups.length === 1 ? total : three && index === 1 ? middle + 4 * unit : index === 0 ? config.right_mm : config.left_mm;
    const segment = makeLine(group, width, target, profile);
    if (!three || index === 1) {
      const plan = autoSuggestLine(segment, profile);
      if (plan.suggestions.length) applyStretch(segment, plan.suggestions, profile);
    }
    const rendered = segment.stretched_width_mm ?? width;
    const start = three ? (index === 0 ? 0 : index === 1 ? config.right_mm + (middle - rendered) / 2 : total - rendered)
      : index === 0 ? 0 : total - rendered;
    minimumStart = Math.min(minimumStart, start); maximumEnd = Math.max(maximumEnd, start + rendered);
    segments.push({ start_mm: start, width_mm: rendered, target_mm: target, base_width_mm: width,
      word_start: wordIndex, word_count: segment.words.length, shortfall_mm: Math.max(0, target - rendered),
      stretch: !three || index === 1 });
    for (const decision of segment.stretch_decisions) {
      const id = decision.letter_occurrence_id;
      decisions.push({ ...decision, letter_occurrence_id: id.startsWith('word-space-before-') ? 'word-space-before-' + (wordIndex + Number(id.slice('word-space-before-'.length))) : id });
    }
    wordIndex += segment.words.length;
  });
  const line = makeLine(items.map(item => item.type === 'segment_gap' ? { ...item, width_mm: 0 } : item), total, total, profile);
  line.column_width_mm = total;
  const overlap = segments.slice(1).reduce((max, segment, index) => Math.max(max, segments[index].start_mm + segments[index].width_mm - segment.start_mm), 0);
  line.song_layout = { kind, total_mm: total, segments, overlap_mm: overlap };
  line.fixed_pattern = true;
  line.stretch_decisions = decisions;
  line.base_leftover_mm = line.leftover_mm = -Math.max(-minimumStart, maximumEnd - total, overlap) || 0;
  line.stretched_width_mm = total - line.leftover_mm;
  return line;
}
