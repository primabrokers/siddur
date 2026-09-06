// server/store.js
// SQLite repository: CRUD for sources, profiles, geometries, patterns, layouts,
// lines, candidates. All rows persist; JSON fields store structured data.

import { getId, nowIso } from '../db/db.js';
import { normalizeProfile } from '../engine/profile.js';
import { normalizeGeometry } from '../engine/layout.js';

function json(x) { return JSON.stringify(x == null ? null : x); }
function parse(x) { return x ? JSON.parse(x) : null; }

// ---- sources --------------------------------------------------------------

export function insertSource(db, doc) {
  const id = getId();
  db.prepare(`INSERT INTO sources (
    id, name, tradition, revision_hash, format, excerpt, partial_corpus, label, source_label,
    book_count, verse_count, letter_count, word_count, original, consonant,
    books, verses, unusual_letters, warnings, canonical, has_qere_ketiv, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, doc.name, doc.tradition, doc.revision_hash, doc.format, doc.excerpt ? 1 : 0,
    doc.partial_corpus ? 1 : 0, doc.label || null, doc.source_label,
    doc.book_count, doc.verse_count, doc.letter_count,
    doc.word_count, doc.original, doc.consonant, json(doc.books), json(doc.verses),
    json(doc.unusual_letters), json(doc.warnings), json(doc.canonical != null ? doc.canonical : null),
    doc.has_qere_ketiv ? 1 : 0, nowIso()
  );
  return id;
}

export function listSources(db) {
  return db.prepare(`SELECT id, name, tradition, revision_hash, format, excerpt, partial_corpus, label,
    source_label, book_count, verse_count, letter_count, word_count, created_at
    FROM sources ORDER BY created_at DESC`).all().map((r) => ({ ...r, excerpt: !!r.excerpt, partial_corpus: !!r.partial_corpus }));
}

export function getSource(db, id) {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id, name: row.name, tradition: row.tradition, revision_hash: row.revision_hash,
    format: row.format, excerpt: !!row.excerpt, partial_corpus: !!row.partial_corpus, label: row.label, source_label: row.source_label,
    book_count: row.book_count, verse_count: row.verse_count, letter_count: row.letter_count,
    word_count: row.word_count, original: row.original, consonant: row.consonant,
    books: parse(row.books), verses: parse(row.verses),
    unusual_letters: parse(row.unusual_letters), warnings: parse(row.warnings),
    canonical: parse(row.canonical), has_qere_ketiv: !!row.has_qere_ketiv,
    created_at: row.created_at,
  };
}

// ---- profiles -------------------------------------------------------------

export function insertProfile(db, p) {
  const n = normalizeProfile(p);
  const id = getId();
  db.prepare(`INSERT INTO profiles (
    id, name, reference_height_mm, letter_height_mm, stroke_mm, unit_mm, min_nib_mm, min_letter_height_mm,
    letter_widths, stroke_factors, gaps, non_stretchable, max_stretch, stretch_position, created_at, stretch_policy, units_per_row, unit_basis, layout_mode
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, n.name, n.reference_height_mm, n.letter_height_mm, n.stroke_mm, n.unit_mm, n.min_nib_mm, n.min_letter_height_mm,
    json(n.letter_widths), json(n.stroke_factors), json(n.gaps), json(Array.from(n.non_stretchable)),
    json(n.max_stretch), n.stretch_position, nowIso(), json(n.stretch_policy), n.units_per_row, n.unit_basis, n.layout_mode
  );
  return { ...fullProfileFrom(n, id), id };
}

function fullProfileFrom(n, id) {
  return {
    id, name: n.name, reference_height_mm: n.reference_height_mm, letter_height_mm: n.letter_height_mm,
    stroke_mm: n.stroke_mm, unit_mm: n.unit_mm, min_nib_mm: n.min_nib_mm, min_letter_height_mm: n.min_letter_height_mm,
    letter_widths: n.letter_widths, stroke_factors: n.stroke_factors, gaps: n.gaps,
    non_stretchable: Array.from(n.non_stretchable), max_stretch: n.max_stretch,
    stretch_position: n.stretch_position, created_at: nowIso(),
    stretch_policy: n.stretch_policy, units_per_row: n.units_per_row, unit_basis:n.unit_basis, layout_mode:n.layout_mode,
  };
}

export function listProfiles(db) {
  const rows = db.prepare('SELECT id, name, letter_height_mm, stroke_mm, unit_mm, created_at FROM profiles ORDER BY created_at DESC').all();
  return rows;
}

export function getProfile(db, id) {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return null;
  return normalizeProfile({
    id: row.id, name: row.name, reference_height_mm: row.reference_height_mm,
    letter_height_mm: row.letter_height_mm, stroke_mm: row.stroke_mm, unit_mm: row.unit_mm,
    min_nib_mm: row.min_nib_mm, min_letter_height_mm: row.min_letter_height_mm, letter_widths: parse(row.letter_widths),
    stroke_factors: parse(row.stroke_factors), gaps: parse(row.gaps),
    non_stretchable: parse(row.non_stretchable), max_stretch: parse(row.max_stretch),
    stretch_position: row.stretch_position, created_at: row.created_at,
    stretch_policy: parse(row.stretch_policy), units_per_row: row.units_per_row, unit_basis:row.unit_basis, layout_mode:row.layout_mode,
  });
}

export function updateProfile(db, id, p) {
  const n = normalizeProfile({ ...p });
  const r = db.prepare(`UPDATE profiles SET name=?, reference_height_mm=?, letter_height_mm=?, stroke_mm=?,
    unit_mm=?, min_nib_mm=?, min_letter_height_mm=?, letter_widths=?, stroke_factors=?, gaps=?, non_stretchable=?,
    max_stretch=?, stretch_position=?, stretch_policy=?, units_per_row=?, unit_basis=?, layout_mode=? WHERE id=?`).run(
    n.name, n.reference_height_mm, n.letter_height_mm, n.stroke_mm, n.unit_mm, n.min_nib_mm, n.min_letter_height_mm,
    json(n.letter_widths), json(n.stroke_factors), json(n.gaps), json(Array.from(n.non_stretchable)),
    json(n.max_stretch), n.stretch_position, json(n.stretch_policy), n.units_per_row, n.unit_basis, n.layout_mode, id
  );
  if (r.changes === 0) return null;
  return getProfile(db, id);
}

export function deleteProfile(db, id) {
  return db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;
}

// ---- geometries -----------------------------------------------------------

export function insertGeometry(db, g) {
  const n = normalizeGeometry(g);
  const id = getId();
  db.prepare(`INSERT INTO geometries (
    id, name, lines_per_amud, baseline_pitch_mm, top_margin_mm, bottom_margin_mm,
    inter_column_gap_mm, outer_margin_mm, line_width_mm, max_letters_per_line,
    amudim_per_yeria, partial_final_yeria, setuma_gap_mm, setuma_reference_letter,
    min_inter_letter_gap_mm, min_inter_word_gap_mm, max_inter_word_gap_mm,
    max_inter_word_gap_factor, small_letter_reference, vavei_haamudim, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, n.name, n.lines_per_amud, n.baseline_pitch_mm, n.top_margin_mm, n.bottom_margin_mm,
    n.inter_column_gap_mm, n.outer_margin_mm, n.line_width_mm, n.max_letters_per_line,
    n.amudim_per_yeria, n.partial_final_yeria, n.setuma_gap_mm, n.setuma_reference_letter,
    n.min_inter_letter_gap_mm, n.min_inter_word_gap_mm, n.max_inter_word_gap_mm,
    n.max_inter_word_gap_factor != null ? n.max_inter_word_gap_factor : null,
    n.small_letter_reference, n.vavei_haamudim ? 1 : 0, nowIso()
  );
  return { ...n, id };
}

export function listGeometries(db) {
  return db.prepare('SELECT * FROM geometries ORDER BY created_at DESC').all().map(r => ({ ...r, vavei_haamudim: !!r.vavei_haamudim }));
}

export function getGeometry(db, id) {
  const row = db.prepare('SELECT * FROM geometries WHERE id = ?').get(id);
  if (!row) return null;
  return normalizeGeometry({ ...row, vavei_haamudim: !!row.vavei_haamudim });
}

// ---- patterns -------------------------------------------------------------

export function insertPattern(db, p) {
  const id = getId();
  db.prepare(`INSERT INTO patterns (id, passage_name, scheme_name, version, provenance, status, slots, range, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, p.passage_name, p.scheme_name, p.version || null, p.provenance || null,
    p.status || 'unverified', json(p.slots), json(p.range || null), nowIso()
  );
  return { id, ...p };
}

export function listPatterns(db) {
  return db.prepare('SELECT id, passage_name, scheme_name, version, provenance, status, created_at FROM patterns ORDER BY created_at DESC').all();
}

export function getPattern(db, id) {
  const row = db.prepare('SELECT * FROM patterns WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, passage_name: row.passage_name, scheme_name: row.scheme_name, version: row.version,
    provenance: row.provenance, status: row.status, slots: parse(row.slots), range: parse(row.range), created_at: row.created_at };
}

// ---- layouts --------------------------------------------------------------

export function saveLayout(db, meta, computed) {
  const id = getId();
  const insertLayout = db.prepare(`INSERT INTO layouts (id, name, source_id, profile_id, geometry_id, pattern_ids,
    annotations, source_hash, profile_snapshot, geometry_snapshot, status, summary, validation, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertLine = db.prepare(`INSERT INTO layout_lines (
    id, layout_id, line_id, line_key, line_index, amud, tokens, text, consonant_text, width_mm,
    leftover_mm, stretch_decisions, letter_occurrence_ids, shem, uncertain_shem, first_word, last_word, verse_refs,
    words, items, base_leftover_mm, stretched_width_mm, status, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((lines) => {
    insertLayout.run(
      id, meta.name || null, meta.source_id, meta.profile_id, meta.geometry_id,
      json(meta.pattern_ids || []), json(meta.annotations || {}), meta.source_hash,
      json(meta.profile_snapshot), json(meta.geometry_snapshot), 'draft',
      json(computed.summary), json(meta.validation), nowIso()
    );
    for (const l of lines) {
      insertLine.run(
        getId(), id, l.line_id, l.line_key || null, l.line_index, l.amud, json(l.tokens), l.text || l.tokens.join(' '),
        l.consonant_text || '', l.width_mm, l.leftover_mm, json(l.stretch_decisions || []),
        json(l.letter_occurrence_ids || []), l.shem ? 1 : 0, l.uncertain_shem ? 1 : 0,
        l.first_word || '', l.last_word || '', json(l.verse_refs || []),
        json(l.words || []), json(l.items || []),
        l.base_leftover_mm != null ? l.base_leftover_mm : l.leftover_mm,
        l.stretched_width_mm != null ? l.stretched_width_mm : l.width_mm,
        l.status || 'pending', nowIso()
      );
      db.prepare('UPDATE layout_lines SET layout_flags=? WHERE layout_id=? AND line_id=?').run(
        json({petucha_end:!!l.petucha_end,sefer_end:!!l.sefer_end,fixed_pattern:!!l.fixed_pattern,book_boundary_blank:!!l.book_boundary_blank,reference_page:l.reference_page||null}),id,l.line_id
      );
    }
  });
  tx(computed.lines);
  return id;
}

export function listLayouts(db) {
  return db.prepare(`SELECT id, name, source_id, profile_id, geometry_id, status, created_at, locked_at FROM layouts ORDER BY created_at DESC`).all();
}

export function getLayoutRow(db, id) {
  return db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) || null;
}

export function getLayoutLines(db, layoutId, page) {
  const rows=page ? db.prepare('SELECT * FROM layout_lines WHERE layout_id = ? ORDER BY line_index ASC LIMIT ? OFFSET ?').all(layoutId,page.limit,page.from)
    : db.prepare('SELECT * FROM layout_lines WHERE layout_id = ? ORDER BY line_index ASC').all(layoutId);
  return rows
    .map((r) => {
      const items = parse(r.items) || [];
      const words = parse(r.words) || [];
      const flags = parse(r.layout_flags);
      const firstItem = items.length ? items[0] : null;
      const lastItem = items.length ? items[items.length - 1] : null;
      const hasSetuma = items.some((i) => i.type === 'setuma_gap');
      const setumaAtEdge = hasSetuma && (!words.length || (firstItem && firstItem.type === 'setuma_gap') || (lastItem && lastItem.type === 'setuma_gap'));
      return {
        id: r.id, line_id: r.line_id, line_key: r.line_key || null, line_index: r.line_index, amud: r.amud, tokens: parse(r.tokens),
        text: r.text, consonant_text: r.consonant_text, width_mm: r.width_mm, leftover_mm: r.leftover_mm,
        stretch_decisions: parse(r.stretch_decisions), letter_occurrence_ids: parse(r.letter_occurrence_ids),
        shem: !!r.shem, uncertain_shem: !!r.uncertain_shem, first_word: r.first_word, last_word: r.last_word,
        verse_refs: parse(r.verse_refs), status: r.status,
        words, items,
        base_leftover_mm: r.base_leftover_mm != null ? r.base_leftover_mm : r.leftover_mm,
        stretched_width_mm: r.stretched_width_mm != null ? r.stretched_width_mm : r.width_mm,
        has_setuma: hasSetuma, setuma_at_edge: setumaAtEdge,
        fixed_pattern: !!(flags && flags.fixed_pattern) || items.some((i) => i.type === 'segment_gap'),
        book_boundary_blank: !!(flags && flags.book_boundary_blank),
        petucha_end: !!(flags && flags.petucha_end), sefer_end: !!(flags && flags.sefer_end),
        spacing_metadata_complete: flags != null,
        reference_page: flags && flags.reference_page || null,
        line_in_amud: flags && flags.reference_page ? (r.line_index-1)%42+1 : null,
      };
    });
}

export function getLayout(db, id, page) {
  const row = getLayoutRow(db, id);
  if (!row) return null;
  const lines = getLayoutLines(db, id, page);
  return {
    id: row.id, name: row.name, source_id: row.source_id, profile_id: row.profile_id, geometry_id: row.geometry_id,
    pattern_ids: parse(row.pattern_ids), annotations: parse(row.annotations), source_hash: row.source_hash,
    status: row.status, locked_at: row.locked_at, created_at: row.created_at,
    summary: parse(row.summary), validation: parse(row.validation),
    snapshot: { source_hash: row.source_hash, profile: parse(row.profile_snapshot), geometry: parse(row.geometry_snapshot), pattern_ids: parse(row.pattern_ids), annotations: parse(row.annotations) },
    lines,
    total_lines: db.prepare('SELECT COUNT(*) n FROM layout_lines WHERE layout_id=?').get(id).n,
  };
}

export function lockLayout(db, id) {
  const row = getLayoutRow(db, id);
  if (!row) return null;
  if (row.status === 'locked') return getLayout(db, id);
  db.prepare('UPDATE layouts SET status=?, locked_at=? WHERE id=?').run('locked', nowIso(), id);
  return getLayout(db, id);
}

export function isLocked(db, id) {
  const row = getLayoutRow(db, id);
  return !!(row && row.status === 'locked');
}

export function updateLineProgress(db, layoutId, { line_id, line_key, amud, status }) {
  const st = ['written', 'checked', 'proofread'].includes(status) ? status : 'pending';
  let changes;
  if (line_key) {
    changes = db.prepare('UPDATE layout_lines SET status=? WHERE layout_id=? AND line_key=?').run(st, layoutId, line_key).changes;
  } else if (line_id) {
    changes = db.prepare('UPDATE layout_lines SET status=? WHERE layout_id=? AND line_id=?').run(st, layoutId, line_id).changes;
  } else if (amud != null) {
    changes = db.prepare('UPDATE layout_lines SET status=? WHERE layout_id=? AND amud=?').run(st, layoutId, amud).changes;
  } else {
    changes = 0;
  }
  return changes;
}

export function layoutProgress(db, layoutId) {
  const rows = db.prepare('SELECT amud, status, COUNT(*) c FROM layout_lines WHERE layout_id=? GROUP BY amud, status ORDER BY amud').all(layoutId);
  return rows;
}

// ---- candidates -----------------------------------------------------------

export function saveCandidate(db, parentLayoutId, { profile_id, geometry_id, source_id, diff, lines_snapshot, summary, validation, pattern_ids, annotations }) {
  const id = getId();
  db.prepare('INSERT INTO candidates (id, parent_layout_id, profile_id, geometry_id, source_id, diff, lines_snapshot, summary, validation, pattern_ids, annotations, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, parentLayoutId, profile_id, geometry_id, source_id, json(diff), json(lines_snapshot),
      summary != null ? json(summary) : null, validation != null ? json(validation) : null,
      json(pattern_ids || []), json(annotations || {}), nowIso());
  return id;
}

export function getCandidate(db, id) {
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, parent_layout_id: row.parent_layout_id, profile_id: row.profile_id, geometry_id: row.geometry_id,
    source_id: row.source_id, diff: parse(row.diff), lines_snapshot: parse(row.lines_snapshot),
    summary: row.summary != null ? parse(row.summary) : null,
    validation: row.validation != null ? parse(row.validation) : null,
    pattern_ids: parse(row.pattern_ids) || [], annotations: parse(row.annotations) || {},
    created_at: row.created_at };
}

// Skip: fullProfileFrom already defined above.

export function saveStretch(db, layoutId, line_id, decisions, leftover, stretchedWidth) {
  return db.prepare('UPDATE layout_lines SET stretch_decisions=?, leftover_mm=?, stretched_width_mm=? WHERE layout_id=? AND line_id=?')
    .run(json(decisions), leftover, stretchedWidth != null ? stretchedWidth : null, layoutId, line_id).changes;
}

// Create a new LOCKED layout from a candidate's sanitized public lines.
export function createLockedLayout(db, meta, lines, summary) {
  const id = getId();
  db.prepare(`INSERT INTO layouts (id, name, source_id, profile_id, geometry_id, pattern_ids,
    annotations, source_hash, profile_snapshot, geometry_snapshot, status, locked_at, summary, validation, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, meta.name || null, meta.source_id, meta.profile_id, meta.geometry_id, json(meta.pattern_ids || []),
    json(meta.annotations || {}), meta.source_hash, json(meta.profile_snapshot), json(meta.geometry_snapshot),
    'locked', nowIso(), json(summary || {}), json(meta.validation || null), nowIso()
  );
  const insertLine = db.prepare(`INSERT INTO layout_lines (
    id, layout_id, line_id, line_key, line_index, amud, tokens, text, consonant_text, width_mm,
    leftover_mm, stretch_decisions, letter_occurrence_ids, shem, uncertain_shem, first_word, last_word, verse_refs,
    words, items, base_leftover_mm, stretched_width_mm, status, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((rows) => {
    for (const l of rows) {
      insertLine.run(
        getId(), id, l.line_id, l.line_key || null, l.line_index, l.amud, json(l.tokens), l.text || (l.tokens || []).join(' '),
        l.consonant_text || '', l.width_mm, l.leftover_mm, json(l.stretch_decisions || []),
        json(l.letter_occurrence_ids || []), l.shem ? 1 : 0, l.uncertain_shem ? 1 : 0,
        l.first_word || '', l.last_word || '', json(l.verse_refs || []),
        json(l.words || []), json(l.items || []),
        l.base_leftover_mm != null ? l.base_leftover_mm : l.leftover_mm,
        l.stretched_width_mm != null ? l.stretched_width_mm : l.width_mm,
        l.status || 'pending', nowIso()
      );
      db.prepare('UPDATE layout_lines SET layout_flags=? WHERE layout_id=? AND line_id=?').run(
        json({petucha_end:!!l.petucha_end,sefer_end:!!l.sefer_end,fixed_pattern:!!l.fixed_pattern,reference_page:l.reference_page||null}),id,l.line_id);
    }
  });
  tx(lines);
  return id;
}


// True if any LOCKED layout references this profile (protects immutable snapshots).
export function isProfileReferencedByLockedLayout(db, profileId) {
  const row = db.prepare('SELECT 1 FROM layouts WHERE profile_id = ? AND status = ? LIMIT 1').get(profileId, 'locked');
  return !!row;
}
