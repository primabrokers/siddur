// Verified annotation overlay generated from the owner's STAM keyboard-format
// Torah. The pinned Tikkun remains the canonical text and paragraph authority;
// this layer adds exact, human-supplied holy-letter and composition marks only.
import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export function applyStamAnnotations(doc, overlay) {
  if (!overlay || overlay.schema !== 'prima-stam-annotations-v2') {
    throw new Error('Missing or unsupported STAM annotation overlay');
  }
  const selected = doc?.canonical?.reference?.selected_book || 'all';
  const selectedBooks = selected === 'all' ? Object.keys(overlay.books) : [selected];
  const tokensByBook = new Map();
  for (const verse of doc.verses || []) {
    const list = tokensByBook.get(verse.book) || [];
    list.push(...(verse.tokens || []).filter((token) => !token.marker));
    tokensByBook.set(verse.book, list);
  }

  let holyLetterCount = 0, holyWordCount = 0, widthCount = 0, letterMarkCount = 0;
  for (const book of selectedBooks) {
    const spec = overlay.books[book];
    const tokens = tokensByBook.get(book) || [];
    if (!spec) throw new Error(`STAM overlay has no ${book} annotations`);
    if (tokens.length !== spec.word_count) throw new Error(`STAM overlay ${book} word count does not match canonical text`);
    if (hash(tokens.map((token) => token.consonant).join(' ')) !== spec.word_sha256) {
      throw new Error(`STAM overlay ${book} text hash does not match canonical text`);
    }
    const holyWords = new Set();
    for (const mark of spec.holy_letter_marks || []) {
      const token = tokens[mark.word_index];
      const letters = Array.from(token?.consonant || '');
      if (!token || letters.join('') !== mark.word || letters[mark.letter_index] !== mark.letter) {
        throw new Error(`STAM holy-letter mark does not match ${book} canonical text`);
      }
      token.holy_letter_indexes ||= [];
      if (!token.holy_letter_indexes.includes(mark.letter_index)) token.holy_letter_indexes.push(mark.letter_index);
      token.explicit_shem = true;
      token.isShem = true;
      token.shem = { isShem: true, human_decision: true, explicit: true, source: overlay.provenance.id };
      holyWords.add(mark.word_index);
      holyLetterCount += 1;
    }
    for (const mark of spec.width_marks) {
      const token = tokens[mark.word_index];
      if (!token) throw new Error(`Invalid STAM width word index for ${book}`);
      const letters = Array.from(token.consonant || '');
      if (letters.join('') !== mark.word || !letters[mark.letter_index]) {
        throw new Error(`STAM width mark does not match ${book} canonical word`);
      }
      token.stam_width_marks ||= [];
      token.stam_width_marks.push({
        letter_index: mark.letter_index,
        count: mark.count,
        mode: mark.mode,
        type: mark.type,
        source: overlay.provenance.id,
      });
      widthCount += 1;
    }
    for (const mark of spec.letter_marks || []) {
      const token = tokens[mark.word_index];
      const letters = Array.from(token?.consonant || '');
      if (!token || letters.join('') !== mark.word || letters[mark.letter_index] !== mark.letter) {
        throw new Error(`STAM letter mark does not match ${book} canonical text`);
      }
      token.stam_letter_marks ||= [];
      token.stam_letter_marks.push({ letter_index: mark.letter_index, type: mark.type, source: overlay.provenance.id });
      letterMarkCount += 1;
    }
    holyWordCount += holyWords.size;
  }

  doc.canonical.reference.stam_annotations = {
    ...overlay.provenance,
    holy_words: holyWordCount,
    holy_letters: holyLetterCount,
    width_marks: widthCount,
    letter_marks: letterMarkCount,
    marker_audit: overlay.marker_audit,
    note: 'Tikkun controls Torah text; the owner-supplied STAM overlay records exact holy letters and composition marks. The program never infers holiness from spelling.',
  };
  const markerMap = new Map();
  for (const marker of overlay.layout_markers || []) {
    if (selected !== 'all' && marker.book !== selected) continue;
    const afterWord = selected === 'all' ? marker.after_word : marker.book_after_word;
    const list = markerMap.get(afterWord) || [];
    list.push(marker); markerMap.set(afterWord, list);
  }
  for (const line of doc.canonical.reference.lines || []) {
    for (let index = 0; index < (line.items || []).length; index++) {
      const item = line.items[index];
      if (item.type !== 'word') continue;
      const markers = markerMap.get(item.word_index + 1) || [];
      for (const marker of markers) {
        if (marker.type === 'p') line.petucha_end = true;
        if (marker.type === 'l') line.blank_after = true;
        if ('123'.includes(marker.type)) {
          const gap = line.items.slice(index + 1).find((candidate) => candidate.type === 'segment_gap');
          if (gap) gap.break_kind = marker.type === '1' ? 'middle' : 'side';
        }
      }
    }
  }
  return doc;
}
