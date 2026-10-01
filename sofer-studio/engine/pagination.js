// Explicit page starts supplement the regular row limit without inserting
// synthetic blank lines or changing source-letter order.
export function* pageRanges(lines, geometry) {
  const perPage = Math.max(1, Number(geometry.lines_per_amud) || 42);
  let start = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page_start || lines[i].flow_page_start || i - start >= perPage) { yield [start, i]; start = i; }
  }
  if (start < lines.length) yield [start, lines.length];
}
