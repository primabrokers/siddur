// server/builtin.js
// Loader for the pinned Sefaria v3 study-text corpus under
// docs/sofer-studio/source-data/. These are consonantal STUDY text, labelled
// honestly as study text — never a certified sofer corpus.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = fileURLToPath(new URL('../../docs/sofer-studio/source-data/', import.meta.url));

const BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
const HEBREW_NAMES = {
  Genesis: 'בראשית', Exodus: 'שמות', Leviticus: 'ויקרא', Numbers: 'במדבר', Deuteronomy: 'דברים',
};

export function listBuiltinSources() {
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(SOURCE_DIR + 'manifest.json', 'utf8')); } catch (e) { manifest = null; }
  const versions = (manifest && manifest.versions) || [];
  const books = BOOKS.map((book) => {
    const v = versions.find((x) => x.book === book) || {};
    return {
      book,
      name: HEBREW_NAMES[book],
      verse_count: v.verseCount || null,
      letter_count: v.letterCount || null,
      sha256: v.sha256 || null,
      version: v.versionTitle || 'Tanach with Text Only (study text)',
    };
  });
  // F-29: full-Chumash concatenation of all five books, flagged partial_corpus.
  const allVerses = versions.reduce((s, v) => s + (v.verseCount || 0), 0);
  const allLetters = versions.reduce((s, v) => s + (v.letterCount || 0), 0);
  books.push({
    book: 'chumash',
    name: 'חומש (מלא)',
    verse_count: allVerses || null,
    letter_count: allLetters || null,
    sha256: null,
    version: 'combined 5 books (study text)',
    partial_corpus: true,
    note: 'Concatenated study text. The listed letter count is the raw source character total; the imported consonantal letter count (shown after loading) is lower because non-letter marks are not counted — not a certified corpus.',
  });
  return [
    {book:'tikkun:all',name:'Layout 1 · Full Torah (245 columns)',version:'Fixed Tikkun reference — review before writing'},
    ...BOOKS.map(book=>({book:'tikkun:'+book,name:'Layout 1 · '+HEBREW_NAMES[book],version:'Fixed Tikkun reference — review before writing'})),
    ...books
  ];
}

export function loadBuiltinSource(book) {
  if (book === 'chumash') {
    // Concatenate all five books into one books[] structure for the importer.
    const books = BOOKS.map((b) => {
      const path = SOURCE_DIR + b + '.json';
      if (!existsSync(path)) throw new Error('builtin source file missing: ' + b);
      let obj;
      try { obj = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error('builtin source malformed: ' + b); }
      const v = (obj.versions && obj.versions[0]) || {};
      return { name: HEBREW_NAMES[b], chapters: Array.isArray(v.text) ? v.text : [] };
    });
    const combined = { title: 'Chumash', books };
    return { obj: combined, raw: JSON.stringify(combined), name: 'חומש', book: 'chumash' };
  }
  if (!BOOKS.includes(book)) throw new Error('unknown builtin book: ' + book);
  const path = SOURCE_DIR + book + '.json';
  if (!existsSync(path)) throw new Error('builtin source file missing: ' + book);
  const raw = readFileSync(path, 'utf8');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { throw new Error('builtin source malformed: ' + book); }
  return { obj, raw, name: HEBREW_NAMES[book], book };
}
