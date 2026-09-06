// engine/text.js
// Grapheme segmentation and Hebrew text utilities.
// All source characters are preserved exactly; normalized views are derived only.

const HEBREW_LETTER_LO = 0x05d0; // א
const HEBREW_LETTER_HI = 0x05ea; // ת

export function isNekudOrTaamCodePoint(cp) {
  return (
    (cp >= 0x0591 && cp <= 0x05af) ||
    (cp >= 0x05b0 && cp <= 0x05bd) ||
    cp === 0x05bf ||
    (cp >= 0x05c1 && cp <= 0x05c7)
  );
}

export function isHebrewLetterCodePoint(cp) {
  return cp >= HEBREW_LETTER_LO && cp <= HEBREW_LETTER_HI;
}

let graphemeSegmenter = null;
function getSegmenter() {
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter('he', { granularity: 'grapheme' });
  }
  return graphemeSegmenter;
}

export function segmentGraphemes(str) {
  if (!str) return [];
  const seg = getSegmenter();
  const out = [];
  for (const s of seg.segment(str)) out.push(s.segment);
  return out;
}

export function isHebrewGrapheme(g) {
  return g.length > 0 && isHebrewLetterCodePoint(g.codePointAt(0));
}

export function stripNekud(str) {
  if (!str) return '';
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (!isNekudOrTaamCodePoint(cp)) out += ch;
  }
  return out;
}

export function countHebrewLetters(str) {
  return segmentGraphemes(str).filter(isHebrewGrapheme).length;
}

export function hebrewLetterGraphemes(str) {
  return segmentGraphemes(str).filter(isHebrewGrapheme);
}

export function isLetterGrapheme(g) {
  return isHebrewGrapheme(g);
}

export function graphemeBaseLetter(g) {
  const cp = g.codePointAt(0);
  return isHebrewLetterCodePoint(cp) ? String.fromCodePoint(cp) : g;
}
