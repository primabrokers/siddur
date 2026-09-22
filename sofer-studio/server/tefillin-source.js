import { createHash } from 'node:crypto';
import { loadReferenceSource } from './reference.js';
import { TEFILLIN_SECTIONS, inTefillinSection } from '../engine/tefillin.js';
import { countHebrewLetters } from '../engine/text.js';

// Reuse the pinned Torah corpus and its exact human-authored annotations.
// Passage ranges: https://www.chabad.org/library/article_cdo/aid/142435
export function loadTefillinSource() {
  const full = loadReferenceSource('all');
  const verses = full.verses.filter(v => TEFILLIN_SECTIONS.some(s => inTefillinSection(v, s)));
  const refs = new Set(verses.map(v => v.ref));
  const original = JSON.stringify(verses);
  return { ...full, name: 'Tefillin — four passages', format: 'tefillin', original,
    verses, books: ['Exodus', 'Deuteronomy'], book_count: 2, verse_count: verses.length,
    letter_count: verses.reduce((n, v) => n + countHebrewLetters(v.consonant), 0),
    word_count: verses.reduce((n, v) => n + v.tokens.filter(t => !t.marker).length, 0),
    consonant: verses.map(v => v.consonant).join('\n'), revision_hash: createHash('sha256').update(original).digest('hex'),
    unusual_letters: full.unusual_letters.filter(u => refs.has(u.ref)),
    canonical: { tefillin: TEFILLIN_SECTIONS, provenance: full.canonical.reference.id },
    excerpt: false, partial_corpus: false, label: 'Tefillin planning — review text and spacing before writing',
    source_label: 'Four passages from the pinned Tikkun corpus',
  };
}
