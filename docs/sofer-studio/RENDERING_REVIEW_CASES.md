Concrete rendering review case (current tikkun.js after first correction edits):

- appendLineContent still splits line.text into words and uses font-flow text nodes + ordinary spaces. It does not render measured line.items, per-letter widths, inter-letter gaps, setuma/fixed-pattern segment gaps, or stretch decisions.
- hasStretchIn is literally `return false`. applyFitScale only scales a font-flow parchment; that does not align glyph boxes with calibrated measurements.
- It reclassifies Shemos through frontend classifyWord instead of saved token metadata. mapOccurrences expects word_index metadata that publicLine does not emit. Imported unusual letters and their individual widths therefore are not represented faithfully.
- buildAmud uses current activeGeometry, estimatedHeight is hardcoded31px, line index is global rather than local, instead of frozen layout baseline pitch and letter height.
- Frontend render builds every amud DOM synchronously before its chunked append. Full305k-letter imports can still freeze browser despite chunked append.

These are core requested tikkun functionality, not optional polish. Review/fix with measured per-letter/word boxes, explicit gaps/annotations, immutable snapshot geometry, saved Shem uncertainty, and shared faithful print output. Do not claim measured export/preview parity based on width side notes alone. Use an honest screen-font disclaimer without weakening the requirement to represent exact allocated geometry.
