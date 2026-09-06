// Holy-name classification is intentionally not implemented.
//
// The same Hebrew spelling can be holy or ordinary. The program must therefore
// never decide holiness from a word, prefix, dictionary or model. Exact holy
// letters enter the layout only through a human-authored occurrence overlay
// (engine/stam-annotations.js).

export function analyzeToken() {
  return null;
}

export function analyzeTokens(tokens) {
  return (tokens || []).map((text) => ({ text, isShem: false, human_decision_required: true }));
}

export function shemLetterGraphemes() {
  return [];
}

export function isShemInfo() {
  return false;
}
