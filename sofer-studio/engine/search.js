// engine/search.js
// Verse search: given a verse ref, return amud/line positions.
// Verses spanning multiple lines return a range.
//
// F-05: query is parsed into a structured {bookKey, chapter, verse}; matching is done
// on the stored verse.book / verse.chapter / verse.verse fields — no endsWith text
// matching, so "1:4" can never falsely match "5:4" or a different chapter's verse 4.
// Accepts Arabic numerals, Hebrew gematria (א:ד), and English/Hebrew book names.

const GEMATRIA = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
  'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
  'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90,
};

// Book aliases -> canonical key. English and Hebrew names resolve to the same key.
const BOOK_ALIASES = {
  genesis: 'genesis', breishit: 'genesis', bereshit: 'genesis', 'בראשית': 'genesis',
  exodus: 'exodus', shemot: 'exodus', shemos: 'exodus', 'שמות': 'exodus',
  leviticus: 'leviticus', vayikra: 'leviticus', 'ויקרא': 'leviticus',
  numbers: 'numbers', bamidbar: 'numbers', 'במדבר': 'numbers',
  deuteronomy: 'deuteronomy', devarim: 'deuteronomy', dvarim: 'deuteronomy', 'דברים': 'deuteronomy',
};

export function bookKey(name) {
  const n = String(name || '').trim().toLowerCase();
  if (BOOK_ALIASES[n]) return BOOK_ALIASES[n];
  return n || null;
}

function parseNumber(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  // Hebrew gematria: sum the letter values (e.g. א=1, טו=15, יא=11).
  let sum = 0;
  for (const ch of Array.from(t)) {
    if (GEMATRIA[ch] != null) sum += GEMATRIA[ch];
    else return null; // any non-gematria char -> not a plain number token
  }
  return sum > 0 ? sum : null;
}

// Collapse whitespace and normalize the verse separator. Avoids regex escape
// sequences; queries are single-line so splitting on spaces suffices.
function cleanRef(q) {
  return String(q || '').trim().split(' ').filter((t) => t.length > 0).join(' ').replace(/[׃]/g, ':');
}

// Normalize a ref like "בראשית א:ד", "בראשית 1:4", "Genesis 1:4", "1:4" into
// structured {bookKey, chapter, verse}. Returns null when nothing parseable.
export function parseVerseQuery(q) {
  const s = cleanRef(q);
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 2) return null;
  const verse = parseNumber(parts.length === 2 ? parts[1] : '');
  if (parts.length === 2 && verse == null) return null;

  // Left side: [book] [chapter]. The LAST whitespace token is the chapter number
  // (Arabic or gematria); everything before it is the book name.
  const left = (parts[0] || '').trim();
  const tokens = left.split(' ').filter(Boolean);
  let chapter = null;
  let book = null;
  if (tokens.length === 1) {
    const n = parseNumber(tokens[0]);
    if (n != null) chapter = n;
    else book = bookKey(tokens[0]);
  } else if (tokens.length >= 2) {
    const lastN = parseNumber(tokens[tokens.length - 1]);
    if (lastN != null) {
      chapter = lastN;
      book = bookKey(tokens.slice(0, -1).join(' '));
    } else {
      book = bookKey(tokens.join(' '));
    }
  }
  if (chapter == null && verse == null) return null;
  return { bookKey: book, chapter, verse };
}

export function normalizeRef(q) {
  return cleanRef(q);
}

export function searchVerse(source, layout, query) {
  const parsed = parseVerseQuery(query);
  if (!parsed) return { query: String(query || '').trim(), results: [] };

  const matched = (source.verses || []).filter((v) => {
    if (parsed.bookKey != null && bookKey(v.book) !== parsed.bookKey) return false;
    if (parsed.chapter != null && v.chapter !== parsed.chapter) return false;
    if (parsed.verse != null && v.verse !== parsed.verse) return false;
    return true;
  });

  const results = [];
  for (const v of matched) {
    const lines = layout.lines.filter((l) => (l.verse_refs || []).includes(v.ref));
    if (!lines.length) continue;
    const idxs = lines.map((l) => l.line_index).sort((a, b) => a - b);
    results.push({
      verse_ref: v.ref,
      amud: lines[0].amud,
      line_start: idxs[0],
      line_end: idxs[idxs.length - 1],
      spans_lines: idxs.length > 1,
      lines: idxs,
    });
  }
  return { query: String(query || '').trim(), results };
}
