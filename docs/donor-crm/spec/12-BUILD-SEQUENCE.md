# 12 — Build Sequence

*BUILD_PLAN.md's phases decomposed into buildable milestones, each with acceptance tests and a demo script. Estimates assume one experienced developer, part-time, with AI pair-programming.*

## §1 Milestones (brief §35 mapping)

### Phase 0 — Foundations (~1 week)
**M0** · Repo + CI + Supabase project (eu-west-2) · auth + `team_members` + roles · schema-v2 applied + RLS baseline · lookup seeds (02 §6) + automation-rule seeds (08 §7) · app shell + nav (03 §1) · deploy pipeline · seed fixtures (11 §8).
*Done when:* a fundraiser logs in, sees the empty shell, RLS provably blocks a viewer from a private note (test).

### Phase 1 — Core CRM (~4–6 weeks) → usable every day
| Milestone | Contents (spec §§) | Demo |
|---|---|---|
| **M1 Contacts & timeline** (wk 1–2) | Profiles + at-a-glance header (04 §5.1–5.7), interactions & scheduled meetings (02 §3.2), notes + pinned, documents, households (02 §3.13), tags | Open a seeded donor, understand them in 60s |
| **M2 Tasks & the stream** (wk 2–3) | Tasks incl. waiting/queued (04 §3), Action Stream + flags (04 §1, 03 §2), close-the-loop (I-4), focus mode (04 §2), search + palette (03 §3) | Work a seeded Monday to the reward state |
| **M3 Quick Capture** (wk 3–4) | Manual quick form → AI capture (09 §2) with confirm sheet, Hebcal dates, post-channel prompts, offline queue (11 §6) | Dictate the Dovid Cohen sentence, saved in <30s |
| **M4 Giving core** (wk 4–5) | Gift entry + assists (05 §1), pledges & installments (05 §2), recurring agreements, receipting/thanks queues (05 §3), rollups in header | Enter gift → thank-you task + GA status appear |
| **M5 The engine** (wk 5–6) | Nightly run + trigger library (08 §2–3, §5), signals & nudge rail, KIT lifecycle (07 §4), digest email (08 §6), smart-view seeds (06 §1), import wizard + dedupe (06 §5) | The four §34 tests pass (below) |

### Phase 2 — Fundraising management (~3–4 weeks)
**M6** Opportunities + pipeline board + rotting + stale list (06 §2) → **M7** Gift Aid workspace + HMRC export + chase (05 §5) → **M8** Reports + RFM + benchmarks (06 §3) → **M9** AI briefs, "where we're holding", drafting, digest narrative, first-draft-of-the-day (09 §3–5); ICS feed (10 §4); journeys (08 §4).

### Phase 3 — Decision-pointed (10 §8)
Email dropbox → NL search → AI attributes/backfill → WhatsApp Tier 2 → calendar two-way → receipt PDFs — each only when its register trigger fires.

## §2 Acceptance tests (brief §34, executable — run against fixtures, in CI where automatable)

1. **Daily management**: seeded Monday → Action Stream shows every due call/message/meeting/task, every overdue item, every neglected relationship; assert zero items reachable only by memory/search.
2. **Donor knowledge**: open a donor untouched for six months → header + timeline + (P2) brief convey who/how/history/interests/last-time/objective — stopwatch ≤60s, human-verified each release.
3. **Nothing gets lost**: capture "call him again in three months" → task exists at +3 months → clock advanced (test harness) → he surfaces in Today and the digest that morning.
4. **Relationship maintenance**: 2-month cadence + meaningful contact logged → fast-forward past window with no contact → exactly one `auto:kit` task exists; contact appears under "overdue for relationship contact"; logging a call clears it and resets the clock.

Per-milestone checks additionally gate: I-4 (cannot complete a next action without the follow-up prompt), I-5 (capture ≤3 taps), RLS matrix (11 §1) as pgTAP-style tests, HMRC CSV column-exactness against a fixture claim.

## §3 Dependency graph (brief §32)

```
M0 → M1 → M2 → M3 → M5
        ↘ M4 ↗
Phase 2: M6 → M8 ; M4 → M7 ; M3 → M9
```
The data model (02) is the only expensive-to-change layer — it is complete in M0 even where UI arrives later (opportunities table exists from day one, board comes in M6). Everything else is additive; that is the scalability promise of brief §32.

## §4 Deferral register (scope defence — brief §33)

| Item | Disposition | Revisit trigger |
|---|---|---|
| WhatsApp Business Platform | DEFER P3 | 10 §8 |
| Full Gmail sync / inbox sidebar / suggested contacts | DEFER P3 | 10 §8 |
| Receipt PDF generation & numbering | DEFER P2/P3 | 10 §8 |
| Event management, bulk communications, donation web forms | OUT — not specced | Explicit request + register review |
| Cultivation-plan ROI reporting (▸ DonorPerfect) | DEFER P3 | Journeys used ≥3 months |
| Tap-to-pay in-person gifts (▸ Bloomerang mobile) | OUT | Cash/cheque flows prove insufficient |
| ML propensity models (▸ Dataro) | REJECT at this scale | ≥5k donors & real appeal volume |
| Wealth screening / external enrichment | **REJECT permanently** (ICO; 09 §6) | Never |
| Native iOS/Android wrapper | DEFER | PWA install friction reported |

## §5 The verification gate (spec completeness — run before the spec is called done, and re-run when it changes)

- (a) All 35 coverage-matrix rows in 00 point at real, written sections.
- (b) Zero undispositioned rows in 13-INSPIRATION-INDEX.
- (c) Field-name grep: every field named in 03–09 exists in 02/schema-v2, and vice versa for user-facing fields.
- (d) All 8 artboards cross-linked spec↔canvas.
- (e) No BUILD_PLAN contradiction outside 00's flagged-deviations list.
- (f) The four §34 tests traceable to milestones (this file, §2 → M5/M9).
