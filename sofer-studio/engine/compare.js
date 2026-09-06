// engine/compare.js
// Compare 2-3 profiles on the same source + geometry, with independent results
// and honest labels (whole-corpus vs partial excerpt).

import { computeLayoutAsync } from './layout.js';

export async function compareProfiles(source, geometry, profiles) {
  const comparisons = [];
  for (const p of profiles) {
    // Await the async compute so the event loop yields between profiles and a
    // concurrent health/UI probe is never blocked (F-15).
    const layout = await computeLayoutAsync(source, p, geometry);
    comparisons.push({
      profile_id: p.id || null,
      profile_name: p.name,
      letter_height_mm: p.letter_height_mm,
      total_amudim: layout.summary.total_amudim,
      total_yerios: layout.summary.total_yerios,
      klaf_length_m: layout.summary.klaf_length_m,
      total_lines: layout.summary.total_lines,
    });
  }
  return {
    comparisons,
    source_label: (source.excerpt ? 'excerpt (unverified): ' : '') + (source.partial_corpus && !source.excerpt ? 'partial corpus: ' : '') + (source.label || source.source_label || source.name),
    excerpt: !!source.excerpt,
    partial_corpus: !!source.partial_corpus,
  };
}
