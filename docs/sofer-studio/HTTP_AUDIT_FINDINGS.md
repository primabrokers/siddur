Controller executed real HTTP requests against the actual createApp factory on127.0.0.1:4269 using an isolated temporary SQLite database (cleaned afterward; preview data unchanged). Script available docs/sofer-studio/audit-http.mjs for reproduction; controller script uses this worktree's absolute module path. No product files edited.

PASS: layout compute returns200; marking written locks the saved layout; locked /stretch returns409. HTTP stretch replacement is idempotent because handler reconstructs base state (even though direct helper probe was not).

FAIL to correct and independently re-review:
- POST/profiles with letter_height_mm=-3 returns200. Reject malformed/nonfinite/negative/out-of-range physical inputs, all27letter widths, caps, gap bounds, geometry and pattern schemas; do not silently coerce invalid input to defaults.
- Mutation with valid token and Origin:http://localhost:9999 returns200 on server127.0.0.1:4269. Origin:null also200. Contract requires exact same-origin; reject these.
- GET/profiles/:id/export returns non_stretchable:{} because internal Set is serialized directly. Preserve exclusions as JSON arrays on ALL API/export/snapshot boundaries, accept explicit empty overrides correctly, avoid fallback reintroducing defaults on duplicate/restore.
- GET/layouts/:id lines lack words/items/letter measures and per-token Shem metadata. Test actual preview/restoration/restart and serialization of pattern segments/annotations/stretch positions. Reconstructing from changed global calibration is not acceptable.
- Duplicate1mm decisions for the same letter with1.5mm cap return200; must reject or aggregate then enforce total cap per occurrence atomically.

Please read IMPLEMENTATION_AUDIT_CASES.md and EARLY_ENGINE_AUDIT.md too. Full source raw responses/manifest are ready under docs/sofer-studio/source-data. Incorporate findings in requested DeepSeek correction work and independent Opus review after current children finish. Do not mistake passing initial helper tests for completion.

## Correction-wave rerun
Controller reran the same real HTTP script against a fresh isolated database after the current correction child's server/store/security edits. ALL10targeted checks now PASS: invalidheight400, crossport403, nullOrigin403, exclusionsarray, compute200, savedwords/items, duplicatecap409, idempotence, writtenlocks, lockedstretch409. This does not clear separate source/pattern/frontend/performance findings or replace Opus review. The long-running preview still needs a restart to load these backend changes.

Controller also ran docs/sofer-studio/audit-restart.mjs against two actual server.js processes and a temporary SQLite file. PASS: different process IDs, exact snapshot/line metadata/summary retained despite a live profile edit, written progress and lock retained, locked stretch409 after restart. Temporary data cleaned; preview.db untouched.
