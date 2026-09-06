# Additional review priorities after the correction pass

Please run the requested actual `anthropic/claude-opus-5` independent review immediately after the current DeepSeek correction child finishes. Review the user brief and real code, not just the child summary. Have it write actionable findings, then use the exact Fireworks DeepSeek V4 Pro route for repairs and re-review.

The controller observed these additional risks in the current work-in-progress tree; verify before reporting them fixed:

- `applyStretch` permits summed valid per-letter expansions greater than the line's remaining width. `validateLine` checks unstretched `width_mm`; enforce the total geometry limit atomically and persist/revalidate measured width consistently.
- `recomputeFullLines` reloads CURRENT live profile/geometry and ignores layout snapshots, patterns and annotations. Stretch or auto-suggest on an existing draft can silently use a different layout. Use the saved measured line and snapshot; do not reflow on an edit.
- Candidate generation ignores selected pattern/annotation data; adoption stores an empty summary, takes current live profiles instead of candidate snapshots, and trusts `verified_unchanged_lines` even when content/measurements changed. Only geometrically unchanged lines can retain progress, enforced server-side. Diff must report measurement changes even if word boundaries remain identical.
- `maxInterWordGap` defaults to equality with small-letter width, and equality currently passes when no explicit max is supplied. The requested strict upper bound must hold in all paths. Setuma at START of a line is not detected by the existing last-item-only edge check.
- `buildPdf` appears to wrap already-numbered PDF objects inside duplicate object wrappers, clips all lines to one page and contains no Hebrew text. Do not deliver this as a tikkun PDF. Implement a faithful measured printable output using the preview's layout, with honest study/blocker labels, or explicitly disable unsupported PDF while retaining trustworthy JSON/CSV and browser print.
- Full corpus progress only appears at completion; compare/candidate routes remain synchronous. Verify actual UI/network responsiveness and avoid simulated progress.

Also read the post-launch files `PATTERN_REVIEW_CASES.md`, `QERE_WARNING_RECHECK.md`, `CORRECTION_ACCEPTANCE_CLARIFICATION.md`, and `PHONE_QA_FINDINGS.md`. Known special ranges without a chosen authoritative pattern must NOT silently become ordinary writing-ready lines; a study preview must be explicitly blocked/watermarked as such.

All repairs remain in sofer-studio and task docs. Do not inspect unrelated service processes or credentials, restart Harness, change Vecker/Supabase, push main, or claim a certified scribal source. Finish README and a verified feature-branch commit after review; controller is handling independent browser QA.
