# 08 — Automations

*The deterministic engine behind "the CRM remembers for me". Two mechanisms only: database triggers (instant, transactional) and the nightly run (pg_cron, 05:00 UTC). Every rule is a row in `automation_rules` — configurable, toggleable, never hard-coded (brief §22). Two laws from 01: automations create tasks/flags/drafts, never send (I-10); anything computable is computed, not stored (I-9) — so "overdue" needs no rule at all.*

## §1 Architecture

- **Triggers** react to writes: gift saved, declaration saved, stage changed. They create tasks, stamp statuses, maintain soft credits and audit rows.
- **The nightly run** (`run_nightly()`) reads `automation_rules`, recomputes scores/statuses/tags, creates due tasks and **signals** (a nudge-card row with a reason string — the "why am I seeing this"), and assembles digest content.
- Every automation-created task carries `origin` (02 §3.3) and is idempotent: a rule never creates a second open task of the same origin for the same contact/subject.

## §2 Trigger library (instant)

▸ **Borrowed:** Virtuous giving-milestone triggers + DonorPerfect SmartActions (rule = trigger + filter + action, routed by size) — adapted to a fixed, legible library rather than a rule-builder UI (I-6: a solo team configures parameters, not logic).

| Rule key | Trigger → action | Default params |
|---|---|---|
| `thank_you_on_gift` | Gift saved → thank-you task; **routing**: `amount_gbp ≥ big_gift_threshold` → assign relationship owner (else default assignee); ≥ `major_gift_threshold` → also a same-day nudge | big £500 · major £5,000 · skip if open |
| `receipt_on_gift` | Gift saved → receipt queued per preference cascade (gift → donor → system) | system default: email |
| `first_gift_call` | Donor's **first-ever** gift → "call within 48h" nudge + task ▸ Bloomerang | on |
| `gift_aid_evaluate` | Gift/declaration saved → recompute `gift_aid_status`; eligible → attach to rolling claim ▸ Beacon | on |
| `ga_declaration_chase` | Eligible-but-undeclared gift → declaration-request draft queued (human sends) ▸ Donorfy | on |
| `household_soft_credit` | Gift saved → soft credits for household members maintained ▸ NPSP | on |
| `influencer_prompt` | Gift saved by an introduced contact → the one-tap influencer credit chip (05 §1) — a UI prompt, not a write | on |
| `tribute_acknowledgee` | Tribute with notify → acknowledgee-letter task ▸ Neon | on |
| `stage_change_prompts` | Contact stage → `proposal_sent` starts the proposal timer (§3); opportunity stage advance → prompt next move (I-4) | on |
| `pledge_schedule` | Pledge saved → installments generated; payment applied → balance recompute | on |

## §3 Nightly rules — tasks & signals

| Rule key | Logic | Defaults |
|---|---|---|
| `kit_due` | `kit_due_on < today` & no open `auto:kit` task → create KIT task | per-contact cadence |
| `proposal_follow_up` | stage `proposal_sent` & no interaction since & no open follow-up → task | 7 days |
| `pledge_chase` | installment past due & no open chase task → task | +14d, +30d, then every 30d |
| `recurring_failing` | expected recurring payment late → agreement `failing`, missed_count++, **signal** ("call, don't email") ▸ Virtuous/Neon | 7 days late |
| `neglect_flags` | meaningful-contact gaps vs thresholds → signal per contact | High 30d · Active donor 60d · VIP 90d (brief §13) |
| `engagement_recompute` | Score per 02 §4.3; **tier drop → signal** to relationship owner ▸ Bloomerang | weights/thresholds in params |
| `donor_status_recompute` | Statuses per 02 §4.4; entered `pre_lapsed` → signal ▸ Virtuous | 12/18-month thresholds |
| `meeting_reminder` | Scheduled interaction tomorrow → reminder task (+ push later) | 1 day before |
| `stale_prospects` `[P2]` | `last_moved_forward_at` > threshold → panel list (no tasks — avoids spam) ▸ MarketSmart | 90 days |
| `auto_tags` | Reapply every `tags.is_auto` rule (saved-view criteria) ▸ Donorfy | nightly |
| `rfm_recompute` `[P2]` | Quintiles → persona tags (02 §4.5) | nightly |
| `no_next_action_audit` | Active-stage contacts with no open task & no cadence → the yellow count surfaced on the stream (I-3) — surfaced, never auto-fixed | on |
| `duplicate_scan` | New pair candidates → duplicates queue (06 §5) | nightly |

Signals are rows (contact, reason, rule, created, dismissed/snoozed state) rendered as nudge cards; dismiss/snooze is logged, and a dismissed signal never re-fires for the same underlying condition until the condition resets.

## §4 Journeys `[P2]`

▸ **Borrowed:** Virtuous/Bloomerang journey automation — adapted: journeys are **task sequences only** (no automated donor-facing email steps — I-10), with wait steps and auto-exit.

A journey template = named sequence of steps (task blueprint + relative day offset + optional depends-on-previous ▸ NPSP engagement plans). Entry criteria = a saved view; exit = criteria no longer met, or terminal step done, or manual. Seeds: **New donor welcome** (Day 1 call · Day 30 impact note · Day 90 event invite) · **Recurring donor onboarding** · **Lapsed reactivation** · **Major-gift stewardship** (post-win: thank · 3-month update · 6-month visit) · **New parent at the yeshiva**. Attaching a journey shows its whole future task list on the profile; deleting mid-way cancels remaining steps.

## §5 The nightly run — order of operations

1. Recompute: engagement scores → donor statuses → auto-tags → RFM `[P2]` → duplicate scan.
2. Evaluate task rules (§3) — create tasks idempotently.
3. Evaluate signal rules — create/refresh signals.
4. Refresh materialised aggregates if any (only if profiling shows `contact_stats` needs it — otherwise it stays a live view, I-9).
5. Assemble per-user digest payloads (§6).
6. Write a run log row (started, finished, created counts) — visible in Settings for trust/debugging.

## §6 Notifications & the morning digest

- **Digest** (per team member, at `digest_hour`, email `[P1]`): my meetings today · my next actions due (grouped by type) · overdue (count + top 3) · signals for my contacts · KIT due · `[P2]` pledge/pipeline lines + one-paragraph AI narrative (09 §5). Every line deep-links. Quiet days send a two-line digest — never silence (trust the habit).
  ▸ **Borrowed:** Dex/Clay pushed digest + Gravyty's "meet them in the inbox" — adopted.
- **Task notification emails** contain full context (contact, phone, the gift, the reason) so the recipient can act from the email itself ▸ Bloomerang/Beacon — adopted.
- Web push `[P3]`: meeting reminders and major-gift nudges only. No notification ever goes to a donor.

## §7 Rule reference & configuration surface

All rules above render in Settings (06 §4) as one table: toggle · plain-English description · parameter fields (days, thresholds, routing amounts) · last-run result. Params live in `automation_rules.params` (jsonb) — the UI is generated from a static per-rule schema, so adding a rule is a code change, tuning one never is (brief §22).
