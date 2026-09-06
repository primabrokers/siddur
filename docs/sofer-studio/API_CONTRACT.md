# Sofer Studio — Frozen API & Engine Contracts

**FROZEN:** Both implementation children MUST follow these exact contracts. No changes without GLM orchestrator approval.

## File Ownership

| Child | Owns | Does NOT touch |
|---|---|---|
| **Backend** | `sofer-studio/server/`, `sofer-studio/engine/`, `sofer-studio/db/`, `sofer-studio/tests/`, `sofer-studio/package.json`, `sofer-studio/server.js` | `sofer-studio/public/` |
| **Frontend** | `sofer-studio/public/` (all HTML/CSS/JS/assets) | `sofer-studio/server/`, `sofer-studio/engine/`, `sofer-studio/db/`, `sofer-studio/tests/` |

**Shared interface:** The frontend calls `/api/*` endpoints. The backend serves `sofer-studio/public/` as static files. Both children reference this document for the API shape.

## Server

- **Entry:** `sofer-studio/server.js` — Node 22, built-in `http` module, `better-sqlite3`.
- **Bind:** `127.0.0.1` only. Port from env `SOFER_PORT` or default `4247`.
- **DB:** `sofer-studio/data/sofer.db` (SQLite, created on first run, persists across restart).
- **Static:** Serve `sofer-studio/public/` at `/`.
- **Security:**
  - Validate `Host` header is `127.0.0.1:PORT` or `localhost:PORT`.
  - Reject cross-origin state-changing requests (check `Origin` header on POST/PUT/DELETE).
  - Require `Content-Type: application/json` on all mutation endpoints.
  - Per-session token: generated on first GET `/api/session`, returned as `X-Sofer-Token` header, required on all mutations as `X-Sofer-Token` header. Never logged.
  - Request body limits: 20MB for `/api/sources/import`, 1MB for all other endpoints.
  - Safe errors: never expose stack traces or internal paths to client. Return `{ error: "message" }` with appropriate HTTP status.
  - No arbitrary filesystem access. No URL fetching from submitted JSON (import is text/JSON body, not a URL).

## API Endpoints

### Session
```
GET /api/session
  → { token: "..." }  + X-Sofer-Token header
```

### Health
```
GET /api/health
  → { status: "ok", db: true, version: "1.0.0" }
```

### Sources (Torah corpus)
```
GET /api/sources
  → [{ id, name, tradition, revision_hash, book_count, verse_count, letter_count, created_at }]

POST /api/sources/import   (20MB max, JSON)
  Body: { name, tradition, text: "raw Hebrew text or JSON structure", format: "txt"|"json"|"sefaria" }
  → { id, name, tradition, revision_hash, book_count, verse_count, letter_count, warnings: [...] }
  // Fails closed if structure is malformed. Labels excerpts honestly.
  // Strips nekud/te'amim for consonant-only working view but preserves original.
  // Parses פ/ס markers, parsha/sefer boundaries.
```

### Profiles (calibration)
```
GET /api/profiles
  → [{ id, name, letter_height_mm, stroke_mm, unit_mm, ... }]

POST /api/profiles   (1MB max, JSON, token)
  Body: { name, letter_height_mm, stroke_mm, unit_mm, min_nib_mm, letter_widths: {א: 2.0, ...}, gaps: {inter_letter: 0, inter_word: 1.0}, non_stretchable: ["י","ו",...], max_stretch: {ד: 1.5, ...}, stretch_position: "anywhere"|"word_final"|"line_end" }
  → { id, ... }

GET /api/profiles/:id
  → { id, name, ...full profile }

PUT /api/profiles/:id   (1MB max, JSON, token)
  → { id, ...updated }

DELETE /api/profiles/:id   (token)
  → { ok: true }

POST /api/profiles/:id/duplicate   (token)
  Body: { name: "copy name" }
  → { id, ...new profile }

POST /api/profiles/import   (1MB max, JSON, token)
  Body: { ...profile JSON }
  → { id, ... }

GET /api/profiles/:id/export
  → profile JSON (download)
```

### Geometries (column geometry)
```
GET /api/geometries
  → [{ id, name, ... }]

POST /api/geometries   (1MB max, JSON, token)
  Body: { name, lines_per_amud, baseline_pitch_mm, top_margin_mm, bottom_margin_mm, inter_column_gap_mm, outer_margin_mm, line_width_mm, max_letters_per_line, amudim_per_yeria: <positive integer>, partial_final_yeria: "round_up"|"exact" }
  → { id, ... }

GET /api/geometries/:id
  → { id, name, ...full }
```

### Patterns (fixed passage layouts)
```
GET /api/patterns
  → [{ id, passage_name, scheme_name, version, provenance, status: "verified"|"unverified"|"missing" }]

POST /api/patterns   (1MB max, JSON, token)
  Body: { passage_name, scheme_name, version, provenance, slots: [{ index, segments: [{ tokens, gap_before_mm }], gap_after_mm }] }
  → { id, ... }

GET /api/patterns/:id
  → { id, ...full pattern definition }
```

### Layout computation & snapshots
```
POST /api/layout/compute   (1MB max, JSON, token)
  Body: { source_id, profile_id, geometry_id, pattern_ids: [...], annotations: {...} }
  → { layout_id, status: "draft", lines: [...], summary: { total_amudim, total_yerios, klaf_length_m, ... }, validation: [...] }
  // Chunked computation for large sources. Returns progress info.

GET /api/layouts
  → [{ id, name, source_id, profile_id, geometry_id, status, created_at }]

GET /api/layouts/:id
  → { id, ...full layout with lines, summary, validation, snapshot }

POST /api/layouts/:id/lock   (token)
  → { id, status: "locked", locked_at: "..." }
  // SERVER-SIDE lock. After lock: no mutations to this layout's profile/geometry/source/stretch. Stretch edits frozen as part of immutable snapshot.
  // Direct API requests to change locked layout return 409 Conflict.

POST /api/layouts/:id/progress   (1MB max, JSON, token)
  Body: { line_id?: "...", amud?: N, status: "written"|"checked"|"proofread" }
  → { ok: true, progress: {...} }
  // Enforces lock: if layout locked, only progress updates allowed (not layout/stretch/source/profile/geometry changes).
  // Progress identity stable: line_id never changes across reruns.

POST /api/layouts/:id/candidate   (1MB max, JSON, token)
  Body: { profile_id: "new", geometry_id: "new" }
  → { candidate_id, ... }
  // Creates a SEPARATE candidate. Never mutates the locked original.

GET /api/layouts/:id/diff
  → { locked: {...}, candidate: {...}, changes: [{ type, ref, from, to }] }
  // Line/verse diff between locked layout and candidate.

GET /api/layouts/:id/search?q=בראשית א:ד
  → { results: [{ verse_ref, amud, line_start, line_end }] }
  // Search by verse ref, returns amud/line positions. Verses spanning lines return ranges.

POST /api/compare   (1MB max, JSON, token)
  Body: { source_id, geometry_id, profile_ids: ["p1","p2","p3"] }
  → { comparisons: [{ profile_id, profile_name, total_amudim, total_yerios, klaf_length_m }], source_label: "..." }
  // Each profile independently computed on same source+geometry. Honest partial-corpus labels.
```

### Stretch & Justification
```
POST /api/layouts/:id/stretch   (1MB max, JSON, token)
  Body: { line_id: "...", decisions: [{ letter_occurrence_id: "...", stretch_mm: N }] }
  → { ok: true, line: { ...updated line with leftover_mm, stretch_decisions } }
  // Manual per-letter stretch decisions. Max cap is HARD — server rejects > cap.
  // Shem letters are NEVER stretch candidates, even with override — server rejects.
  // On LOCKED layouts: stretch edits are frozen (part of snapshot). Returns 409.
  // On DRAFT layouts: stretch edits allowed and stored.

POST /api/layouts/:id/auto-suggest   (1MB max, JSON, token)
  Body: { line_id: "..." }
  → { ok: true, suggestions: [{ letter_occurrence_id: "...", stretch_mm: N, position: N }] }
  // Auto-distributes leftover across candidates, preferring line-end letters, spreading evenly.
  // Never exceeds per-letter max cap. Never includes Shem letters.
  // Returns suggestions only — sofer must explicitly adopt via /stretch endpoint.

POST /api/layouts/:id/adopt-candidate   (1MB max, JSON, token)
  Body: { candidate_id: "...", verified_unchanged_lines: [line_id, ...] }
  → { ok: true, new_layout_id: "...", message: "..." }
  // Adopts a candidate as the new working layout.
  // CRITICAL: Progress NEVER silently carries to changed lines.
  // Only lines explicitly verified as unchanged keep their progress status.
  // Changed lines reset to "pending". The sofer must explicitly confirm.
  // Creates a new locked layout from the candidate; old locked layout preserved.
```

### Validation
```
POST /api/validate/line   (1MB max, JSON)
  Body: { tokens: [...], profile_id, geometry_id }
  → { valid: bool, errors: [...], warnings: [...] }
```

### Exports
```
GET /api/layouts/:id/export?format=json
GET /api/layouts/:id/export?format=csv
GET /api/layouts/:id/export?format=pdf
  // All use the SAME measured layout as preview.
```

## Engine Contracts

### Width Calculation (frozen convention)
```
skeletonWidth(letter, profile) = referenceSkeletonWidth(letter) * (letter_height_mm / reference_height_mm)
strokeContribution(letter, profile) = stroke_mm * strokeFactor(letter)  // per-letter factor, default 1.0
totalWidth(letter, profile) = skeletonWidth + strokeContribution
// Skeleton EXCLUDES stroke. Stroke added ONCE. Never double-counted.
```

**Fixture (must pass):** Reference letter skeleton 2.0mm at ref height 3.0mm, at 4.5mm master → skeleton 3.0mm. +0.2mm stroke → 3.2mm total. Stroke 0.3mm → 3.3mm. Scale unchanged.

### Line Width
```
lineWidth(tokens, profile) = Σ totalWidth(letter) + Σ interLetterGap + Σ interWordGap
// interLetterGap: within words, between adjacent letters
// interWordGap: between words, = profile.gaps.inter_word (in mm)
```

### Three-Word Threshold (למשפחותיכם ×3)
```
minColumnWidth = 3 * wordWidth("למשפחותיכם") + 2 * interWordGap
// INCLUDES the 2 inter-word gaps, not just 3 isolated word widths.
```

### Column Geometry
```
inkExtent = (lines_per_amud - 1) * baseline_pitch_mm + letter_height_mm
allocatedRulingHeight = lines_per_amud * baseline_pitch_mm
// Label the extra trailing space (allocatedRulingHeight - inkExtent) as "trailing margin"
// Reject baseline_pitch < letter_height (overlap)
column_height = allocatedRulingHeight
amud_height = column_height + top_margin_mm + bottom_margin_mm
sheet_usable_width = 2 * outer_margin_mm + 2 * line_width_mm + inter_column_gap_mm  // for 2 amudim per yeria
amudim_per_yeria = configurable positive integer (from geometry settings, NOT hard-coded)
total_yerios = ceil(total_amudim / amudim_per_yeria)
// klaf_length_m = sum of sheet WIDTHS along the roll / 1000 (NOT height × count)
// For k columns per yeria (k = amudim_per_yeria):
//   fullYeriaWidth = 2 * outer_margin_mm + k * line_width_mm + (k-1) * inter_column_gap_mm
// full-sheet convention (partial_final_yeria="round_up"): every yeria uses fullYeriaWidth
// exact-final-sheet convention (partial_final_yeria="exact"):
//   final yeria has r = total_amudim mod k remaining columns (if r>0):
//   finalYeriaWidth = 2 * outer_margin_mm + r * line_width_mm + (r-1) * inter_column_gap_mm
//   (if r==0, final yeria is full width)
// klaf_length_m = (sum of all yeria widths) / 1000
// NOTE: ink/column/klaf height is a DIFFERENT dimension — do not confuse with scroll length.
// Label the convention used and derive actual lengths from real data.
```

### Shem Protection
- Sacred names detected as whole tokens including prefixes (ו, ב, כ, ל, מ, ה, וב, וכ, etc.).
- Normalized view for detection; source characters never rewritten.
- Shem tokens: atomic (never split), letters excluded from stretch, highlighted.
- If Shem > available width: unsatisfiable error. Never truncate.
- Uncertain: visible review flag.

### Non-Stretchable Letters
- Default: י ו ז ן נ ג צ ץ. Overridable per profile.
- Override never bypasses Shem protection or per-letter max stretch cap.

### Fixed Passage Patterns
- Schema: `{ passage, scheme, version, provenance, slots: [{ index, segments: [{ tokens, gap_before_mm }], gap_after_mm }] }`
- Patterns drive layout, exempt from ordinary wrapping.
- Missing data: fail-closed blocker.

### Unusual Letters
- Occurrence-specific width overrides, stable IDs.
- Taggin toggle: visual only, does not alter measurements.

### Spacing Limits
- minInterLetterGap, minInterWordGap, maxInterWordGap (all mm).
- maxInterWordGap relative to configurable small-letter reference width.
- setumaGap = nine-letter measurement from profile (reference letters + internal gaps defined).
- Impossible combinations rejected.

### Progress & Locking
- Line: pending → written → checked → proofread.
- Amud: aggregated from lines.
- Lock: server-side, marking any line "written" locks entire layout.
- Immutable snapshot: source_hash, profile, geometry, patterns, annotations, occurrence IDs.
- Candidate: calibration change creates separate candidate + visible diff. Progress never silently moves.

## Frontend Pages/Assets

The frontend child creates these files under `sofer-studio/public/`:
- `index.html` — main app shell (app bar, sargel rule, 3-column workbench, lower bench drawer)
- `styles.css` — all styles per DESIGN_SPEC.md tokens
- `app.js` — main app controller, panel management, tab navigation, keyboard shortcuts
- `api.js` — API client (fetch wrapper, token management, all endpoints)
- `tikkun.js` — tikkun preview rendering (parchment, RTL columns, sirtut, Shem highlights, unusual letters)
- `calibration.js` — calibration/letter table panel
- `geometry.js` — column geometry panel
- `validation.js` — validation panel
- `progress.js` — progress tracking panel
- `search.js` — search panel
- `compare.js` — side-by-side comparison
- `diff.js` — diff view
- `layouts.js` — saved layouts panel
- `passages.js` — unusual letters & passage schemes panel
- `shemos.js` — protected names panel
- `export.js` — print/PDF/CSV/JSON export
- `first-run.js` — first-run notice modal

All JS loaded as ES modules or classic scripts (no build step). No external CDN dependencies (self-contained). Hebrew fonts: use system fallback stacks per DESIGN_SPEC.md; optionally load Frank Ruhl Libre + Fraunces from Google Fonts with fallback.

## Startup Commands

```bash
cd sofer-studio
npm install        # installs better-sqlite3
npm start          # starts server on 127.0.0.1:4247
npm test           # runs all tests
```
