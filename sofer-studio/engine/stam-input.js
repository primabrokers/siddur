// Owner STAM keyboard format. Only Hebrew letters, spaces and visible hyphens
// survive into the writing view; control characters become typed metadata.
export const STAM_KEYBOARD = Object.freeze({
  Q: '/', W: "'", E: 'ק', R: 'ר', T: 'א', Y: 'ט', U: 'ו', I: 'ן', O: 'ם', P: 'פ',
  A: 'ש', S: 'ד', D: 'ג', F: 'כ', G: 'ע', H: 'י', J: 'ח', K: 'ל', L: 'ך',
  Z: 'ז', X: 'ס', C: 'ב', V: 'ה', B: 'נ', N: 'מ', M: 'צ',
});

export function parseStamInput(raw) {
  const words = [], markers = [];
  let letters = '', holyLetterIndexes = [], hyphens = [], letterMarks = [], pendingMarks = [];
  const flush = () => {
    if (!letters && hyphens.length) { markers.push({ type: '-', count: hyphens.length, after_word: words.length }); hyphens = []; return; }
    if (!letters) return;
    if (pendingMarks.length) throw new Error('STAM modifier is not followed by a Hebrew letter');
    words.push({ text: letters, holyLetterIndexes: holyLetterIndexes.slice(), hyphens: hyphens.slice(), letterMarks: letterMarks.slice() });
    letters = ''; holyLetterIndexes = []; hyphens = []; letterMarks = []; pendingMarks = [];
  };
  const appendLetter = (letter, holy = false) => {
    const letterIndex = Array.from(letters).length;
    letters += letter;
    if (holy) holyLetterIndexes.push(letterIndex);
    for (const mark of pendingMarks) letterMarks.push({ letter_index: letterIndex, ...(typeof mark === 'string' ? { type: mark } : mark) });
    pendingMarks = [];
  };
  const input = Array.from(String(raw || '').replace(/^\ufeff/u, ''));
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (ch === '(') {
      let note = '', depth = 1;
      while (++index < input.length && depth) {
        if (input[index] === '(') depth++;
        if (input[index] === ')') depth--;
        if (depth) note += input[index];
      }
      if (depth) throw new Error('Close the margin note with a parenthesis');
      index--;
      if (!note.trim() || note.length > 2000) throw new Error('Margin notes need 1 to 2000 characters');
      pendingMarks.push({ type: 'margin_note', note: note.trim() }); continue;
    }
    if ('rznfb'.includes(ch)) {
      if (ch === 'r' && input[index + 1] === 'r') { pendingMarks.push('exclusive_stretch'); index++; }
      pendingMarks.push({ r: 'large', z: 'small', n: 'backward', f: 'four_tagin', b: 'broken' }[ch]); continue;
    }
    if (/[\u05d0-\u05ea]/u.test(ch)) { appendLetter(ch); continue; }
    if (/[A-Z]/.test(ch)) {
      const mapped = STAM_KEYBOARD[ch];
      if (!mapped || !/[\u05d0-\u05ea]/u.test(mapped)) throw new Error(`Unsupported capital key ${ch}`);
      appendLetter(mapped, true); continue;
    }
    if (ch === '-' || ch === '\u2013' || ch === '\u2212') {
      hyphens.push({ offset: Array.from(letters).length }); continue;
    }
    if (ch === 'd' || ch === '.') {
      // The full stop is the current dot command; d remains import-compatible.
      pendingMarks.push('dotted'); continue;
    }
    if (ch === '!') { pendingMarks.push('backward_nun'); appendLetter('נ'); continue; }
    if ('psltg123me'.includes(ch)) { flush(); markers.push({ type: ch, after_word: words.length }); continue; }
    if (/\s/u.test(ch)) { flush(); continue; }
    throw new Error(`Unsupported STAM character U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
  flush();
  if (pendingMarks.length) throw new Error('STAM modifier is not followed by a Hebrew letter');
  return { words, markers };
}

export function stamSourceText(parsed) {
  const after = new Map();
  for (const marker of parsed.markers || []) {
    const list = after.get(marker.after_word) || []; list.push(marker); after.set(marker.after_word, list);
  }
  const out = [];
  const addMarkers = index => {
    for (const marker of after.get(index) || []) {
      if (marker.type === 'p') out.push('{פ}');
      else if (marker.type === 's') out.push('{ס}');
      else if (marker.type === 'l') out.push('{blank-line}');
      else if (marker.type === 't') out.push('{page-start}');
      else if (marker.type === 'g') out.push('{custom-gap}');
      else if ('123me'.includes(marker.type)) out.push(`{song-${marker.type}}`);
    }
  };
  addMarkers(0);
  for (let index = 0; index < parsed.words.length; index++) {
    out.push(parsed.words[index].text);
    addMarkers(index + 1);
  }
  return out.join(' ');
}
