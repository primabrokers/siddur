// server/handlers.js
// HTTP endpoint handlers wiring store + engine.

import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';
import { sendJson } from './http.js';
import * as engine from '../engine/layout.js';
import { normalizeProfile } from '../engine/profile.js';
import { processSource, sectionBreakSummary } from '../engine/source.js';
import { validateLayout, validateLine, validateSpacingBounds } from '../engine/validate.js';
import { searchVerse } from '../engine/search.js';
import { compareProfiles } from '../engine/compare.js';
import { validateProfileInput, validateGeometryInput, validatePatternInput } from './validation.js';
import { wordWidth, totalWidth, interWordGap, interLetterGap } from '../engine/width.js';
import { lettersOf, letterKeyOf } from '../engine/profile.js';
import { countHebrewLetters } from '../engine/text.js';
import * as store from './store.js';
import { listBuiltinSources, loadBuiltinSource } from './builtin.js';
import { planBookStretch, stretchReport } from './stretch-book.js';
import { loadReferenceSource } from './reference.js';
import {fitMarginPlan,applyFitCopy} from './fit-margin.js';
import {effectiveProfile} from '../engine/stretch-policy.js';
import { moveWord } from '../engine/line-edit.js';
import { loadTefillinSource } from './tefillin-source.js';

// Strip internal engine fields for API lines. When a profile is supplied the
// server-authoritative stretch candidates (cap_mm/letter/word_final/line_end) are
// attached so the UI never derives caps from a different convention (F-10).
export function publicLine(l, profile) {
  const words = l.words || [];
  const shem_tokens = words.filter((w) => w.isShem).map((w) => ({
    token: w.text,
    uncertain: !!(w.shem && w.shem.uncertain),
    canonical: (w.shem && w.shem.canonical) || null,
    amud: l.amud, line_index: l.line_index,
    ref: (w.verse) || (l.verse_refs && l.verse_refs[0]) || null,
  }));
  const out = {
    line_id: l.line_id, line_key: l.line_key || null, line_index: l.line_index, amud: l.amud, line_in_amud: l.line_in_amud,
    tokens: l.tokens, text: l.text, consonant_text: l.consonant_text,
    width_mm: l.width_mm, leftover_mm: l.leftover_mm, base_leftover_mm: l.base_leftover_mm != null ? l.base_leftover_mm : l.leftover_mm,
    stretched_width_mm: l.stretched_width_mm != null ? l.stretched_width_mm : l.width_mm,
    stretch_decisions: l.stretch_decisions || [], letter_occurrence_ids: l.letter_occurrence_ids,
    shem: !!l.shem, uncertain_shem: !!l.uncertain_shem,
    first_word: l.first_word, last_word: l.last_word, verse_refs: l.verse_refs || [],
    status: l.status || 'pending', has_setuma: !!l.has_setuma, petucha_end: !!l.petucha_end,
    setuma_at_edge: !!l.setuma_at_edge, setuma_stretch_enabled: !!profile?.stretch_policy,
    sefer_end: !!l.sefer_end, fixed_pattern: !!l.fixed_pattern,
    spacing_metadata_complete: !!l.spacing_metadata_complete,
    reference_page: l.reference_page || null,
    column_width_mm: l.column_width_mm || null, song_layout: l.song_layout || null, tefillin_section: l.tefillin_section || null,
    words: words.map((w) => ({
      text: w.text, consonant: w.consonant, isShem: !!w.isShem, uncertain: !!w.uncertain,
      shem: w.shem || null, letters: (w.letters || []).map((lt) => {
        const override = (w.override || []).find(o => o.id === lt.id);
        let width = override ? Number(override.mm) : profile ? totalWidth(lt.base, profile) : Number(lt.width_mm);
        if (!override && lt.stam_letter_mark?.type === 'large') width *= 1.5;
        if (!override && lt.stam_letter_mark?.type === 'small') width *= profile?.small_letter_scale ?? 0.5;
        return { id: lt.id, base: lt.base, holy: !!lt.holy, stam_letter_mark: lt.stam_letter_mark || null,
          width_mm: width };
      }),
      width_mm: w.width_mm, override: w.override || [],
    })),
    items: (l.items || []).map((it) => ({ type: it.type, width_mm: it.width_mm, verse: it.verse })),
    shem_tokens,
    inter_letter_gap_mm: profile ? interLetterGap(profile) : undefined,
    inter_word_gap_mm: profile ? interWordGap(profile) : undefined,
  };
  if (profile && !l.fixed_pattern) {
    try {
      out.stretch_candidates = engine.stretchCandidatesOf(l, profile);
    } catch (e) { out.stretch_candidates = []; }
  }
  return out;
}

function getEngineSource(db, sourceId) {
  const s = store.getSource(db, sourceId);
  if (!s) throw new HttpError(404, 'source not found');
  return {
    name: s.name, tradition: s.tradition, revision_hash: s.revision_hash,
    excerpt: s.excerpt, partial_corpus: !!s.partial_corpus, label: s.label, source_label: s.source_label,
    verses: s.verses || [], unusual_letters: s.unusual_letters || [],
    format: s.format,
    tefillin: s.format === 'tefillin' ? s.canonical?.tefillin : null,
    reference: s.format==='tikkun-reference' && s.canonical ? s.canonical.reference : null,
  };
}

// F-25/F-26: the edit UI posts per-occurrence width/type overrides in the layout
// annotations; merge them onto the source's unusual_letters (keyed by occurrence_id)
// so a recompute reflects the sofer's edits without re-importing the source.
export function mergeUnusualOverrides(base, overrides) {
  const out = (base || []).map((u) => ({ ...u }));
  for (const ov of overrides || []) {
    const key = ov && ov.occurrence_id != null ? String(ov.occurrence_id) : null;
    if (key == null) continue;
    const hit = out.find((u) => u.occurrence_id != null && String(u.occurrence_id) === key);
    if (hit) {
      if (ov.width_override_mm != null) hit.width_override_mm = Number(ov.width_override_mm);
      if (ov.type != null) hit.type = ov.type;
      if (ov.letter != null) hit.letter = ov.letter;
      if (ov.ref != null) hit.ref = ov.ref;
    } else {
      out.push({
        occurrence_id: key, type: ov.type || 'large', letter: ov.letter || null, ref: ov.ref || null,
        width_override_mm: ov.width_override_mm != null ? Number(ov.width_override_mm) : null,
      });
    }
  }
  return out;
}

// ---- session & health -----------------------------------------------------

export function handleSession(ctx) {
  const { getSessionToken, } = ctx.security;
  const token = getSessionToken();
  sendJson(ctx.res, 200, { token }, { 'X-Sofer-Token': token });
}

export function handleHealth(ctx) {
  sendJson(ctx.res, 200, { status: 'ok', db: true, version: '1.0.0' });
}

// ---- sources --------------------------------------------------------------

export function handleListSources(ctx) {
  sendJson(ctx.res, 200, store.listSources(ctx.db));
}

export function handleGetSource(ctx) {
  const s = store.getSource(ctx.db, ctx.params.id);
  if (!s) throw new HttpError(404, 'source not found');
  sendJson(ctx.res, 200, {
    id: s.id, name: s.name, tradition: s.tradition, revision_hash: s.revision_hash,
    excerpt: s.excerpt, partial_corpus: !!s.partial_corpus, label: s.label, source_label: s.source_label,
    book_count: s.book_count, verse_count: s.verse_count, letter_count: s.letter_count,
    has_qere_ketiv: !!s.has_qere_ketiv,
    section_breaks: sectionBreakSummary(s.verses),
    reference: s.format==='tikkun-reference' && s.canonical ? (({lines,...provenance})=>provenance)(s.canonical.reference) : null,
    unusual_letters: (s.unusual_letters || []).map((u) => ({
      id: u.id || null, ref: u.ref, letter: u.letter, type: u.type || 'large',
      occurrence_id: u.occurrence_id || null,
      occurrence_index: u.occurrence_index != null ? u.occurrence_index : null,
      width_override_mm: u.width_override_mm,
    })),
  });
}

export function handleListBuiltinSources(ctx) {
  sendJson(ctx.res, 200, listBuiltinSources());
}

export function handleImportSource(ctx) {
  const body = ctx.body;
  if (body?.builtin === 'tefillin') {
    const doc = loadTefillinSource(), id = store.insertSource(ctx.db, doc);
    return sendJson(ctx.res, 200, { id, name: doc.name, letter_count: doc.letter_count, warnings: doc.warnings });
  }
  if(body && typeof body.builtin==='string' && body.builtin.startsWith('tikkun:')) {
    let doc;
    try {doc=loadReferenceSource(body.builtin.slice(7));}catch(e){throw new HttpError(400,e.message);}
    const id=store.insertSource(ctx.db,doc);
    return sendJson(ctx.res,200,{id,name:doc.name,letter_count:doc.letter_count,word_count:doc.word_count,verse_count:doc.verse_count,
      section_breaks:sectionBreakSummary(doc.verses),reference:true,warnings:doc.warnings});
  }
  // Built-in import: load a pinned Sefaria v3 study-text book from disk.
  if (body && typeof body.builtin === 'string' && body.builtin) {
    const built = loadBuiltinSource(body.builtin);
    let doc;
    try {
      doc = processSource({
        name: body.name || built.name, tradition: body.tradition || 'Sefaria Tanach with Text Only',
        text: built.raw, format: 'sefaria',
        label: body.label || ('study text: ' + built.book + ' (not a certified scribal corpus)'),
        unusual_letters: body.unusual_letters || [], shem_overrides: body.shem_overrides,
      });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const id = store.insertSource(ctx.db, doc);
    return sendJson(ctx.res, 200, {
      id, name: doc.name, tradition: doc.tradition, revision_hash: doc.revision_hash,
      book_count: doc.book_count, verse_count: doc.verse_count, letter_count: doc.letter_count,
      word_count: doc.word_count, excerpt: doc.excerpt, partial_corpus: !!doc.partial_corpus, source_label: doc.source_label, warnings: doc.warnings,
      section_breaks: sectionBreakSummary(doc.verses),
    });
  }
  if (!body || typeof body.text === 'undefined') throw new HttpError(400, 'text is required');
  if (!['txt', 'json', 'sefaria'].includes(String(body.format || 'txt'))) {
    // allow unknown -> txt
  }
  let doc;
  try {
    doc = processSource({
      name: body.name, tradition: body.tradition, text: body.text,
      format: body.format || 'txt', label: body.label, unusual_letters: body.unusual_letters || [],
      shem_overrides: body.shem_overrides,
    });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const id = store.insertSource(ctx.db, doc);
  sendJson(ctx.res, 200, {
    id, name: doc.name, tradition: doc.tradition, revision_hash: doc.revision_hash,
    book_count: doc.book_count, verse_count: doc.verse_count, letter_count: doc.letter_count,
    word_count: doc.word_count, excerpt: doc.excerpt, partial_corpus: !!doc.partial_corpus, source_label: doc.source_label, warnings: doc.warnings,
    section_breaks: sectionBreakSummary(doc.verses),
  });
}

// ---- profiles -------------------------------------------------------------

export function handleListProfiles(ctx) {
  sendJson(ctx.res, 200, store.listProfiles(ctx.db));
}

export function handleCreateProfile(ctx) {
  const errs = validateProfileInput(ctx.body || {});
  if (errs.length) throw new HttpError(400, errs.join('; '));
  const p = store.insertProfile(ctx.db, ctx.body || {});
  sendJson(ctx.res, 200, p);
}

export function handleImportProfile(ctx) {
  const errs = validateProfileInput(ctx.body || {});
  if (errs.length) throw new HttpError(400, errs.join('; '));
  const p = store.insertProfile(ctx.db, ctx.body || {});
  sendJson(ctx.res, 200, p);
}

export function handleGetProfile(ctx) {
  const p = store.getProfile(ctx.db, ctx.params.id);
  if (!p) throw new HttpError(404, 'profile not found');
  sendJson(ctx.res, 200, p);
}

export function handleExportProfile(ctx) {
  const p = store.getProfile(ctx.db, ctx.params.id);
  if (!p) throw new HttpError(404, 'profile not found');
  sendJson(ctx.res, 200, p, { 'Content-Disposition': 'attachment; filename="profile-' + ctx.params.id + '.json"' });
}

export function handleUpdateProfile(ctx) {
  // F-23: a profile referenced by a LOCKED layout is immutable (its snapshot is frozen).
  if (store.isProfileReferencedByLockedLayout(ctx.db, ctx.params.id)) {
    throw new HttpError(409, 'profile is referenced by a locked layout');
  }
  const errs = validateProfileInput(ctx.body || {});
  if (errs.length) throw new HttpError(400, errs.join('; '));
  const p = store.updateProfile(ctx.db, ctx.params.id, ctx.body || {});
  if (!p) throw new HttpError(404, 'profile not found');
  sendJson(ctx.res, 200, p);
}

export function handleDeleteProfile(ctx) {
  if (store.isProfileReferencedByLockedLayout(ctx.db, ctx.params.id)) {
    throw new HttpError(409, 'profile is referenced by a locked layout');
  }
  if (!store.deleteProfile(ctx.db, ctx.params.id)) throw new HttpError(404, 'profile not found');
  sendJson(ctx.res, 200, { ok: true });
}

export function handleDuplicateProfile(ctx) {
  const p = store.getProfile(ctx.db, ctx.params.id);
  if (!p) throw new HttpError(404, 'profile not found');
  const copy = store.insertProfile(ctx.db, { ...p, id: null, name: (ctx.body && ctx.body.name) || (p.name + ' (copy)') });
  sendJson(ctx.res, 200, copy);
}

// ---- geometries -----------------------------------------------------------

export function handleListGeometries(ctx) {
  sendJson(ctx.res, 200, store.listGeometries(ctx.db));
}

export function handleCreateGeometry(ctx) {
  const errs = validateGeometryInput(ctx.body || {});
  if (errs.length) throw new HttpError(400, errs.join('; '));
  const g = store.insertGeometry(ctx.db, ctx.body || {});
  sendJson(ctx.res, 200, g);
}

export function handleGetGeometry(ctx) {
  const g = store.getGeometry(ctx.db, ctx.params.id);
  if (!g) throw new HttpError(404, 'geometry not found');
  sendJson(ctx.res, 200, g);
}

// ---- patterns -------------------------------------------------------------

export function handleListPatterns(ctx) {
  sendJson(ctx.res, 200, store.listPatterns(ctx.db));
}

export function handleCreatePattern(ctx) {
  const body = ctx.body || {};
  if (!body.passage_name || !body.scheme_name) throw new HttpError(400, 'passage_name and scheme_name required');
  if (!Array.isArray(body.slots)) throw new HttpError(400, 'slots must be an array');
  const errs = validatePatternInput(body);
  if (errs.length) throw new HttpError(400, errs.join('; '));
  const p = store.insertPattern(ctx.db, body);
  sendJson(ctx.res, 200, p);
}

export function handleGetPattern(ctx) {
  const p = store.getPattern(ctx.db, ctx.params.id);
  if (!p) throw new HttpError(404, 'pattern not found');
  sendJson(ctx.res, 200, p);
}

// ---- layout compute -------------------------------------------------------

export async function handleComputeLayout(ctx) {
  const body = ctx.body || {};
  const source = getEngineSource(ctx.db, body.source_id);
  let profile = store.getProfile(ctx.db, body.profile_id);
  if (!profile) throw new HttpError(404, 'profile not found');
  const geometry = store.getGeometry(ctx.db, body.geometry_id);
  if (!geometry) throw new HttpError(404, 'geometry not found');
  profile = effectiveProfile(profile, geometry);

  const patternDefs = (body.pattern_ids || []).map((id) => store.getPattern(ctx.db, id)).filter(Boolean);
  const annotations = body.annotations || {};
  // F-25/F-26: merge posted unusual-letter overrides into the effective source.
  if (Array.isArray(annotations.unusual_letters) && annotations.unusual_letters.length) {
    source.unusual_letters = mergeUnusualOverrides(source.unusual_letters, annotations.unusual_letters);
  }
  // F-02: explicit recorded opt-in for study-only previews of a known special passage.
  const studyPreview = body.study_preview === true;

  // Fail-closed on missing authoritative fixed-passage data (unless study preview).
  const { blockers } = source.reference ? {blockers:[]} : engine.resolvePatternsForSource(source, patternDefs, annotations);
  if (blockers.length && !studyPreview) {
    throw new HttpError(422, 'pattern data blocker: ' + blockers.map((b) => b.reason).join('; '));
  }

  // F-16: optional poll mode returns a job id immediately and streams real
  // {processed,total} progress via GET /api/layout/compute-job/:id. The UI uses
  // this for large corpora so the button shows real progress, not "Computing…".
  if (body.poll === true) {
    const jobId = startComputeJob();
    const cfg = { source, profile, geometry, patternDefs, annotations, studyPreview, body, jobId, db: ctx.db };
    computeJobs.get(jobId).promise = runComputeJob(cfg);
    return sendJson(ctx.res, 200, { job_id: jobId, status: 'running' });
  }

  let progress = null;
  let computed;
  try {
    computed = await engine.computeLayoutAsync(source, profile, geometry, {
      patterns: patternDefs,
      annotations,
      study_preview: studyPreview,
      onProgress: (p) => { progress = p; },
      progressChunk: 512,
    });
  } catch (e) {
    // F-36: engine validation throws (geometry overlap, pattern coverage, etc.) are
    // actionable user-input errors -> 422, not a 500 with a stack trace.
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, e.message);
  }
  applyInitialStretch(computed, profile);
  const validation = validateLayout(computed.lines, profile, geometry);

  const layoutId = store.saveLayout(ctx.db, {
    name: body.name || null,
    source_id: body.source_id, profile_id: body.profile_id, geometry_id: body.geometry_id,
    pattern_ids: body.pattern_ids || [], annotations,
    source_hash: source.revision_hash,
    profile_snapshot: profile, geometry_snapshot: geometry, validation,
  }, computed);

  sendJson(ctx.res, 200, {
    layout_id: layoutId,
    status: 'draft',
    lines: computed.lines.map((l) => publicLine(l, profile)),
    amud_annotations: computed.amud_annotations,
    vavei_flagged: computed.vavei_flagged,
    summary: computed.summary,
    geometry: computed.geometry,
    validation,
    study_preview: studyPreview,
    progress,
  });
}

// ---- compute progress jobs (F-16) -----------------------------------------

const computeJobs = new Map();
const MAX_COMPUTE_JOBS = 64;

export function startComputeJob() {
  const jobId = randomUUID();
  computeJobs.set(jobId, { status: 'running', processed: 0, total: 0, phase: 'fitting', promise: null });
  // Bounded in-memory registry: drop the oldest completed/error jobs past the cap.
  if (computeJobs.size > MAX_COMPUTE_JOBS) {
    for (const [k, v] of computeJobs) {
      if (computeJobs.size <= MAX_COMPUTE_JOBS) break;
      if (v.status === 'done' || v.status === 'error') computeJobs.delete(k);
    }
  }
  return jobId;
}

async function runComputeJob(cfg) {
  const { jobId, source, profile, geometry, patternDefs, annotations, studyPreview, body, db } = cfg;
  try {
    const computed = await engine.computeLayoutAsync(source, profile, geometry, {
      patterns: patternDefs,
      annotations,
      study_preview: studyPreview,
      onProgress: (p) => {
        const j = computeJobs.get(jobId);
        if (j) { j.processed = p.processed; j.total = p.total; j.phase = p.phase; }
      },
      progressChunk: 512,
    });
    applyInitialStretch(computed, profile);
    const validation = validateLayout(computed.lines, profile, geometry);
    const layoutId = store.saveLayout(db, {
      name: body.name || null,
      source_id: body.source_id, profile_id: body.profile_id, geometry_id: body.geometry_id,
      pattern_ids: body.pattern_ids || [], annotations,
      source_hash: source.revision_hash,
      profile_snapshot: profile, geometry_snapshot: geometry, validation,
    }, computed);
    const j = computeJobs.get(jobId);
    if (j) {
      j.status = 'done';
      j.layout_id = layoutId;
      j.summary = computed.summary;
      j.study_preview = studyPreview;
    }
  } catch (e) {
    const j = computeJobs.get(jobId);
    if (j) { j.status = 'error'; j.error = (e && e.message) ? String(e.message) : String(e); }
  }
}

function applyInitialStretch(computed, profile) {
  if (profile?.stretch_policy?.version !== 2 || !computed?.lines) return;
  for (const line of computed.lines) {
    const suggestion = engine.autoSuggestLine(line, profile);
    if (!suggestion.suggestions.length) continue;
    engine.applyStretch(line, suggestion.suggestions, profile);
  }
  computed.summary ||= {};
  computed.summary.auto_stretched_on_compute = true;
  computed.summary.auto_stretched_lines = computed.lines.filter((line) => (line.stretch_decisions || []).length).length;
}

export function handleComputeJob(ctx) {
  const job = computeJobs.get(ctx.params.id);
  if (!job) throw new HttpError(404, 'compute job not found');
  if (job.status === 'running') {
    return sendJson(ctx.res, 200, { status: 'running', processed: job.processed, total: job.total, phase: job.phase });
  }
  if (job.status === 'error') {
    return sendJson(ctx.res, 200, { status: 'error', error: job.error });
  }
  sendJson(ctx.res, 200, {
    status: 'done', processed: job.processed, total: job.total, phase: job.phase,
    layout_id: job.layout_id, summary: job.summary, study_preview: !!job.study_preview,
  });
}

// ---- layouts --------------------------------------------------------------

export function handleListLayouts(ctx) {
  sendJson(ctx.res, 200, store.listLayouts(ctx.db));
}

export function handleDeleteLayout(ctx) {
  if (!store.deleteLayout(ctx.db, ctx.params.id)) throw new HttpError(404, 'layout not found');
  sendJson(ctx.res, 200, { ok: true });
}

export function handleMoveWord(ctx) {
  const layout = store.getLayout(ctx.db, ctx.params.id);
  if (!layout) throw new HttpError(404, 'layout not found');
  let result;
  try { result = moveWord(layout, ctx.body || {}); }
  catch (error) { throw new HttpError(409, error.message); }
  store.saveEditedLines(ctx.db, layout.id, result.changed, result.summary, result.validation);
  sendJson(ctx.res, 200, { ok: true, changed_lines: result.changed.map(line => publicLine(line, layout.snapshot.profile)) });
}

export function handleGetLayout(ctx) {
  const q = ctx.query || {};
  const hasPage = q.from != null || q.limit != null;
  const from = q.from != null ? Math.max(0, parseInt(q.from, 10) || 0) : 0;
  const limit = q.limit != null ? Math.min(1000,Math.max(1,parseInt(q.limit,10)||1)) : 500;
  const l = store.getLayout(ctx.db, ctx.params.id, hasPage ? {from,limit} : null);
  if (!l) throw new HttpError(404, 'layout not found');
  // N-02: load the SNAPSHOT profile and map every line through publicLine so the
  // canonical response carries stretch_candidates (absolute cap_mm) and the
  // sanitised shape — never raw store rows (which would leak the internal row id
  // and omit the candidates the manual-stretch UI depends on).
  let profile = null;
  try { profile = l.snapshot && l.snapshot.profile ? l.snapshot.profile : null; } catch (e) { profile = null; }
  if (!profile) profile = store.getProfile(ctx.db, l.profile_id);
  const totalLines = l.total_lines;
  // F-16: lazy/paginated line fetch so a full-Torah layout never blocks the UI.
  const rawLines = l.lines;
  const lines = rawLines.map((ln) => publicLine(ln, profile));
  const amudAnnots = annotateFromLines(rawLines);
  const out = { ...l, lines, amud_annotations: amudAnnots, total_lines: totalLines };
  // F-27: expose the snapshot geometry so a loaded layout's preview never falls
  // back to the live geometry selector (which would reflow a locked layout).
  if (l.snapshot && l.snapshot.geometry) out.geometry = l.snapshot.geometry;
  if (hasPage) { out.from = from; out.limit = limit; out.has_more = from + limit < totalLines; }
  sendJson(ctx.res, 200, out);
}

function annotateFromLines(lines) {
  const map = new Map();
  for (const l of lines) {
    if (!map.has(l.amud)) map.set(l.amud, { amud: l.amud, first_word: l.first_word || '', begins_with_vav: startsWithVavText(l.first_word || '') });
  }
  return Array.from(map.values()).map((a) => ({ ...a, vav_flag: !a.begins_with_vav }));
}

function startsWithVavText(word) {
  const ls = lettersOf(word);
  return ls.length > 0 && letterKeyOf(ls[0]) === 'ו';
}

export function handleLockLayout(ctx) {
  const l = store.lockLayout(ctx.db, ctx.params.id);
  if (!l) throw new HttpError(404, 'layout not found');
  sendJson(ctx.res, 200, { id: l.id, status: 'locked', locked_at: l.locked_at });
}

export function handleProgress(ctx) {
  const lid = ctx.params.id;
  // Locked layouts allow progress updates; draft layouts too.
  const body = ctx.body || {};
  const st = body.status;
  if (!['written', 'checked', 'proofread'].includes(st)) throw new HttpError(400, 'invalid status');
  const row = store.getLayoutRow(ctx.db, lid);
  if (!row) throw new HttpError(404, 'layout not found');
  // F-31: the first "written" locks the whole layout — require an explicit
  // confirmation flag (lock:true) so the irreversible transition is never silent.
  const willLock = st === 'written' && row.status !== 'locked';
  if (willLock && body.lock !== true) {
    throw new HttpError(409, 'marking a line written locks the layout — send lock:true to confirm');
  }
  // Progress is keyed on content-derived line_key when supplied (stable across
  // layouts), falling back to positional line_id/amud for display-only updates.
  const changes = store.updateLineProgress(ctx.db, lid, { line_id: body.line_id, line_key: body.line_key, amud: body.amud, status: st });
  if (willLock) store.lockLayout(ctx.db, lid);
  sendJson(ctx.res, 200, { ok: true, locked: willLock, progress: { updated: changes, status: st } });
}

// ---- stretch / justify ----------------------------------------------------

// F-04: load the PERSISTED line and the layout's SNAPSHOT profile (never the live
// profile/geometry) so a stretch edit never reflows or throws on a later profile
// change. Patterns are preserved because we do not recompute at all.
function loadLineWithSnapshotProfile(ctx, layoutId, lineId) {
  const l = store.getLayoutRow(ctx.db, layoutId);
  if (!l) throw new HttpError(404, 'layout not found');
  let profile = null;
  try { profile = l.profile_snapshot ? JSON.parse(l.profile_snapshot) : null; } catch (e) { profile = null; }
  if (!profile) profile = store.getProfile(ctx.db, l.profile_id);
  if (!profile) throw new HttpError(404, 'layout dependencies missing');
  const line = store.getLayoutLines(ctx.db, layoutId).find((x) => x.line_id === lineId);
  if (!line) throw new HttpError(404, 'line not found');
  return { line, profile };
}

export function handleStretch(ctx) {
  const lid = ctx.params.id;
  if (store.isLocked(ctx.db, lid)) throw new HttpError(409, 'layout is locked; stretch edits are frozen');
  const body = ctx.body || {};
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  const { line, profile } = loadLineWithSnapshotProfile(ctx, lid, body.line_id);

  // applyStretch aggregates duplicate decisions per occurrence, enforces the hard
  // cap, Shem/non-stretchable/position filters, the total-leftover cap (F-01), and
  // fails ATOMICALLY on any violation.
  let result;
  try {
    result = engine.applyStretch(line, decisions, profile);
  } catch (e) {
    throw new HttpError(409, e.atomic ? 'stretch rejected: ' + e.message.replace(/^stretch rejected: /, '') : e.message);
  }
  // Persist decisions + leftover + stretched width.
  store.saveStretch(ctx.db, lid, body.line_id, result.decisions, result.leftover_mm, line.stretched_width_mm);
  sendJson(ctx.res, 200, { ok: true, line: publicLine(line, profile), warnings: result.warnings });
}

export function handleAutoSuggest(ctx) {
  const lid = ctx.params.id;
  if (store.isLocked(ctx.db, lid)) throw new HttpError(409, 'layout is locked');
  const body = ctx.body || {};
  const { line, profile } = loadLineWithSnapshotProfile(ctx, lid, body.line_id);
  const r = engine.autoSuggestLine(line, profile);
  sendJson(ctx.res, 200, { ok: true, suggestions: r.suggestions, unjustifiable: !!r.unjustifiable, shortfall_mm: r.shortfall_mm });
}

export function handleStretchBook(ctx) {
  const lid = ctx.params.id;
  const body = ctx.body || {};
  if (!['preview', 'apply'].includes(body.action)) throw new HttpError(400, 'action must be preview or apply');
  // One transaction protects the exact snapshot from a concurrent lock or edit.
  const result = ctx.db.transaction(() => {
    const row = store.getLayoutRow(ctx.db, lid);
    if (!row) throw new HttpError(404, 'layout not found');
    if (row.status === 'locked') throw new HttpError(409, 'layout is locked; compute a new draft before stretching');
    const profile = JSON.parse(row.profile_snapshot);
    const lines = store.getLayoutLines(ctx.db, lid);
    if (lines.length > 20000) throw new HttpError(422, 'Load one book at a time for this batch');
    const plan = planBookStretch(row, lines, profile);
    if (body.action === 'apply') {
      if (body.confirm !== true || body.revision !== plan.revision) throw new HttpError(409, 'Preview is missing or stale. Generate and review a new suggestion report first.');
      const lineById = new Map(lines.map(l => [l.line_id, l]));
      for (const proposed of plan.lines) {
        const line = lineById.get(proposed.line_id);
        const applied = engine.applyStretch(line, proposed.decisions, profile);
        store.saveStretch(ctx.db, lid, line.line_id, applied.decisions, applied.leftover_mm, line.stretched_width_mm);
      }
    }
    return {...plan, applied:body.action === 'apply'};
  }).immediate();
  sendJson(ctx.res, 200, result);
}

export function handleStretchReport(ctx) {
  const row = store.getLayoutRow(ctx.db, ctx.params.id);
  if (!row) throw new HttpError(404, 'layout not found');
  sendJson(ctx.res, 200, {layout_id:row.id, entries:stretchReport(store.getLayoutLines(ctx.db,row.id),JSON.parse(row.geometry_snapshot))});
}

export function handleFitMargin(ctx) {
  const body=ctx.body||{};
  if(!['preview','create'].includes(body.action))throw new HttpError(400,'action must be preview or create');
  const response=ctx.db.transaction(()=>{
    const row=store.getLayoutRow(ctx.db,ctx.params.id);
    if(!row)throw new HttpError(404,'layout not found');
    const lines=store.getLayoutLines(ctx.db,row.id);
    if(lines.length>20000)throw new HttpError(422,'Load one book at a time');
    const plan=fitMarginPlan(row,lines);
    const publicPlan={revision:plan.revision,changes:plan.changes,summary:plan.summary,issues:plan.issues};
    if(body.action==='preview')return publicPlan;
    if(body.confirm!==true||body.revision!==plan.revision)throw new HttpError(409,'Fit proposal is missing or stale. Review it again before creating a copy.');
    const geometry=JSON.parse(row.geometry_snapshot),summary=JSON.parse(row.summary||'{}');
    const profile=effectiveProfile(store.insertProfile(ctx.db,{...plan.profile,name:plan.profile.name+' — margin-fit review copy'}),geometry);
    applyFitCopy(lines,plan);
    summary.margin_fit={parent_layout_id:row.id,review_required:true,...publicPlan};
    const id=store.saveLayout(ctx.db,{name:'Margin-fit review copy',source_id:row.source_id,profile_id:profile.id,geometry_id:row.geometry_id,
      pattern_ids:JSON.parse(row.pattern_ids||'[]'),annotations:JSON.parse(row.annotations||'{}'),source_hash:row.source_hash,
      profile_snapshot:profile,geometry_snapshot:geometry,validation:validateLayout(lines,profile,geometry)}, {lines,summary});
    return {...publicPlan,layout_id:id,profile_id:profile.id,source_id:row.source_id,geometry_id:row.geometry_id,parent_unchanged:true};
  }).immediate();
  sendJson(ctx.res,200,response);
}

// ---- candidate / diff / adopt --------------------------------------------

export async function handleCreateCandidate(ctx) {
  const lid = ctx.params.id;
  const parent = store.getLayoutRow(ctx.db, lid);
  if (!parent) throw new HttpError(404, 'layout not found');
  if (parent.status !== 'locked') throw new HttpError(409, 'layout must be locked to create a candidate');
  const body = ctx.body || {};
  let profile = store.getProfile(ctx.db, body.profile_id);
  const geometry = store.getGeometry(ctx.db, body.geometry_id);
  if (!profile) throw new HttpError(404, 'profile not found');
  if (!geometry) throw new HttpError(404, 'geometry not found');
  profile = effectiveProfile(profile, geometry);

  const source = getEngineSource(ctx.db, parent.source_id);
  // Carry forward the parent's pattern_ids/annotations so a patterned locked layout
  // is regenerated with its fixed scheme, never silently re-wrapped.
  const patternIds = parent.pattern_ids ? JSON.parse(parent.pattern_ids) : [];
  const annotations = parent.annotations ? JSON.parse(parent.annotations) : {};
  if (Array.isArray(annotations.unusual_letters) && annotations.unusual_letters.length) {
    source.unusual_letters = mergeUnusualOverrides(source.unusual_letters, annotations.unusual_letters);
  }
  const patternDefs = patternIds.map((id) => store.getPattern(ctx.db, id)).filter(Boolean);
  let computed;
  try {
    computed = await engine.computeLayoutAsync(source, profile, geometry, { patterns: patternDefs, annotations });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, e.message);
  }
  if (geometry.tefillin) applyInitialStretch(computed, profile);
  const parentLines = store.getLayoutLines(ctx.db, lid).map((l) => publicLine(l));
  const newLines = computed.lines.map((l) => publicLine(l, profile));
  const diff = computeLineDiff(parentLines, newLines);

  const candidateId = store.saveCandidate(ctx.db, lid, {
    profile_id: profile.id, geometry_id: geometry.id, source_id: parent.source_id,
    diff, lines_snapshot: newLines,
    summary: computed.summary,
    validation: validateLayout(computed.lines, profile, geometry),
    pattern_ids: patternIds, annotations,
  });
  sendJson(ctx.res, 200, { candidate_id: candidateId, diff });
}

const MEASURE_TOL = 1e-6;

function measurementDeltas(o, n) {
  const deltas = [];
  const cmp = (field, a, b) => {
    if (Math.abs((Number(a) || 0) - (Number(b) || 0)) > MEASURE_TOL) deltas.push({ field, from: a, to: b });
  };
  cmp('width_mm', o.width_mm, n.width_mm);
  cmp('leftover_mm', o.leftover_mm, n.leftover_mm);
  cmp('base_leftover_mm', o.base_leftover_mm, n.base_leftover_mm);
  cmp('column_width_mm', o.column_width_mm, n.column_width_mm);
  cmp('tefillin_section', o.tefillin_section, n.tefillin_section);
  const os=o.song_layout?.segments||[], ns=n.song_layout?.segments||[];
  for(let i=0;i<Math.max(os.length,ns.length);i++){
    cmp('song_part_'+(i+1)+'_start_mm',os[i]?.start_mm,ns[i]?.start_mm);
    cmp('song_part_'+(i+1)+'_width_mm',os[i]?.width_mm,ns[i]?.width_mm);
  }
  if(o.song_layout||n.song_layout){
    const old=new Map((o.stretch_decisions||[]).map(d=>[d.letter_occurrence_id,d.stretch_mm]));
    const next=new Map((n.stretch_decisions||[]).map(d=>[d.letter_occurrence_id,d.stretch_mm]));
    for(const id of new Set([...old.keys(),...next.keys()]))cmp('song_stretch_'+id,old.get(id),next.get(id));
  }
  const ow = o.words || []; const nw = n.words || [];
  const wlen = Math.max(ow.length, nw.length);
  for (let i = 0; i < wlen; i++) {
    cmp('word_' + i + '_width_mm', ow[i] ? ow[i].width_mm : null, nw[i] ? nw[i].width_mm : null);
  }
  return { changed: deltas.length > 0, deltas };
}

function computeLineDiff(oldLines, newLines) {
  const changes = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i]; const n = newLines[i];
    if (o && n) {
      if (o.line_id !== n.line_id || JSON.stringify(o.tokens) !== JSON.stringify(n.tokens)) {
        changes.push({ type: 'line_changed', line_index: i + 1, from: o ? o.tokens : null, to: n ? n.tokens : null });
        continue;
      }
      // F-21: identical boundaries but different measurement (e.g. a stroke change that
      // preserves word breaks) is surfaced explicitly as measurement_changed.
      const meas = measurementDeltas(o, n);
      if (meas.changed) {
        changes.push({ type: 'measurement_changed', line_index: i + 1, deltas: meas.deltas });
      }
    } else if (o && !n) {
      changes.push({ type: 'line_removed', line_index: i + 1, from: o.tokens, to: null });
    } else if (!o && n) {
      changes.push({ type: 'line_added', line_index: i + 1, from: null, to: n.tokens });
    }
  }
  return changes;
}

export function handleDiff(ctx) {
  const lid = ctx.params.id;
  const candidateId = (ctx.query && ctx.query.candidate_id) || null;
  const parent = store.getLayout(ctx.db, lid);
  if (!parent) throw new HttpError(404, 'layout not found');
  let cand;
  if (candidateId) cand = store.getCandidate(ctx.db, candidateId);
  else {
    const rows = ctx.db.prepare('SELECT id FROM candidates WHERE parent_layout_id=? ORDER BY created_at DESC LIMIT 1').all(lid);
    cand = rows.length ? store.getCandidate(ctx.db, rows[0].id) : null;
  }
  if (!cand) throw new HttpError(404, 'candidate not found');
  sendJson(ctx.res, 200, {
    locked: { id: parent.id, status: parent.status, lines: parent.lines.map(l => publicLine(l, parent.snapshot && parent.snapshot.profile)) },
    candidate: { id: cand.id, profile_id: cand.profile_id, geometry_id: cand.geometry_id, lines: cand.lines_snapshot },
    changes: cand.diff || [],
  });
}

// F-03: a line is "unchanged" only when its content AND measurement are identical
// within tolerance. Progress is carried exclusively for verified-unchanged lines that
// the SERVER re-checks against the parent — never on the client's word alone.
function lineUnchanged(parentLine, candLine) {
  if (!parentLine || !candLine) return false;
  if (parentLine.column_width_mm !== candLine.column_width_mm || parentLine.tefillin_section !== candLine.tefillin_section) return false;
  if (JSON.stringify(parentLine.song_layout || null) !== JSON.stringify(candLine.song_layout || null)) return false;
  if ((parentLine.song_layout || candLine.song_layout) && JSON.stringify(parentLine.stretch_decisions || []) !== JSON.stringify(candLine.stretch_decisions || [])) return false;
  if (JSON.stringify(parentLine.tokens || []) !== JSON.stringify(candLine.tokens || [])) return false;
  if (JSON.stringify(parentLine.letter_occurrence_ids || []) !== JSON.stringify(candLine.letter_occurrence_ids || [])) return false;
  const itemsGeo = (l) => (l.items || []).map((it) => ({ type: it.type, width_mm: it.width_mm }));
  if (JSON.stringify(itemsGeo(parentLine)) !== JSON.stringify(itemsGeo(candLine))) return false;
  const close = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 1e-6;
  if (!close(parentLine.width_mm, candLine.width_mm)) return false;
  if (!close(parentLine.leftover_mm, candLine.leftover_mm)) return false;
  if (!close(parentLine.base_leftover_mm, candLine.base_leftover_mm)) return false;
  const pw = parentLine.words || []; const cw = candLine.words || [];
  if (pw.length !== cw.length) return false;
  for (let i = 0; i < pw.length; i++) {
    if (!close(pw[i].width_mm, cw[i].width_mm)) return false;
  }
  return true;
}

export function handleAdoptCandidate(ctx) {
  const lid = ctx.params.id;
  const body = ctx.body || {};
  const cand = store.getCandidate(ctx.db, body.candidate_id);
  if (!cand) throw new HttpError(404, 'candidate not found');
  if (cand.parent_layout_id !== lid) throw new HttpError(400, 'candidate does not belong to this layout');

  const parent = store.getLayout(ctx.db, lid);
  if (!parent) throw new HttpError(404, 'layout not found');
  const claimed = new Set(body.verified_unchanged_lines || []);
  const parentById = new Map(parent.lines.map((l) => [l.line_id, l]));
  const refused = [];

  const newLines = (cand.lines_snapshot || []).map((l) => {
    const pl = parentById.get(l.line_id);
    if (claimed.has(l.line_id) && lineUnchanged(pl, l)) {
      return { ...l, status: pl.status };
    }
    if (claimed.has(l.line_id) && !lineUnchanged(pl, l)) {
      refused.push(l.line_id);
    }
    return { ...l, status: 'pending' };
  });

  // F-22: carry the candidate's computed summary/validation/pattern data forward.
  const newLayoutId = store.createLockedLayout(ctx.db, {
    source_id: cand.source_id, profile_id: cand.profile_id, geometry_id: cand.geometry_id,
    source_hash: getEngineSource(ctx.db, cand.source_id).revision_hash,
    profile_snapshot: effectiveProfile(store.getProfile(ctx.db, cand.profile_id), store.getGeometry(ctx.db, cand.geometry_id)), geometry_snapshot: store.getGeometry(ctx.db, cand.geometry_id),
    pattern_ids: cand.pattern_ids || [], annotations: cand.annotations || {},
    validation: cand.validation || null,
  }, newLines, cand.summary || {});

  sendJson(ctx.res, 200, {
    ok: true, new_layout_id: newLayoutId, refused_line_ids: refused,
    message: 'candidate adopted; only server-verified unchanged lines kept progress' + (refused.length ? ' (' + refused.length + ' claimed-unchanged line(s) refused: changed)' : ''),
  });
}

// ---- search / compare / validate -----------------------------------------

export function handleSearch(ctx) {
  const lid = ctx.params.id;
  const l = store.getLayoutRow(ctx.db, lid);
  if (!l) throw new HttpError(404, 'layout not found');
  const source = getEngineSource(ctx.db, l.source_id);
  const layout = { lines: store.getLayoutLines(ctx.db, lid) };
  const q = ctx.query && ctx.query.q ? ctx.query.q : '';
  sendJson(ctx.res, 200, searchVerse(source, layout, q));
}

export async function handleCompare(ctx) {
  const body = ctx.body || {};
  const source = getEngineSource(ctx.db, body.source_id);
  const geometry = store.getGeometry(ctx.db, body.geometry_id);
  if (!geometry) throw new HttpError(404, 'geometry not found');
  const ids = Array.isArray(body.profile_ids) ? body.profile_ids : [];
  if (ids.length < 2 || ids.length > 3) throw new HttpError(400, 'profile_ids must contain 2-3 profiles');
  const profiles = ids.map((id) => store.getProfile(ctx.db, id));
  if (profiles.some((p) => !p)) throw new HttpError(404, 'profile not found');
  const result = await compareProfiles(source, geometry, profiles);
  sendJson(ctx.res, 200, result);
}

export function handleValidateLine(ctx) {
  const body = ctx.body || {};
  const tokens = Array.isArray(body.tokens) ? body.tokens : [];
  let profile = store.getProfile(ctx.db, body.profile_id);
  const geometry = store.getGeometry(ctx.db, body.geometry_id);
  if (!profile) throw new HttpError(404, 'profile not found');
  if (!geometry) throw new HttpError(404, 'geometry not found');
  profile = effectiveProfile(profile, geometry);

  const line = buildTemporaryLine(tokens, profile, geometry);
  const lineV = validateLine(line, profile, geometry);
  const bounds = validateSpacingBounds(profile, geometry);
  const valid = lineV.valid && bounds.length === 0;
  sendJson(ctx.res, 200, { valid, errors: [...bounds, ...lineV.errors], warnings: lineV.warnings });
}

function buildTemporaryLine(tokens, profile, geometry) {
  const words = tokens.map((t, i) => {
    const ls = lettersOf(t).map((g, li) => ({ id: 'tmp-' + i + '-' + li, base: letterKeyOf(g), grapheme: g }));
    return { text: t, isShem: false, letters: ls, width_mm: wordWidth(t, profile) };
  });
  const width = tokens.length
    ? tokens.reduce((s, t) => s + wordWidth(t, profile), 0) + (tokens.length - 1) * interWordGap(profile)
    : 0;
  const lineW = Number(geometry.line_width_mm);
  return {
    words, tokens, text: tokens.join(' '), consonant_text: tokens.join(' '),
    width_mm: round3(width), leftover_mm: round3(lineW - width),
    has_setuma: false, setuma_at_edge: false, petucha_end: false, fixed_pattern: false,
    stretch_decisions: [], letter_occurrence_ids: words.flatMap((w) => w.letters.map((l) => l.id)),
  };
}

// ---- export ---------------------------------------------------------------

export function handleExport(ctx) {
  const lid = ctx.params.id;
  const l = store.getLayout(ctx.db, lid);
  if (!l) throw new HttpError(404, 'layout not found');
  // F-02 residual: a study-preview layout (a known special passage rendered
  // without a verified pattern) is explicitly NOT writing-ready — refuse export
  // server-side rather than relying on the client to refuse.
  if (l.summary && l.summary.study_preview) {
    throw new HttpError(403, 'study preview layout is not writing-ready — export is disabled');
  }
  const fmt = (ctx.query && ctx.query.format) || 'json';
  const measured = { id: l.id, status: l.status, summary: l.summary, lines: l.lines.map(line => publicLine(line, l.snapshot && l.snapshot.profile)), snapshot: l.snapshot };
  if (fmt === 'csv') {
    const rows = [['amud', 'line', 'first_word', 'last_word', 'text', 'width_mm', 'leftover_mm', 'status']];
    for (const ln of measured.lines) {
      rows.push([ln.amud, ln.line_index, ln.first_word, ln.last_word, ln.text, ln.width_mm, ln.leftover_mm, ln.status]);
    }
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="layout-' + lid + '.csv"' });
    ctx.res.end('\ufeff' + csv);
    return;
  }
  if (fmt === 'pdf') {
    // F-17: PDF export is disabled — a faithful Hebrew PDF needs an embedded CID font
    // and measured pagination, neither of which is implemented. JSON/CSV and browser
    // print remain trustworthy; do not ship a malformed or Hebrew-less PDF.
    throw new HttpError(501, 'PDF export is disabled: faithful Hebrew rendering is not yet implemented. Use JSON/CSV export or browser print instead.');
  }
  sendJson(ctx.res, 200, measured);
}


function round3(x) {
  const e = 1000;
  return Math.round(x * e) / e;
}
