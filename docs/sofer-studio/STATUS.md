# Sofer Studio — Status Tracker

## Phase Progress

| Phase | Role | Model | Status | Started | Completed |
|---|---|---|---|---|---|
| 1. Plan & contracts | GLM 5.2 | fireworks/glm-5p2 | ✅ Complete | 2026-08-30 | 2026-08-30 |
| 2. Frontend design | Kimi K3 | fireworks/kimi-k3 | ✅ Complete (recovered) | 2026-08-30 | 2026-08-30 |
| 3. Implementation | DeepSeek V4 Pro | fireworks/deepseek-v4-pro-0813 | 🔄 In progress | 2026-08-30 | — |
| 4. Testing & validation | GLM 5.2 | fireworks/glm-5p2 | ⏳ Pending | — | — |
| 5. Independent review | Opus 5 | anthropic/claude-opus-5 | ⏳ Pending | — | — |
| 6. Final validation & commit | GLM 5.2 | fireworks/glm-5p2 | ⏳ Pending | — | — |

## Provider Route Correction

deepseek-official provider has MISSING_CREDENTIAL (verified from failed session session-d653ebc7).
Implementation uses **fireworks / accounts/fireworks/models/deepseek-v4-pro-0813** — same DeepSeek V4 Pro model on the Fireworks provider (credentials confirmed working via Kimi/GLM).

## Child Sessions

| Session | Model | Phase | Files Touched | Outcome |
|---|---|---|---|---|
| 5c7c7058 (Kimi) | fireworks/kimi-k3 | Design | docs/sofer-studio/design/DESIGN_SPEC.md, docs/sofer-studio/design/reference-mockup.html | ✅ Complete. HTML recovered from failed tool write (backtick escaping). SHA256: fd641f9c... Passes node --check. |

## Baseline Test Results (pre-new-code)

| Suite | Count | Pass | Fail | Notes |
|---|---|---|---|---|
| test/api.test.mjs | 26 | 26 | 0 | Pass |
| test/sync.test.mjs | 23 | 23 | 0 | Pass |
| test/store.test.mjs | — | — | — | Pre-existing failure at line 50: browser navigation destroys evaluation context. Not caused by new code. |

## Design Artifacts

- **DESIGN_SPEC.md** (21,905 bytes): Full 11-panel spec, color tokens, typography, layout grid, Sargel Rule signature, RTL handling, accessibility, responsive breakpoints.
- **reference-mockup.html** (72,503 bytes): Self-contained interactive mockup, SHA256 fd641f9cad424039da8b31a01d9dfaa8816f6e61df3faeb1f9262923b47d8c4f. Sample data labeled "SAMPLE".


## Kimi Reference QA (design-reference, not production verdict)

Observed in recovered reference HTML at desktop size. These are issues to fix in production implementation, not reasons to regenerate the mockup:

1. **Null element wiring:** `updateGuard` at line 748 throws `TypeError: Cannot set properties of null (setting 'textContent')` — missing/mismatched element. Production must fix element wiring; do not copy mockup JS blindly.
2. **Calibration fields overflow at 1250px:** Settings grid runs horizontally outside narrow sidebar. Production must use correct breakpoints and shrink the grid properly.
3. **Nib vs letter height warning:** Reference compares kav thickness to "minimum practical nib". Requirement is a configurable minimum practical **letter height** warning. Separate these concepts; don't warn against the wrong measurement.
4. **Only 22 letter rows:** Production must include all 27 Hebrew letters including 5 sofiyot (ך ם ן ף ץ), with editable unit widths and mm equivalents.
5. **42 lines shown as fixed:** Production must allow 42/48/60/custom lines per amud and calculate all totals from actual data.
6. **Sample data placeholders:** All sample totals, invented positions, reference annotations and locked sample state are design placeholders. Production must derive all displayed values from saved source/profile/layout data.

Keep Kimi's visual direction; fix functional issues during DeepSeek implementation.

## Controller Audit Findings (first implementation wave)

### PASS (confirmed by controller)
- Width fixture: 2.0mm ref skeleton at 3.0mm scales to 3.0mm at 4.5mm; +0.2 stroke = 3.2mm; +0.3 = 3.3mm; scale unchanged. PASS
- Threshold composition includes 2 word gaps. PASS
- Sheet geometry: 4×100mm columns, 3/sheet, 5mm gaps, 3mm outer = exact 0.422m; rounded 0.632m. PASS
- Layout compute returns 200; marking written locks layout; locked /stretch returns 409. PASS
- HTTP stretch replacement is idempotent (handler reconstructs base state). PASS
- All 54 self-authored tests pass. PASS

### FAIL (material — must fix via DeepSeek)
1. **Input validation:** POST /profiles with letter_height_mm=-3 returns 200. Reject negative/nonfinite/out-of-range for all physical inputs, all 27 letter widths, caps, gap bounds, geometry, pattern schemas. Do not coerce to defaults.
2. **Origin validation:** Origin:http://localhost:9999 returns 200. Origin:null returns 200. Must validate exact same-origin scheme/host/port. Token is additional, not permission to ignore contract.
3. **Non-stretchable serialization:** GET /profiles/:id/export returns non_stretchable:{} because internal Set serialized directly. Must be JSON array on ALL API/export/snapshot boundaries. Empty overrides must work without reintroducing defaults.
4. **Layout line data:** GET /layouts/:id lines lack words/items/letter measures and per-token Shem metadata. Must persist and restore full line data (words, items, Shem flags, occurrence IDs, stretch positions, pattern segments/annotations). Cannot reconstruct from changed global calibration.
5. **Stretch duplicate decisions:** Duplicate 1mm decisions for same letter with 1.5mm cap return 200. Must reject or aggregate per occurrence, enforce total cap atomically. Always recompute from immutable BASE width. Idempotent replacement. Unknown/Shem/overcap must fail atomically.
6. **Shem coverage:** Missing יה, אהיה, אלוה, suffixed forms (אלהיכם, אלהיהם, באלהיכם, ובאלהיכם). These omissions can expose Shem letters to stretching. Add per Yesodei HaTorah 6:2-4.
7. **Pattern integration:** computeLayout never calls resolvePatternsForSource or renderPattern. Known source ranges silently wrap. renderPattern drops positions/segments/gaps, adds trailing gap, words:[].
8. **Marker positioning:** buildWordUnits skips markers then emits only verse.after at end. "אב {ס} גד" produces items [אב, גד, setuma_gap] — boundary between words is wrong. setuma at start pushes gap with currentWidth=0.
9. **Unusual letter mapping:** processSource drops occurrence_index; resolveOverrides resets per word, matches all same-base occurrences. One selected occurrence must affect ONLY that occurrence via stable source ID. U+05C4/U+05C5 dots stripped in text.js before metadata extraction.
10. **Source object import:** Preserves only joined verse text as original/hash, losing structured refs/metadata. Must retain canonical complete object or reject object form.
11. **Chunked progress:** onProgress in synchronous loop does NOT yield event loop. Full ~305k workload must use worker or actual yielding. UI progress must be real, not animation.
12. **max_inter_word_gap:** 99mm against 1.2mm small letter produces no error. Must enforce configured max strictly below calibrated small-letter width.

### Source Data
- Pinned raw Sefaria v3 responses under docs/sofer-studio/source-data/{Genesis,Exodus,Leviticus,Numbers,Deuteronomy}.json + manifest.json
- 5,846 verses total. Raw Hebrew letter count 305,172 (includes ketiv+qere alternatives). Naive bracket removal yields 304,850 — NOT 304,805 and NOT a certified scribal corpus.
- Ketiv/Qere present as bracketed alternatives: "הוצא [היצ]". Removing punctuation and including both is WRONG for written Torah.
- Must preserve raw originals. Preview-only ketiv policy could drop bracketed qere with recorded normalization. Unresolved variants, missing metadata = visible blockers.



## Repair Wave Results

### First Repair (all CRITICAL + most MAJOR)
- All 13 CRITICAL findings fixed and tested
- Most MAJOR findings fixed
- 103 tests across 6 files, all passing

### Second Repair (remaining MAJOR + MINOR)
- F-15: compare/candidate async (unconditional yield)
- F-16: polled compute-job endpoint + paginated layout fetch
- F-21: diff reports measurement_changed
- F-22: adopted layout preserves summary
- F-24: auto-suggest prefers line-end, flags unjustifiable
- F-25: unusual letter edit UI wired
- F-26: large/small/broken/suspended types in output
- F-31: content-derived line_key, explicit lock confirmation
- F-32: עליון demoted to uncertain
- F-34: skeleton-mm column, units/mm toggle
- F-35: separate min_letter_height_mm and strokeWarning
- F-36: sanitized error logging (422 not 500)
- F-30: Host port enforcement
- F-19: spacing/setuma controls in UI
- F-29: partial_corpus labeling
- 121 tests across 7 files, all passing

### Test Results (final)
| Suite | Count | Pass | Fail |
|---|---|---|---|
| engine.test.js | 22 | 22 | 0 |
| layout.test.js | 29 | 29 | 0 |
| security.test.js | 18 | 18 | 0 |
| persistence.test.js | 7 | 7 | 0 |
| diff.test.js | 7 | 7 | 0 |
| fixes.test.js | 20 | 20 | 0 |
| remaining.test.js | 18 | 18 | 0 |
| **TOTAL** | **121** | **121** | **0** |

### Existing Repo Tests (no regression)
| Suite | Count | Pass | Fail |
|---|---|---|---|
| test/api.test.mjs | 26 | 26 | 0 |
| test/sync.test.mjs | 23 | 23 | 0 |
| test/store.test.mjs | — | — | — | Pre-existing failure (line 50, browser navigation), not caused by new code |

### Preview Server
- Running on 127.0.0.1:4252 (stale process holds 4247)
- Health: OK, DB: OK
- Builtin sources: all 5 books + chumash available
- Frontend: loads, no external CDN deps


## Final State (after all repairs + re-review)

### Review Verdict: CONDITIONAL GO → GO (after final fixes)

**Opus 5 Re-Review:** CONDITIONAL GO — all 13 original CRITICALs fixed, 3 new frontend blockers (N-01, N-02, N-03).
**Final Repair:** All 3 blockers + 5 residuals fixed. 128 tests across 8 files, all passing.

### Preview Server
- **URL:** http://127.0.0.1:4252 (loopback only)
- **Health:** OK
- **DB:** SQLite at sofer-studio/data/preview.db, persists across restart

### Test Summary (final)
| Suite | Assertions | Pass |
|---|---|---|
| engine.test.js | 22 | 22 |
| layout.test.js | 29 | 29 |
| security.test.js | 18 | 18 |
| persistence.test.js | 7 | 7 |
| diff.test.js | 7 | 7 |
| fixes.test.js | 20 | 20 |
| remaining.test.js | 18 | 18 |
| frontend.test.js | 7 | 7 |
| **TOTAL** | **128** | **128** |

### No Regression
- test/api.test.mjs: 26/26 ✅
- test/sync.test.mjs: 23/23 ✅
- test/store.test.mjs: pre-existing failure (not caused by new code)

## Decisions Log

- App root: `sofer-studio/` (isolated from Vecker)
- Backend: Node 22 built-in http + better-sqlite3, binds 127.0.0.1
- Frontend: framework-free vanilla JS/CSS, RTL Hebrew, responsive
- Storage: `sofer-studio/data/sofer.db` (git-ignored)
- Source data: Sefaria versioned API, pinned Hebrew version, fail-closed for missing annotations
- Security: Host/Origin validation, JSON-only mutations, no permissive CORS, per-session token
- Request limits: 20MB for source import, 1MB for mutations
- Implementation split: backend/engine/tests + frontend/assets (two DeepSeek children, disjoint ownership)
- All halachic parameters editable, never hard-coded
- First-run notice retained
- Full-Torah performance: chunked calculation with progress
