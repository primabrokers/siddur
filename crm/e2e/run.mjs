#!/usr/bin/env node
/**
 * End-to-end entry point — a signpost, not a runner.
 *
 * The four spec 12 §2 acceptance tests are **executable and in CI** as vitest
 * suites (`crm/tests/acceptance/`), offline by default against a deterministic
 * seeded Monday, and against the live project with `LIVE=1` (`npm run
 * test:live`, which also runs the 11 §1 RLS conformance matrix).
 *
 * What lives here instead is the *visual* pass: per-milestone screenshot
 * scripts that drive Chromium (`/opt/pw-browsers/chromium`, `--no-sandbox`)
 * against either the offline fixture server or the live project through the
 * relay. Each script's header carries its own recipe.
 *
 * TODO(e2e): a single walkthrough that chains the four milestone scripts and
 * diffs the shots against a baseline. Until then, run them individually.
 */

const SCRIPTS = [
  ['m1-shots.mjs', 'contacts list, profile, details'],
  ['m2-shots.mjs', 'Action Stream, tasks, close-the-loop'],
  ['m3-capture-shots.mjs', 'Quick Capture — input, confirm, saved'],
  ['m4-shots.mjs', 'giving, gift entry, pledges, thanks'],
  ['m5-shots.mjs', 'search, command palette, views bar, settings'],
  ['m7-shots.mjs', 'Gift Aid workspace, Review & export'],
]

console.log('e2e: the acceptance tests are vitest suites, not browser scripts.')
console.log('     npm test                 — the four spec 12 §2 tests, offline')
console.log('     npm run test:live        — the same four + the RLS matrix, live')
console.log('')
console.log('     Screenshot scripts (see each header for its recipe):')
for (const [file, what] of SCRIPTS) console.log(`       node e2e/${file}`.padEnd(38), what)
process.exit(0)
