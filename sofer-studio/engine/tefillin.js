import { buildWordUnits, buildOverrideMap, measureWord, wordOverrides, makeLine, groupAndAnnotate, deriveGeometry } from './layout.js';
import { interWordGap } from './width.js';

export const TEFILLIN_SECTIONS = [
  { name: 'קדש', book: 'Exodus', chapter: 13, first: 1, last: 10 },
  { name: 'והיה כי יביאך', book: 'Exodus', chapter: 13, first: 11, last: 16 },
  { name: 'שמע', book: 'Deuteronomy', chapter: 6, first: 4, last: 9 },
  { name: 'והיה אם שמוע', book: 'Deuteronomy', chapter: 11, first: 13, last: 21 },
];
export function inTefillinSection(verse, section) {
  return verse.book === section.book && verse.chapter === section.chapter && verse.verse >= section.first && verse.verse <= section.last;
}

// Choose exactly 4/7 non-empty rows, keeping every word in order. Overfull
// words are reported at their real size; no font shrinking or text omission.
export function partitionWords(words, rows, target, gap) {
  if (words.length < rows) throw new Error('This passage has fewer words than the requested number of lines');
  const prefix = [0]; for (const word of words) prefix.push(prefix.at(-1) + word.width_mm);
  const width = (a, b) => prefix[b] - prefix[a] + Math.max(0, b - a - 1) * gap;
  const scores = Array.from({ length: rows + 1 }, () => Array(words.length + 1).fill(Infinity));
  const previous = Array.from({ length: rows + 1 }, () => []); scores[0][0] = 0;
  for (let row = 1; row <= rows; row++) for (let end = row; end <= words.length - rows + row; end++) {
    for (let start = row - 1; start < end; start++) {
      const used = width(start, end), excess = Math.max(0, used - target);
      const cost = scores[row - 1][start] + ((target - used) / target) ** 2 + (excess > .001 ? 1e6 + excess ** 2 : 0);
      if (cost < scores[row][end]) { scores[row][end] = cost; previous[row][end] = start; }
    }
  }
  const output = []; let end = words.length;
  for (let row = rows; row; row--) { const start = previous[row][end]; output.unshift({ items: words.slice(start, end), width: width(start, end) }); end = start; }
  return output;
}

export function computeTefillin(source, profile, geometry) {
  if (!source.tefillin) throw new Error('Load the four Tefillin passages from Book & source before computing Tefillin');
  const rows = geometry.tefillin.kind === 'rosh' ? 4 : 7;
  const { units, verseLetters } = buildWordUnits(source), overrides = buildOverrideMap(source, verseLetters);
  const allWords = units.filter(u => u.type === 'word'); const output = [];
  TEFILLIN_SECTIONS.forEach((section, index) => {
    const refs = new Set(source.verses.filter(v => inTefillinSection(v, section)).map(v => v.ref));
    const words = allWords.filter(w => refs.has(w.verse)).map(word => ({ ...word, width_mm: measureWord(word, profile, overrides), override: wordOverrides(word, overrides, profile) }));
    const target = geometry.tefillin.widths_mm[index];
    for (const [row, part] of partitionWords(words, rows, target, interWordGap(profile)).entries()) {
      const line = makeLine(part.items, part.width, target, profile);
      line.column_width_mm = target; line.tefillin_section = index + 1;
      // Each passage ends on its own page. Keep its end space open.
      line.sefer_end = row === rows - 1; output.push(line);
    }
  });
  const before = allWords.flatMap(w => w.letters.map(l => l.id)), after = output.flatMap(l => l.letter_occurrence_ids);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Tefillin must preserve every source letter in order');
  const g = { ...geometry, lines_per_amud: rows }, grouped = groupAndAnnotate(output, g, { ...profile, vavei_haamudim: false });
  return { ...grouped, geometry: deriveGeometry(g, profile), pattern_blockers: [], yerias: [], summary: {
    total_lines: rows * 4, total_amudim: 4, total_letters: before.length, total_yerios: 1, amudim_per_yeria: 4,
    klaf_length_m: geometry.tefillin.widths_mm.reduce((a, b) => a + b, 0) / 1000,
    is_excerpt: false, study_preview: false, reference_review_required: true,
    tefillin: { ...geometry.tefillin, sections: TEFILLIN_SECTIONS.map(s => s.name) },
    overfull_lines: output.filter(l => l.leftover_mm < -.001).length,
  } };
}
