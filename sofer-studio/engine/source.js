// engine/source.js
// Source text processing: import TXT/JSON/paste/Sefaria v3, derive a consonant-only
// working view while preserving the original exactly, parse markers and parsha/sefer
// boundaries, compute a revision hash, keep unusual-letter dots as metadata, and
// count letters/words. Excerpt fixtures and bracketed (ketiv/qere) study text are
// labelled honestly and never certified as a scribal corpus.

import { createHash } from 'node:crypto';
import { stripNekud, countHebrewLetters, segmentGraphemes, isHebrewGrapheme, graphemeBaseLetter } from './text.js';
import { parseStamInput, stamSourceText } from './stam-input.js';

export function computeHash(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

export function splitWords(text) {
  return String(text || '').split(/\s+/u).filter((w) => w.length > 0);
}

// Section markers follow the preceding word, often with no separating space.
// Split only explicit delimited markers, never a word's final letter פ or ס.
// Keep bracketed qere alternatives intact so a marker inside a reading-only
// alternative cannot become a written section break.
export function splitSourceTokens(text) {
  const input = String(text || '');
  if (/[\u0000\ufffd]/u.test(input)) throw new Error('Source text has an encoding error. Re-upload the original UTF-8 or UTF-16 file using the updated import screen.');
  const tokens = [];
  let word = '';
  const flush = () => { if (word) tokens.push(word); word = ''; };
  for (let i = 0; i < input.length;) {
    const ch = input[i];
    if (/[#\[{(]/u.test(ch)) {
      const marker = input.slice(i).match(/^#?(?:\{\s*[פס]\s*\}|\(\s*[פס]\s*\)|\[\s*[פס]\s*\])/u);
      if (marker) {
        flush();
        tokens.push(marker[0].replace(/^#/, ''));
        i += marker[0].length;
        continue;
      }
    }
    if (ch === '[') {
      let depth = 0;
      do {
        const part = input[i++];
        word += part;
        if (part === '[') depth++;
        if (part === ']') depth--;
      } while (i < input.length && depth);
    } else if (/\s/u.test(ch)) {
      flush();
      i++;
    } else {
      word += ch;
      i++;
    }
  }
  flush();
  return tokens;
}

export function sectionBreakSummary(verses) {
  let petucha = 0, setuma = 0;
  for (const verse of verses || []) {
    for (const token of verse.tokens || []) {
      if (token.marker === 'petucha') petucha++;
      if (token.marker === 'setuma') setuma++;
    }
  }
  // Presence is not evidence that all boundaries match a verified tikkun.
  return { petucha, setuma, present: petucha + setuma > 0, verified: false };
}

// The five Chumash books by canonical English key (Hebrew aliases normalized).
var FIVE_BOOKS = { genesis: 1, exodus: 1, leviticus: 1, numbers: 1, deuteronomy: 1 };
var BOOK_KEY_ALIAS = {
  'בראשית': 'genesis',
  'שמות': 'exodus',
  'ויקרא': 'leviticus',
  'במדבר': 'numbers',
  'דברים': 'deuteronomy'
};

// F-29: a source is a partial corpus whenever it is not the complete five-book
// Chumash. Distinct from `excerpt` (an unverified text snippet): a single named
// book (e.g. Genesis alone) is partial_corpus and labelled as such.
export function isPartialCorpus(bookNames, excerpt) {
  if (excerpt) return true;
  var keys = {};
  for (var i = 0; i < (bookNames || []).length; i++) {
    var k = String(bookNames[i] || '').toLowerCase();
    keys[BOOK_KEY_ALIAS[k] || k] = 1;
  }
  for (var want in FIVE_BOOKS) if (!keys[want]) return true;
  return false;
}

function unwrap(raw) {
  return raw.replace(/[{}()\[\]]/g, '').trim();
}

// F-18: strip bracketed (qere) alternatives for the ketiv-only working view.
// The raw original text is preserved verbatim; only layout/measurement uses ketiv.
function ketivOnly(raw) {
  let out = '';
  let depth = 0;
  for (const ch of Array.from(String(raw))) {
    if (ch === '[') { depth += 1; continue; }
    if (ch === ']') { if (depth > 0) depth -= 1; continue; }
    if (depth === 0) out += ch;
  }
  return out.trim();
}

export function classifyToken(raw) {
  if (raw === '{blank-line}') return { kind: 'blank_line' };
  if (/^\{song-[123m]\}$/u.test(raw)) return { kind: 'song_break', break_kind: raw.at(-2) };
  if (raw === '{song-e}') return { kind: 'song_end' };
  const trimmed = unwrap(raw);
  if (trimmed === 'פ') return { kind: 'petucha' };
  if (trimmed === 'ס') return { kind: 'setuma' };
  return { kind: 'word', text: raw };
}

// Combining dots above (U+0307/U+0308) and the standalone puncta-extraordinaria
// dots U+05C4 (upper) and U+05C5 (lower). Detected from RAW source text.
const DOT_UPPER = '\u05C4';
const DOT_LOWER = '\u05C5';
const DOT_ABOVE_A = '\u0307';
const DOT_ABOVE_B = '\u0308';

function isStandaloneDotCp(cp) {
  return cp === 0x05C4 || cp === 0x05C5;
}
function hasCombiningDot(g) {
  return g.includes(DOT_ABOVE_A) || g.includes(DOT_ABOVE_B) || g.includes(DOT_UPPER) || g.includes(DOT_LOWER);
}

// Detect dotted letters in a single RAW word token, recording a stable verse-level
// occurrence_index (0-based count of that base letter across the verse, matching
// buildWordUnits order). `letterCounts` is shared across the whole verse.
function detectWordDots(rawWord, letterCounts, out) {
  const graphemes = segmentGraphemes(rawWord);
  let lastBase = null;
  for (const g of graphemes) {
    const cp = g.codePointAt(0);
    if (isStandaloneDotCp(cp)) {
      if (lastBase != null) {
        out.push({ letter: lastBase, occurrence_index: (letterCounts[lastBase] || 0) - 1, type: 'dotted' });
      }
      continue;
    }
    if (isHebrewGrapheme(g)) {
      const base = graphemeBaseLetter(g);
      letterCounts[base] = (letterCounts[base] || 0) + 1;
      lastBase = base;
      if (hasCombiningDot(g)) {
        out.push({ letter: base, occurrence_index: letterCounts[base] - 1, type: 'dotted' });
      }
    }
  }
}

function safeRef(book, chapter, verse) {
  const b = book || 'unnamed';
  return chapter != null && verse != null ? b + ' ' + chapter + ':' + verse : b;
}

function makeVerse({ book, chapter, verse, text, global, stam = false }) {
  const rawTokens = splitSourceTokens(text);
  const tokens = [];
  const shem_tokens = [];
  const unusual = [];
  const letterCounts = {};
  for (const w of rawTokens) {
    const cls = stam && /^[פס]$/u.test(w) ? { kind: 'word', text: w } : classifyToken(w);
    if (cls.kind !== 'word') {
      tokens.push({ text: w, consonant: w, marker: cls.kind, break_kind: cls.break_kind || null, isShem: false, shem: null });
      continue;
    }
    const ketiv = ketivOnly(w);
    if (!ketiv) continue; // a fully-bracketed token is a qere reading, not written
    // Halachic safety: the program never infers holiness from spelling. Exact
    // holy letters are supplied by a human-authored occurrence overlay only.
    tokens.push({ text: ketiv, consonant: stripNekud(ketiv), marker: null, isShem: false, shem: null, holy_letter_indexes: [] });
    detectWordDots(ketiv, letterCounts, unusual);
  }
  const workingWords = tokens.filter((t) => !t.marker).map((t) => t.text);
  const consonant = stripNekud(workingWords.join(' '));
  return {
    ref: safeRef(book, chapter, verse),
    book, chapter, verse, global,
    text,
    consonant,
    tokens,
    shem_tokens,
    unusual,
    after: null,
  };
}

function assignAfterMarkers(verses) {
  for (const v of verses) {
    let after = null;
    for (let i = v.tokens.length - 1; i >= 0; i--) {
      if (v.tokens[i].marker) { after = v.tokens[i].marker; break; }
    }
    v.after = after;
  }
  return verses;
}

function parseTextLines(text, stam = false) {
  const lines = String(text || '').split(/\r?\n/u).map((l) => l.trim()).filter((l) => l.length);
  const verses = [];
  let global = 0;
  for (const line of lines) {
    verses.push(makeVerse({ book: 'excerpt', chapter: null, verse: null, text: line, global, stam }));
    global += 1;
  }
  assignAfterMarkers(verses);
  return { verses, bookNames: ['excerpt'] };
}

function buildVerses(books) {
  const verses = [];
  const bookNames = [];
  let global = 0;
  for (const book of books) {
    bookNames.push((book && book.name) || 'unnamed');
    const chapters = (book && book.chapters) || [];
    for (let ci = 0; ci < chapters.length; ci++) {
      const chap = chapters[ci];
      const list = Array.isArray(chap) ? chap : (chap.verses || [chap.text]);
      for (let vi = 0; vi < list.length; vi++) {
        const rawText = String(list[vi] || '').trim();
        if (!rawText) continue;
        verses.push(makeVerse({ book: (book && book.name) || 'unnamed', chapter: ci + 1, verse: vi + 1, text: rawText, global }));
        global += 1;
      }
    }
  }
  return { verses, bookNames };
}

function parseJsonStructure(obj) {
  let books = [];
  if (obj && Array.isArray(obj.books)) {
    books = obj.books;
  } else if (obj && Array.isArray(obj.versions)) {
    // Sefaria v3 response: versions[0].text = array of chapters (array of verses).
    const v = obj.versions[0] || {};
    const name = obj.title || obj.book || v.versionTitle || 'sefer';
    const text = v.text;
    books = [{ name, chapters: Array.isArray(text) ? text : [] }];
  } else if (obj && obj.text && typeof obj.text === 'object') {
    const name = obj.title || obj.book || 'sefer';
    if (Array.isArray(obj.text)) {
      books = [{ name, chapters: obj.text }];
    } else {
      books = [{ name, chapters: obj.text[name] || obj.text['he'] || [] }];
    }
  }
  if (!books.length) throw new Error('malformed JSON source: missing "books", "text", or "versions" structure');
  const { verses, bookNames } = buildVerses(books);
  assignAfterMarkers(verses);
  return { verses, bookNames };
}

export function processSource({ name, tradition, text, format = 'txt', label, unusual_letters = [] }) {
  let format_ = String(format || 'txt').toLowerCase();
  // The normal upload/paste entry point sends txt. Do not strip its owner's
  // keyboard annotations as though they were punctuation or foreign words.
  // JSON/Sefaria remain explicit structured imports, never auto-reinterpreted.
  const input = String(text || '');
  if (format_ === 'txt' || format_ === 'auto') {
    const markedHebrew = /[\u05d0-\u05ea]/u.test(input) && /[A-Zpslme123+.!\u2013\u2212]|-(?=[\u05d0-\u05ea])/u.test(input);
    const capitalOnly = /^[A-Z\s-]+$/u.test(input) && /[A-Z]/u.test(input);
    format_ = markedHebrew || capitalOnly || /\.stam(?:\.txt)?$/i.test(name || '') ? 'stam' : 'txt';
  }
  let verses, bookNames;
  let excerpt = false;
  let transport = '';     // exact raw transport string
  let canonical = null;   // complete parsed object (json/sefaria) or null

  if (format_ === 'json' || format_ === 'sefaria') {
    let obj;
    if (typeof text === 'string') {
      transport = text;
      try { obj = JSON.parse(text); }
      catch (e) { throw new Error('malformed JSON source: ' + e.message); }
    } else {
      obj = text;
      transport = JSON.stringify(text);
    }
    canonical = obj;
    const r = parseJsonStructure(obj);
    verses = r.verses; bookNames = r.bookNames;
    excerpt = !bookNames.some((b) => b !== 'excerpt' && b !== 'unnamed');
  } else if (format_ === 'stam') {
    transport = String(text || '');
    const parsed = parseStamInput(transport);
    const r = parseTextLines(stamSourceText(parsed), true);
    verses = r.verses; bookNames = r.bookNames; excerpt = true;
    const wordTokens = verses.flatMap((verse) => verse.tokens.filter((token) => !token.marker));
    parsed.words.forEach((annotation, wordIndex) => {
      const token = wordTokens[wordIndex];
      if (!token) return;
      token.holy_letter_indexes = annotation.holyLetterIndexes.slice();
      token.explicit_shem = token.holy_letter_indexes.length > 0;
      token.isShem = token.explicit_shem;
      if (token.isShem) token.shem = { isShem: true, human_decision: true, explicit: true, source: 'owner-stam-input' };
      token.stam_letter_marks = annotation.letterMarks.slice();
      token.stam_width_marks = annotation.hyphens.map((hyphen) => ({
        letter_index: Math.max(0, Math.min(Array.from(token.consonant).length - 1, hyphen.offset)), count: 1, mode: 'add', type: 'hyphen', source: 'owner-stam-input',
      }));
    });
  } else {
    transport = String(text || '');
    const r = parseTextLines(text);
    verses = r.verses; bookNames = r.bookNames;
    excerpt = true;
  }

  if (!verses.length) throw new Error('source contains no text');

  const original = transport;
  const consonantAll = verses.map((v) => v.consonant).join(' ');

  const letter_count = verses.reduce((s, v) => s + countHebrewLetters(v.consonant), 0);
  const word_count = verses.reduce((s, v) => s + v.tokens.filter((t) => !t.marker).length, 0);
  const verse_count = verses.length;
  const book_count = bookNames.length;

  const revision_hash = computeHash(original);

  // Preserve imported unusual-letter metadata including stable occurrence_index.
  const unusual = unusual_letters.map((u, i) => ({
    occurrence_id: u.occurrence_id || ('ul-' + i + '-' + (u.type || 'unusual')),
    occurrence_index: u.occurrence_index != null ? Number(u.occurrence_index) : null,
    type: u.type || 'large',
    letter: u.letter || null,
    ref: u.ref || null,
    width_override_mm: u.width_override_mm != null ? Number(u.width_override_mm) : null,
  }));

  // Detected dots (from RAW text) — point at real verse occurrences.
  for (const v of verses) {
    for (const d of (v.unusual || [])) {
      unusual.push({
        occurrence_id: 'ul-dot-' + v.ref + ':' + (d.occurrence_index != null ? d.occurrence_index : 0),
        occurrence_index: d.occurrence_index != null ? Number(d.occurrence_index) : 0,
        type: 'dotted',
        letter: d.letter || null,
        ref: v.ref || null,
        width_override_mm: null,
      });
    }
  }

  const warnings = [];
  if (excerpt) warnings.push('excerpt: counts are for this excerpt only, not full-Torah totals');
  if (hasBracketedAlternatives(original)) {
    warnings.push('ketiv/qere: bracketed alternatives detected — working view is ketiv-only (bracketed qere alternatives are excluded from measurement and layout; original preserved verbatim); study text, not a certified scribal corpus');
  }

  return {
    name: name || 'unnamed source',
    tradition: tradition || 'unspecified',
    format: format_,
    label: label || null,
    original,
    canonical,
    consonant: consonantAll,
    revision_hash,
    book_count,
    verse_count,
    letter_count,
    word_count,
    excerpt,
    partial_corpus: isPartialCorpus(bookNames, excerpt),
    has_qere_ketiv: hasBracketedAlternatives(original),
    source_label: excerpt ? 'excerpt (unverified study text)' : (bookNames.join(', ') + ' (study text)'),
    books: bookNames,
    verses,
    unusual_letters: unusual,
    warnings,
  };
}

function hasBracketedAlternatives(text) {
  return /\[(?!\s*[פס]\s*\])[^\]]+\]/u.test(String(text || ''));
}
