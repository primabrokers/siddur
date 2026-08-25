# Yeshiva Donor CRM — codebase conventions

This directory is a **self-contained app** (own package.json), deliberately independent of the siddur app in the repo root. It can later be extracted to its own repository with `git subtree split --prefix=crm`.

**The spec is law.** `../docs/donor-crm/spec/` — especially `01-PRINCIPLES.md` (the invariants I-1…I-13), `02-DATA-MODEL.md` (every field), `03-UI-FOUNDATIONS.md` (flag language, interaction rules). If code and spec disagree, the spec wins; if you must deviate, say so in the PR/commit description.

## Stack (fixed — do not add frameworks)

- Vite + React 18 + TypeScript (strict) · Tailwind CSS v4 (tokens as CSS variables) · react-router v7 (library mode) · TanStack Query v5 · supabase-js v2 · date-fns · vitest (unit/integration) · playwright-core (e2e, Chromium at `/opt/pw-browsers/chromium`, `--no-sandbox`)
- No UI component library. Components are hand-rolled; the wireframes in `../docs/donor-crm/spec/wireframes/*.dc.html` are the styling reference — copy their exact values (colors, radii, sizes) into tokens/components.

## Backend

- Supabase project **`zyvhcnhablkgbsgtljma`** (eu-west-2) · URL `https://zyvhcnhablkgbsgtljma.supabase.co`
- Schema, views, triggers, nightly function: applied as migrations (mirrored in `supabase/migrations/` here). Semantics in `../docs/donor-crm/schema-v2.sql` + spec 02/08/11.
- **All derived numbers come from the `contact_stats` view** — never recompute rollups, flags, days-since, KIT due, or donor status in the client (I-8/I-9).
- RLS is the security boundary; the client only reflects it (11 §2).
- Env: `src/lib/env.ts` holds the URL and publishable (anon) key defaults — the publishable key is safe client-side; `import.meta.env.VITE_SUPABASE_*` overrides.

## Design tokens (from spec 03 §2 and the wireframes)

ink `#1F2933` · muted `#6B7686` · faint `#9AA3AD` · border `#E3E6EA` · row-bg `#EEF1F4` · ground `#F6F7F9` · surface `#FFFFFF` · accent `#0E6E6B` (dark `#0A5451`, soft `#E3F0EE`) · gold/money `#A97F24` · good `#2E7D46` (bg `#EDF7F1`)
Flags: red `#D64545` (overdue) · orange `#E8871E` (today) · **yellow `#D9A800` (no next action — sorts worse than grey)** · blue `#3E7CB1` (waiting) · grey `#9AA3AD` (future) · dashed = queued.
Font: "Albert Sans" (Google Fonts) with system-ui fallback. Radii: cards 10px, inputs 8px, pills 999px. Money renders in gold with `tabular-nums`.

## Layout

```
crm/
  src/lib/         env.ts, supabase.ts, queries/ (typed data access), format.ts, dates.ts
  src/components/  ui primitives: Flag, Pill, PersonRow, MetricCard, TimelineEntry, NudgeCard, Sheet, Toast…
  src/features/    contacts/ stream/ tasks/ capture/ giving/ settings/
  src/routes/      route components composing features
  supabase/
    migrations/    SQL mirror of what's applied
    functions/     edge functions (ai-quick-capture)
  tests/           vitest integration + the four acceptance tests (spec 12 §2)
  e2e/             playwright screenshots/walkthrough
```

## Hard rules (from the spec's invariants)

1. Every task requires a `contact_id` (I-2). The seeded organisation-self contact anchors admin work.
2. Completing a next action ALWAYS opens the follow-up prompt in the same dialog (I-4); declining is allowed, skipping is not.
3. No required fields may block saving an interaction beyond contact + summary (I-5).
4. Mutations are optimistic with a 6s undo toast; confirm dialogs only for bulk/irreversible/outward actions (I-12).
5. Manual pills (stage/priority) are filled; computed pills (donor status, engagement) are outlined and read-only (I-7).
6. AI features: preview → confirm → write; label "Drafted with AI"; log accept/edit/reject to `ai_activity_log` (09 §1). Manual paths must work when AI is unavailable.
7. Amounts and private notes: never fetch through paths that bypass the redacted views/policies (11 §2).

## Commands

`npm run dev` (port 5180) · `npm run build` · `npm run typecheck` · `npm test` (vitest) · `npm run e2e`

Before declaring any milestone done: typecheck + build + tests green, and the feature exercised against the live Supabase project.
