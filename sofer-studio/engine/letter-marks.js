// A letter may carry several independent human annotations (for example frב).
export function letterMarks(letter) {
  return letter.stam_letter_marks || (letter.stam_letter_mark ? [letter.stam_letter_mark] : []);
}
export function hasLetterMark(letter, type) { return letterMarks(letter).some(mark => mark.type === type); }
export function letterSizeScale(letter, profile) {
  return hasLetterMark(letter, 'large') ? 1.5 : hasLetterMark(letter, 'small') ? (profile.small_letter_scale ?? .5) : 1;
}
