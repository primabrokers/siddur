import { wordWidth, totalWidth, measurementUnitMm } from './width.js';

export function sourceControls(source) {
  const tokens = (source.verses || []).flatMap(verse => verse.tokens || []);
  const result = { page_starts: [], custom_gaps: [] }; let t = 0, g = 0, before = '';
  tokens.forEach((token, index) => {
    if (!token.marker) { before = token.text; return; }
    if (token.marker === 'reference_page_break') result.reference_pages = (result.reference_pages || 0) + 1;
    if (!['page_break', 'custom_gap'].includes(token.marker)) return;
    const after = tokens.slice(index + 1).find(next => !next.marker)?.text || '';
    if (token.marker === 'page_break') result.page_starts.push({ id: 't-' + t++, first_word: after });
    if (token.marker === 'custom_gap') result.custom_gaps.push({ id: 'g-' + g++, before, after });
  });
  return result;
}

export function documentSettings(source, geometry) {
  const settings = geometry.document_flow || {};
  return settings.source_id && source.id && settings.source_id !== source.id
    ? { ...settings, starts: {}, gaps: {}, page_widths: {} } : settings;
}

export function customGapWidth(setting = {}, profile) {
  const unit = measurementUnitMm(profile);
  switch (setting.preset || 'yod-2.5') {
    case 'yod-2.5': return 2.5 * totalWidth('י', profile);
    case 'asher-less-half': return Math.max(0, wordWidth('אשר', profile) - .5 * unit);
    case 'nine-yods': return wordWidth('ייייייייי', profile);
    case 'three-asher': return wordWidth('אשראשראשר', profile);
    case 'three-asher-spaced': return 3 * wordWidth('אשר', profile) + 2 * profile.gaps.inter_word;
    case 'custom': return Number(setting.units ?? 0) * unit;
    default: throw new Error('Unknown custom gap preset');
  }
}

// Inspect each consecutive run of explicit song rows. Three-part rows make
// the entire run Hayam; a run of two-part rows uses Haazinu.
export function inferredSongKinds(units) {
  const kinds = new Map(); let ends = [], breaks = 0, hasThree = false;
  const finish = () => { for (const index of ends) kinds.set(index, hasThree ? 'hayam' : 'haazinu'); ends = []; hasThree = false; breaks = 0; };
  units.forEach((unit, index) => {
    if (unit.type === 'song_break') breaks++;
    if (unit.type === 'song_end') { if (breaks) { ends.push(index); hasThree ||= breaks >= 2; } breaks = 0; }
    if (['page_break', 'blank_line', 'petucha', 'sefer'].includes(unit.type)) finish();
  }); finish(); return kinds;
}

export function documentOptionsErrors(input) {
  const errors = [], flow = input.document_flow;
  for (const key of ['initial_margin_mm', 'final_margin_mm']) if (input[key] != null && !(Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 1000)) errors.push(key + ' must be between 0 and 1000 mm');
  if (flow == null) return errors;
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return [...errors, 'Document flow must be an object'];
  for (const key of ['starts', 'gaps', 'page_widths']) if (flow[key] != null && (typeof flow[key] !== 'object' || Array.isArray(flow[key]))) return [...errors, key + ' must be an object'];
  for (const [id, width] of Object.entries(flow.page_widths || {})) if (!/^occ-\d+$/.test(id) || !(Number.isFinite(width) && width > 0 && width <= 1000)) errors.push('Invalid saved page width');
  if (flow.column_start != null && !['none', 'vav', 'hamelech'].includes(flow.column_start)) errors.push('Choose ordinary, vav or hamelech page starts');
  for (const key of ['fit_last_page', 'balance_segments', 'follow_reference_pages', 'fit_boundary_page', 'reflow_word_moves']) if (flow[key] != null && typeof flow[key] !== 'boolean') errors.push(key + ' must be true or false');
  if (flow.fit_last_page && flow.balance_segments) errors.push('Choose either last-page fitting or balancing every page');
  for (const [id, start] of Object.entries(flow.starts || {})) {
    if (!/^t-\d+$/.test(id) || !start || typeof start.enabled !== 'boolean') errors.push('Invalid selected page start');
    if (start?.width_mm != null && !(Number.isFinite(start.width_mm) && start.width_mm > 0 && start.width_mm <= 1000)) errors.push('Section width must be between 0 and 1000 mm');
  }
  for (const [id, gap] of Object.entries(flow.gaps || {})) {
    if (!/^g-\d+$/.test(id) || !gap || !['yod-2.5', 'asher-less-half', 'nine-yods', 'three-asher', 'three-asher-spaced', 'custom'].includes(gap.preset)) errors.push('Invalid custom gap');
    if (gap?.preset === 'custom' && !(Number.isFinite(gap.units) && gap.units >= 0 && gap.units <= 1000)) errors.push('Custom gap must be between 0 and 1000 units');
  }
  return errors;
}
