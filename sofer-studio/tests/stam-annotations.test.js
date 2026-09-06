import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { compileReference } from '../engine/reference-source.js';
import { computeLayout, normalizeGeometry } from '../engine/layout.js';
import { normalizeProfile } from '../engine/profile.js';
import { sectionBreakSummary } from '../engine/source.js';

const installedRoot = new URL('../reference-data/', import.meta.url);
const sourceRoot = new URL('../../tikkun.io-57ba104e8de055cf92d3cf6aa91245bd92b34d60/src/data/pages/torah/', import.meta.url);
const dataRoot = existsSync(new URL('1.json', installedRoot)) ? installedRoot : sourceRoot;
const installedOverlay = new URL('../reference-data/stam-annotations.json', import.meta.url);
const overlayUrl = existsSync(installedOverlay) ? installedOverlay : new URL('../../stam-annotations.json', import.meta.url);
const pages = () => Array.from({ length: 245 }, (_, index) => JSON.parse(readFileSync(new URL(`${index + 1}.json`, dataRoot), 'utf8')));
const overlay = () => JSON.parse(readFileSync(overlayUrl, 'utf8'));
const profile = (hyphenUnits) => normalizeProfile({
  units_per_row: 62, unit_basis: 'average_letter', layout_mode: 'reflow',
  stretch_policy: { version: 1, caps_percent: {}, distribution: 'equal_mm', word_space_percent: 50, setuma_percent: 'unlimited', setuma_first: true, stam_hyphen_units: hyphenUnits },
});
const geometry = normalizeGeometry({ line_width_mm: 180, lines_per_amud: 42, max_letters_per_line: 0 });

test('owner STAM overlay verifies all canonical section breaks and annotates without replacing Torah text', () => {
  const doc = compileReference(pages(), 'all', overlay());
  assert.equal(doc.word_count, 79977);
  assert.deepEqual(sectionBreakSummary(doc.verses), { petucha: 290, setuma: 379, present: true, verified: false });
  assert.equal(doc.canonical.reference.stam_annotations.marker_audit.canonical_missing, 0);
  assert.equal(doc.canonical.reference.stam_annotations.marker_audit.extra_song_segments, 116);
  const words = doc.verses.flatMap((verse) => verse.tokens.filter((token) => !token.marker));
  assert.equal(words.filter((word) => word.explicit_shem).length, 2658);
  assert.equal(words.flatMap((word) => word.holy_letter_indexes || []).length, 11684);
  assert.equal(doc.canonical.reference.stam_annotations.holy_letters, 11684);
  assert(words.filter((word) => !word.explicit_shem).every((word) => word.isShem === false));
  assert.equal(words.flatMap((word) => word.stam_width_marks || []).length, 15);
  assert.equal(words[0].consonant, 'בראשית');
});

test('each STAM hyphen uses the saved line-unit amount and traditional book blank rows survive reflow', () => {
  const genesis = compileReference(pages(), 'Genesis', overlay()); genesis.reference = genesis.canonical.reference;
  const zero = computeLayout(genesis, profile(0), geometry);
  const one = computeLayout(genesis, profile(1), geometry);
  const firstZero = zero.lines.flatMap((line) => line.words).find((word) => word.wordIndex === 0);
  const firstOne = one.lines.flatMap((line) => line.words).find((word) => word.wordIndex === 0);
  assert(Math.abs((firstOne.width_mm - firstZero.width_mm) - 180 / 62) < 1e-9);
  assert.equal(firstOne.override.find((entry) => entry.stam_hyphens)?.type, 'large');
  const small = one.lines.flatMap((line) => line.words).find((word) => word.wordIndex === 473);
  assert.equal(small.consonant, 'בהבראם');
  assert.equal(small.override.find((entry) => entry.stam_hyphens)?.type, 'small');

  const all = compileReference(pages(), 'all', overlay()); all.reference = all.canonical.reference;
  const flow = computeLayout(all, profile(1), geometry);
  assert.equal(flow.lines.filter((line) => line.book_boundary_blank).length, 16);
  assert.equal(flow.lines.filter((line) => line.sefer_end).length, 5);
});
