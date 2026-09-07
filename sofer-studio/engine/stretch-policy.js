// Versioned, JSON-safe stretch policy. Existing snapshots without a policy keep
// their original millimetre caps. No persisted Infinity or inferred permissions.
import { totalWidth, interWordGap, measurementUnitMm } from './width.js';

export const UNLIMITED = 'unlimited';
const floorMm = n => Math.floor((Math.max(0, n) + 1e-10) * 1000) / 1000;

export function measuredLetterWidth(word, letter, profile) {
  const override = (word.override || []).find(o => o.id === letter.id);
  if (override) return Number(override.mm);
  const base = totalWidth(letter.base, profile);
  return letter.stam_letter_mark?.type === 'large' ? base * 1.5 :
    letter.stam_letter_mark?.type === 'small' ? base * 0.5 : base;
}

export function percentageCap(base, percent, budget) {
  if (percent === UNLIMITED) return floorMm(budget);
  const n = Number(percent);
  if (!(base > 0) || !Number.isFinite(n) || n < 0) return 0;
  return floorMm(Math.min(budget, base * n / 100));
}

export function baseBudget(line) {
  const existing = (line.stretch_decisions || []).reduce((n, d) => n + Number(d.stretch_mm || 0), 0);
  return Math.max(0, Number(line.base_leftover_mm ?? (Number(line.leftover_mm || 0) + existing)));
}

export function letterCap(word, letter, profile, budget) {
  if (profile.stretch_policy) {
    return percentageCap(measuredLetterWidth(word, letter, profile), profile.stretch_policy.caps_percent[letter.base] ?? 0, budget);
  }
  return Number(profile.max_stretch?.[letter.base]) || 0;
}

export function effectiveProfile(profile, geometry) {
  const result = structuredClone(profile);
  if (result.units_per_row != null) {
    const units = Number(result.units_per_row), width = Number(geometry.line_width_mm);
    if (!(units > 0) || !Number.isFinite(units) || !(width > 0) || !Number.isFinite(width)) {
      throw new Error('Column-derived units require a positive column width and units per row');
    }
    result.unit_mm = width / units;
    if (result.unit_basis === 'line_units' || result.unit_basis === 'average_letter') {
      // Correct the old average-letter interpretation only for new calculations.
      // Persisted profiles and saved layout snapshots are never rewritten here.
      // Two table units consume two row units, independent of other letters or
      // vertical height. The frozen width model still adds physical stroke once.
      const scale = result.letter_height_mm / result.reference_height_mm;
      if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Line units require a positive letter and reference height');
      result.unit_basis = 'line_units';
      result.unit_mm = width / units / scale;
      delete result.average_unit_mm;
    }
    result.unit_column_width_mm = width;
  }
  if (result.stretch_policy) {
    if (result.stretch_policy.version === 2) {
      result.gaps.inter_word = Number(result.special_widths_units?.word_space || 0) * measurementUnitMm(result);
      result.stretch_policy.stam_hyphen_units = Number(result.special_widths_units?.hyphen || 0);
    }
    // This policy explicitly approves an increase of up to 50% for ordinary
    // spaces. Do not silently replace it with the legacy small-letter advisory
    // when a different unit count changes the measured small-letter width.
    // A deliberately saved absolute millimetre limit remains a hard bound.
    result.word_space_limit_mm = geometry.max_inter_word_gap_mm != null
      ? Math.max(0, Number(geometry.max_inter_word_gap_mm))
      : null;
  }
  return result;
}

export function spaceCandidatesOf(line, profile) {
  const policy = profile.stretch_policy;
  if (!policy || line.fixed_pattern || line.sefer_end || line.setuma_at_edge) return [];
  const budget = baseBudget(line), items = line.items || [], words = line.words || [];
  const candidates = [];
  if (policy.version === 2 && line.petucha_end && budget > 0) {
    const base = Math.max(0.001, Number(profile.special_widths_units?.petucha || 20) * measurementUnitMm(profile));
    candidates.push({
      letter_occurrence_id: 'petucha-gap-end', kind: 'petucha_gap', word_index: null,
      letter: 'פ gap', word: 'Petuchah', base_width_mm: base,
      cap_mm: percentageCap(base, policy.petucha_percent ?? UNLIMITED, budget),
      cap_percent: policy.petucha_percent ?? UNLIMITED,
      priority: profile.stretch_priorities?.petucha ?? 1,
    });
    return candidates;
  }
  let wi = 0;
  items.forEach((item, index) => {
    if (item.type === 'word') {
      if (index > 0 && items[index - 1].type === 'word') {
        const width = policy.version === 2
          ? Number(profile.special_widths_units?.word_space || 0) * measurementUnitMm(profile)
          : interWordGap(profile);
        const limit = profile.word_space_limit_mm == null ? width * 1.5 : Number(profile.word_space_limit_mm);
        const cap = floorMm(Math.min(percentageCap(width, Math.min(50, Number(policy.word_space_percent) || 0), budget), Math.max(0, limit - width)));
        if (cap > 0) candidates.push({
          letter_occurrence_id: 'word-space-before-' + wi, kind: 'word_space', word_index: wi,
          letter: 'space', word: (words[wi - 1]?.text || '') + ' | ' + (words[wi]?.text || ''),
          base_width_mm: width, cap_mm: cap, cap_percent: Math.min(50, Number(policy.word_space_percent) || 0),
          priority: policy.version === 2 ? (profile.stretch_priorities?.word_space ?? 3) : 1,
        });
      }
      wi++;
    } else if (item.type === 'setuma_gap' && index > 0 && index < items.length - 1
      && items[index - 1].type === 'word' && items[index + 1].type === 'word') {
      const width = Number(item.width_mm), cap = percentageCap(width, policy.setuma_percent ?? 0, budget);
      if (cap > 0) candidates.push({
        letter_occurrence_id: 'setuma-gap-' + index, kind: 'setuma_gap', item_index: index,
        letter: 'ס gap', word: (words[wi - 1]?.text || '') + ' | ' + (words[wi]?.text || ''),
        base_width_mm: width, cap_mm: cap, cap_percent: policy.setuma_percent,
        priority: policy.version === 2 ? (profile.stretch_priorities?.setuma ?? 1) : (policy.setuma_first === false ? 1 : 0),
      });
    }
  });
  return candidates;
}

// Water filling gives every uncapped target the same percentage (or mm)
// increase. Saturated targets stop growing; the rest continue equally.
// Rounding remainder adds at most one 0.001 mm quantum per target per pass.
export function balancedSuggestions(candidates, budget, distribution = 'equal_percent') {
  let remaining = floorMm(budget);
  const allocations = candidates.map(() => 0);
  for (const priority of [...new Set(candidates.map(c => c.priority ?? 1))].sort((a, b) => a - b)) {
    let active = candidates.map((c, i) => ({ c, i })).filter(({ c }) => (c.priority ?? 1) === priority && c.cap_mm > 0);
    while (active.length && remaining > 1e-9) {
      const weight = c => distribution === 'equal_mm' ? 1 : Math.max(0.001, c.base_width_mm);
      const totalWeight = active.reduce((n, { c }) => n + weight(c), 0);
      const level = remaining / totalWeight;
      const saturated = active.filter(({ c, i }) => c.cap_mm - allocations[i] <= level * weight(c) + 1e-9);
      if (!saturated.length) {
        for (const { c, i } of active) allocations[i] += level * weight(c);
        remaining = 0;
        break;
      }
      const removed = new Set();
      for (const { c, i } of saturated) {
        const amount = Math.max(0, c.cap_mm - allocations[i]);
        allocations[i] += amount; remaining = Math.max(0, remaining - amount); removed.add(i);
      }
      active = active.filter(({ i }) => !removed.has(i));
    }
  }
  const rounded = allocations.map(floorMm);
  let quanta = Math.floor((Math.min(budget, allocations.reduce((n, v) => n + v, 0)) - rounded.reduce((n, v) => n + v, 0) + 1e-9) * 1000);
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) =>
    (a.c.priority ?? 1) - (b.c.priority ?? 1) || (allocations[b.i] - rounded[b.i]) - (allocations[a.i] - rounded[a.i]) || a.i - b.i);
  for (const { c, i } of order) {
    if (!quanta) break;
    if (rounded[i] + 0.001 <= c.cap_mm + 1e-9) { rounded[i] = Math.round((rounded[i] + 0.001) * 1000) / 1000; quanta--; }
  }
  return candidates.flatMap((c, i) => rounded[i] > 0 ? [{
    letter_occurrence_id: c.letter_occurrence_id, stretch_mm: rounded[i], kind: c.kind || 'letter',
  }] : []);
}
