import { parseStamInput } from './stam-input.js';

// Preserve the existing letter-width markers. Internal hyphens already live
// inside one indivisible word; boundary hyphens also bind the adjacent words.
// Metadata is derived in memory, including for sources imported before v26.
export function hyphenMetadata(source) {
  const tokens = (source.verses || []).flatMap(v => v.tokens || []);
  const words = tokens.filter(t => !t.marker), meta = new Map(words.map(t => [t, {}]));
  const positions = new Map(tokens.map((token, index) => [token, index]));
  const clean = text => String(text || '').replace(/[^א-ת]/gu, '');
  const note = (token, left, right) => {
    if (!left || !right) return;
    const m = meta.get(token); m.hyphen_notes ||= [];
    const text = left + ' ' + right + ' בחד שיטה';
    if (!m.hyphen_notes.includes(text)) m.hyphen_notes.push(text);
  };
  const join = (left, right) => {
    if (!left || !right || left.marker || right.marker) return;
    if (tokens.slice(positions.get(left) + 1, positions.get(right)).some(t => t.marker || !/^[-־–−]+$/u.test(t.text))) return;
    meta.get(left).keep_with_next = true; meta.get(right).keep_with_previous = true;
    note(left, clean(left.text), clean(right.text));
  };
  const boundaries = (token, offsets) => {
    if (!offsets.length) return;
    const letters = Array.from(clean(token.text)), pos = positions.get(token);
    const internal = [...new Set(offsets.filter(n => n > 0 && n < letters.length))].sort((a, b) => a - b);
    internal.forEach((at, i) => note(token, letters.slice(internal[i - 1] || 0, at).join(''), letters.slice(at, internal[i + 1] || letters.length).join('')));
    if (offsets.includes(0)) join(tokens[pos - 1], token);
    if (offsets.some(n => n >= letters.length)) join(token, tokens[pos + 1]);
  };
  tokens.forEach((token, i) => {
    if (token.marker) return;
    if (/^[-־–−]+$/u.test(token.text)) {
      join(tokens[i - 1], tokens[i + 1]); meta.get(token).hyphen_separator = true;
      if (meta.get(tokens[i - 1])) meta.get(tokens[i - 1]).display_hyphen_after = [clean(tokens[i - 1].text).length - 1];
      return;
    }
    const parts = String(token.text).split(/[-־–−]+/u);
    if (parts.length > 1) {
      const offsets = []; let n = 0;
      parts.slice(0, -1).forEach(part => { n += clean(part).length; offsets.push(n); });
      meta.get(token).display_hyphen_after = offsets.map(n => Math.max(0, n - 1));
      boundaries(token, offsets);
    }
  });
  if (source.format === 'stam' && source.original && /[-–−]/u.test(source.original)) {
    const parsed = parseStamInput(source.original);
    // Exact matching avoids applying controls to a different historical parser's words.
    if (parsed.words.length === words.length && parsed.words.every((w, i) => w.text === words[i].text)) {
      parsed.words.forEach((w, i) => boundaries(words[i], w.hyphens.map(h => h.offset)));
      parsed.markers.filter(m => m.type === '-').forEach(m => {
        const left = words[m.after_word - 1]; join(left, words[m.after_word]);
        if (left) meta.get(left).display_hyphen_after = [clean(left.text).length - 1];
      });
    }
  }
  return meta;
}

export function joinedEnd(items, index) {
  while (items[index]?.keep_with_next && items[index + 1]?.type === 'word') index++;
  return index;
}
