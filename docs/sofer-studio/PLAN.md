# Sofer Studio — Small Sefer Torah Layout Planner

## Plan and Contracts

**Branch:** `feature/small-sefer-torah` | **Worktree:** `siddur-small-sefer-torah-20260830` | **App root:** `sofer-studio/`

### Architecture

- **Backend:** Node 22, built-in `http` server (no Express dependency), SQLite via `better-sqlite3`. Binds 127.0.0.1 by default.
- **Frontend:** Framework-free vanilla JS + CSS, served by the backend. RTL Hebrew support, responsive desktop/phone.
- **Persistence:** SQLite database file at `sofer-studio/data/sofer.db` (survives restart). All state server-side.
- **Isolation:** All new code under `sofer-studio/`. Root `package.json` gets discoverability scripts only. No modifications to existing Vecker code, Supabase, or shared services.

### Data Model (SQLite)

| Table | Purpose |
|---|---|
| `sources` | Imported Torah corpus: id, name, tradition, revision_hash, book/chapter/verse JSON, created_at |
| `profiles` | Calibration profiles: id, name, letter_height_mm, stroke_thickness_mm, letter_widths JSON, gaps JSON, non_stretchable JSON, max_stretch JSON, created_at |
| `geometries` | Column geometry: id, name, lines_per_amud, baseline_pitch_mm, margins JSON, column_gap_mm, line_width_mm, etc. |
| `layouts` | Layout snapshots: id, source_id, profile_id, geometry_id, patterns JSON, annotations JSON, source_hash, status (draft/locked), created_at |
| `layout_lines` | Per-line layout: id, layout_id, line_index, amud, content, width_mm, status (written/checked/proofread), occurrence_ids JSON, stretch_decisions JSON, leftover_mm REAL |
| `patterns` | Fixed passage patterns: id, passage_name, scheme_name, version, provenance, slots JSON |
| `candidates` | Layout candidates from calibration changes: id, parent_layout_id, profile_id, geometry_id, diff JSON, created_at |

### API Contracts

All endpoints under `/api/`, JSON in/out, 1MB max request body, 127.0.0.1 only.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/sources` | List imported sources |
| POST | `/api/sources/import` | Import/annotate corpus (annotated-import, fail-closed for missing data) |
| GET | `/api/profiles` / POST | CRUD calibration profiles |
| GET | `/api/geometries` / POST | CRUD geometry configs |
| POST | `/api/layout/compute` | Compute layout from source+profile+geometry+patterns |
| GET | `/api/layouts` / GET `/:id` | List/get saved layouts |
| POST | `/api/layouts/:id/lock` | Lock layout (server-side, after writing begins) |
| POST | `/api/layouts/:id/progress` | Update line/amud progress (enforces lock) |
| POST | `/api/layouts/:id/candidate` | Create candidate from calibration change |
| GET | `/api/layouts/:id/diff` | Line/verse diff between locked and candidate |
| GET | `/api/search?q=` | Search by verse ref, return amud/line positions |
| POST | `/api/compare` | Compare 2-3 profiles on same source+geometry |
| GET | `/api/patterns` / POST | List/create fixed passage patterns |
| GET | `/api/validate/line` | Validate a single line against spacing limits |

### Engine Contracts

#### Width Calculation
- `letterWidth(letter, profile)` = `referenceInkWidth(letter) * (height_mm / reference_height_mm) + strokeContribution(letter, stroke_mm)`
- `referenceInkWidth` excludes stroke; stroke added once per letter, never double-counted.
- `lineWidth(tokens, profile)` = sum of letter widths + inter-letter gaps + inter-word gaps.
- Individual `maxStretch` is a hard cap per letter; never exceeded even under justification pressure.
- Non-stretchable letters (י ו ז ן נ ג צ ץ by default): excluded from stretch candidates. Override list allowed but never overrides Shem protection or per-letter cap.

#### Shem Protection
- Detect sacred names (Tetragrammaton, Elokim variants, El, Elah, Elyon, Shaddai, Tzeva'ot, Adonai, etc.) as whole tokens including prefixes (ו, ב, כ, ל, מ, ה, וה, וב, etc.).
- Normalized view for detection; source characters never rewritten.
- Shem tokens: atomic (never split across lines), letters excluded from stretch, highlighted in preview.
- If Shem token > available width: unsatisfiable-layout error, never truncate.
- Uncertain classification: visible review flag, not silent pass.

#### Fixed Passage Patterns
- Schema: `{ passage, scheme, version, provenance, lines: [{ index, segments: [{ tokens, gap_before }], gap_after }] }`
- Patterns drive actual layout, exempt from ordinary wrapping.
- Missing/unsupported source data: fail-closed blocker, no production-ready layout claim.
- Pattern provenance and version recorded in snapshot.

#### Unusual Letters
- Large/small/dotted/broken/suspended letter occurrences: occurrence-specific width overrides, stable IDs.
- Optional taggin display toggle: visual only, does not alter layout measurements.
- Data-driven annotations; no fabricated glyph shapes.

#### Spacing Limits
- `minInterLetterGap`, `minInterWordGap`, `maxInterWordGap` (all mm, calibrated).
- `maxInterWordGap` relative to configurable small-letter reference width from same profile.
- `setumaGap` = nine-letter measurement from profile; reference letters and included gaps defined.
- Every line validated: underfull, overfull, conflicting bounds, setuma at edge, exact limits.

#### Column Geometry
- Inputs: lines_per_amud, baseline_pitch_mm, top_margin_mm, bottom_margin_mm, inter_column_gap_mm, outer_margin_mm, line_width_mm.
- Derived: column_height = lines_per_amud * baseline_pitch; amud_height = column_height + top + bottom margins; sheet_usable_width; amudim_per_yeria; total_yerios; klaf_length_metres.
- Partial final yeria: explicit convention (round up, last sheet may be partial).
- Min column width = 3 × width of למשפחותיכם using calibrated widths + stroke + gaps.

#### Progress & Locking
- Line status: pending → written → checked → proofread. Amud status aggregated from lines.
- Lock: marking any line "written" locks the entire layout on the SERVER. No further profile/geometry/source changes to that layout.
- Calibration change creates a candidate + visible diff. Progress never silently moves to changed lines.
- Immutable snapshot: source_hash, profile, geometry, patterns, annotations, occurrence IDs.

#### Search & Comparison
- Search: verse ref → amud/line position(s). Verses spanning multiple lines: all positions returned.
- Compare: 2-3 profiles, same source + geometry, independent results. Total amudim, yerios, klaf metres. Honest partial-corpus labels.

### Acceptance Checklist

- [ ] Backend binds 127.0.0.1, SQLite persists across restart
- [ ] Master scale: one letter-height mm, proportional widths, separate stroke, hard caps
- [ ] Column geometry: all inputs exposed, partial-sheet convention, למשפחותיכם ×3 validation
- [ ] Shem detection: whole tokens with prefixes, no split/stretch, uncertain flagged
- [ ] Non-stretchable letters: default + override, caps enforced in all paths
- [ ] Fixed passage patterns: schema with provenance, fail-closed for missing data
- [ ] Unusual letters: occurrence overrides in output, taggin toggle visual-only
- [ ] Spacing limits: min/max gaps, setuma, impossible combos rejected
- [ ] Progress: line+amud status, server-side lock, immutable snapshot
- [ ] Candidate/diff: calibration change creates candidate, visible diff, no silent progress move
- [ ] Search: verse → position, multi-line verses, same corpus
- [ ] Comparison: 2-3 profiles, independent results, honest labels
- [ ] Tests: numerical, layout, security, persistence, source integrity, Shem atomicity
- [ ] Frontend: desktop + phone, real API round trips, print uses measured layout
- [ ] No regression in existing repo tests
- [ ] README updated with install/start/test steps
- [ ] Committed on feature/small-sefer-torah

### Roles and Models

| Role | Provider | Model | Phase |
|---|---|---|---|
| Orchestrator | fireworks | accounts/fireworks/models/glm-5p2 | All phases |
| Frontend design | fireworks | accounts/fireworks/models/kimi-k3 | Phase 2 |
| Implementation | deepseek-official | deepseek-v4-pro | Phase 3 |
| Review | anthropic | claude-opus-5 | Phase 5 |



### Supplemental Engineering Guidance (from orchestrator context)

**Source API:** Use Sefaria's versioned text API (https://developers.sefaria.org/reference/get-v3-texts). Pin a Hebrew version explicitly and retain its source/licensing metadata. An API default version is not an immutable corpus revision. A consonants-only version (`hebrew|Tanach with Text Only`) exists (https://developers.sefaria.org/docs/june-2024) but does not by itself guarantee unusual-letter or scroll-layout annotations.

**Pattern provenance:** Rambam's text on paragraph and song arrangements (https://new.mechon-mamre.org/i/2308.htm) explicitly omits some illustrations; text snippets alone are not complete visual pattern evidence. Named/sourced scheme definitions require explicit data validation. Fail-closed for missing authoritative pattern data.

**Native bundle isolation:** `scripts/stage.mjs` uses a fixed allowlist of existing Vecker files. Do NOT add the backend or its data directory to the native/static bundle. The new app starts separately; its storage directory must be git-ignored.

**Security hardening (beyond loopback):**
- Validate Host and Origin headers; reject cross-origin state-changing requests.
- Require `Content-Type: application/json` on all mutation endpoints.
- Avoid permissive CORS. Consider a per-session local token; never log tokens.
- Lock tests must attempt direct API requests (not just disabled UI). Read and mutation endpoints must not permit replacement/deletion of a locked snapshot.
- Layout re-run must create a candidate separate from the locked original.
- Reject malformed or oversized data before committing any partial state.
- Never accept arbitrary server-side file paths or fetch arbitrary URLs from submitted source JSON.

**Fixture calculation (independently verified):** A reference letter with skeleton width 2.0 mm at reference height 3.0 mm, at a 4.5 mm master height, gives 3.0 mm skeleton width. Adding 0.2 mm stroke contribution makes 3.2 mm total; changing stroke to 0.3 mm changes total to 3.3 mm without altering scale. Use this convention consistently.

### Full Brief Requirements (from ORIGINAL_FULL_BRIEF.md)

Superseded items: the old "ask clarifying questions" instruction and "all data in browser state" architecture are superseded by the current confirmed fullstack project (both frontend AND backend). All other requirements are incorporated:

**Text Input:** TXT file upload, paste textarea, or built-in Chumash text. Hebrew RTL, strip nekudot/te'amim for consonant-only view but preserve original source. Recognize פ (petucha) and ס (setuma) markers, parsha/sefer boundaries. Show letter and word counts.

**Unit System:** Base "unit" = N mm (default 0.5mm, editable). Units per line width (enterable in units OR mm, synced). Units per inter-word space (default 2). Units per inter-letter gap (default 0). Units↔mm conversion throughout.

**Calibration Profiles:** Save, load, duplicate, name profiles (e.g. "Beis Yosef 42 line", "Arizal ktav"). Import/export as JSON. Full aleph-beis including 5 sofiyot.

**Line-Fitting Engine:** RTL word-by-word. Never split words. Respect petucha (ends line, rest blank) and setuma (9-letter-width gap, configurable). Group into amudim.

**Stretching/Justification:** Default stretchable: ד ה ח ל ר ת plus ב כ ם ס. Non-stretchable by default: י ו ז ן נ ג צ ץ (overridable). Max stretch per letter as hard cap. Stretch position filter: word-final / line-end / anywhere. Per-line: show leftover, candidates with positions, manual stretch decisions. Auto-suggest distributes leftover, preferring line-end letters, spreading. Flag unjustifiable lines.

**Vavei Ha'amudim:** Flag columns not beginning with ו.

**Exports:** Print-friendly layout, PDF export, JSON export, CSV export of layout.

**Performance:** Handle full Sefer Torah (~304,805 letters) without freezing — chunk layout calculation, show progress. Offline support once loaded.

**First-run Notice:** Defaults are a starting point only, confirm with rav/mumcheh. App plans layout; does not replace hagahah or computer check. Retain this notice.

**Halachic Parameters:** All halachic parameters (column minimums, margins, special layouts, stretchable letters, setuma gap) are editable settings, never hard-coded.

### Provider Route Correction

| Role | Original Request | Actual Route | Reason |
|---|---|---|---|
| Orchestrator (GLM 5.2) | fireworks / glm-5p2 | fireworks / accounts/fireworks/models/glm-5p2 | Confirmed working |
| Frontend design (Kimi K3) | fireworks / kimi-k3 | fireworks / accounts/fireworks/models/kimi-k3 | Confirmed working (design complete) |
| Implementation (DeepSeek V4 Pro) | deepseek-official / deepseek-v4-pro | **fireworks / accounts/fireworks/models/deepseek-v4-pro-0813** | deepseek-official has MISSING_CREDENTIAL; same model available on Fireworks |
| Review (Opus 5) | anthropic / claude-opus-5 | anthropic / claude-opus-5 | Credential configured |

### Engineering Corrections (from supplements)

1. **Request size limits:** Source import endpoint allows up to 20MB (bounded full corpus). Mutation endpoints (profile/geometry/progress/pattern) limited to 1MB. Bound verse/word/annotation counts.
2. **Ink height vs allocated ruling height:** Column ink extent = (L-1)×P + H where L=lines, P=baseline pitch, H=letter height. Allocated ruling height = L×P. Label the extra trailing space. Reject baselines where P < H (overlap). Apply margins consistently to both.
3. **Three-word threshold:** Width of למשפחותיכם × 3 includes the 2 inter-word gaps under the documented gap convention, not just 3 isolated word widths.
4. **UI for import and patterns:** Full-source import AND user-provided sourced traditional patterns must be usable through the UI, not just backend endpoints. Do not silently change source content to match a pattern.
5. **Staging isolation:** Native GitHub Pages/Capacitor staging unchanged. Fullstack app has its own startup command.
6. **Security:** Validate Host/Origin headers, reject cross-origin state-changing requests, require JSON Content-Type on mutations, per-session local token, never log tokens. Lock tests must use direct API requests.
7. **Source handling:** Preserve original source exactly for provenance. Derive consonant-only view when stripping nikud/cantillation. Keep unusual-letter dots as metadata, not stripped as vocalization. Plain-text structural markers need unambiguous parsing.

### Source Data Posture

- Annotated-import infrastructure with fail-closed blocking for missing authoritative data.
- Demo/excerpt fixtures labeled honestly; never presented as full-Torah totals.
- No invented full Torah or accepted tradition. Code-generated tikkun is not certification.
- Original Hebrew source immutable through all stages.
