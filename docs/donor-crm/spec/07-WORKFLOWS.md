# 07 — Workflows

*Ten end-to-end journeys. Each step names the screen (04–06) and the data it mutates (02). These are the scripts the acceptance demos follow (12 §2).*

## §1 The morning (brief §29 · success test 1)

1. **07:30** — the **morning digest email** arrives (pushed; the user never has to remember to open the app ▸ Dex/Clay/Gravyty). Contents (08 §6): meetings today · next actions due (grouped) · overdue count with top 3 · nudges (first-gift calls, failing standing orders, KIT due) · one line of AI narrative `[P2]`. Every line deep-links.
2. Opening any link lands in the **Action Stream** (04 §1) — the same items, live.
3. Optional: **"Start my day"** → Focus mode (04 §2), works the queue one person at a time.
4. End state: stream at zero → reward state. Nothing depended on memory.

## §2 After a call or meeting (brief §24, §30 · the 20–30s path)

1. From anywhere: **[+]** / shortcut / post-call prompt → **Quick Capture** (04 §4).
2. Dictate one sentence → confirm sheet: contact matched, chips filled, date resolved ("after sukkos → Tue 6 Oct").
3. Optionally adjust a chip → **Save**.
4. Mutations: `interactions` row (+`ai_activity_log` resolution) · next-action `tasks` row · KIT clock resets implicitly (computed) · timeline, days-since, Action Stream all reflect it instantly (views, I-9).
5. If the completed item was an existing next action → close-the-loop already satisfied by the new task (I-4).
*Timed budget: ≤30s, ≤3 taps after dictation. This flow is acceptance-tested with a stopwatch.*

## §3 A new donor's first gift (▸ Bloomerang first-time-donor call + Virtuous journeys)

1. Gift entered (05 §1) → triggers (08 §2): thank-you task (routed by size: ≥£500 → relationship owner/director, else any fundraiser ▸ Virtuous routing), receipt queued, GA line evaluated.
2. Donor status computes to `new` → **nudge card** "First gift — call within 48h" on the Action Stream (the highest-retention move a small shop can make).
3. `[P2]` Journey "New donor welcome" attaches (08 §4): Day 1 thank-you call → Day 30 impact note → Day 90 invite to a shiur/event — tasks with relative due dates; the journey exits automatically if the donor gives again or is moved to a major-gift track.
4. No declaration on file → the GA chase (08 §2) queues a declaration request draft.

## §4 Keep-in-touch lifecycle (brief §12 · success test 4)

1. On the profile, cadence set from presets (04 §5.6) — recommended pyramid: top ~50 relationships monthly, next ~100 quarterly, community annual ▸ Dex — guidance shown in the picker, never enforced.
2. Any meaningful logged interaction silently resets the clock (computed from the timeline — no button, no field).
3. Cadence elapses → nightly run creates one `auto:kit` task ("Keep in touch — Rivky Goldstein") if none open → appears in Today + digest.
4. The task's close-the-loop is Quick Capture itself: logging the catch-up call completes it and restarts the cycle.
5. Pause: `kit_paused_until` from the same inline control (bereavement, travel). Reminders never silently expire (03 §5.3).

## §5 Lapse rescue (▸ Virtuous pre-lapsed + signals)

1. Nightly compute moves a donor to `pre_lapsed` (12–18 months since last gift).
2. A **signal task** is created for the relationship owner — not an email to the donor (I-10): "Rescue window: the Adlers usually give at dinner time; last gift 14 months ago." with "why am I seeing this".
3. The pre-lapsed rescue view (06 §1) collects the cohort for a calling session (Focus mode over the view).
4. Outcome paths: gift → status recomputes to active; explicit "not this year" → task snoozed to next cycle + note; no response → stays in view, escalating nudge at lapsed threshold.

## §6 Pledge lifecycle (brief §11)

1. Pledge recorded with schedule (05 §2) → installments generated.
2. Payment arrives → gift entry, applies-to banner links it → balance and progress update (views).
3. Installment passes unpaid → nudge + `auto:pledge_chase` task at +14d, +30d, then monthly (08 §2) — always a task for a human chase, never an automated dunning email.
4. Remainder uncollectable → admin write-off with reason; history preserved.

## §7 Tribute / yahrzeit gift (▸ Neon)

1. Gift entry with tribute toggle: "In memory of R' Katz, notify the Katz family" (05 §1).
2. Saving creates two threads: the donor's thank-you/receipt as normal, and an **acknowledgee-letter task** ("Notify the Katz family — no amount disclosed") → `tributes.notified_at` stamped on completion.
3. Yahrzeit-type tributes can set an annual reminder task (opt-in chip) — next year's date via the Hebrew calendar (10 §6).

## §8 The Gift Aid quarter (05 §5)

1. All quarter long: gifts auto-evaluate; eligible ones join the rolling claim; the missing-declaration queue is worked opportunistically (each recovered declaration shows its £ value).
2. Quarter end: **Review & export** — validation pass, fix rows, generate HMRC CSV, submit via Charities Online, record reference.
3. Claim `submitted` → gifts stamped `claimed`; new rolling claim opens; HMRC payment recorded when it lands (`paid`).

## §9 A major-gift move `[P2]` (▸ moves management + MarketSmart)

1. Prospect identified → opportunity created (stage `identified`, ask range, expected decision).
2. Each stage advance requires its exit criteria met and prompts the next move (I-4); `last_moved_forward_at` updates.
3. Idle too long → card rots on the board; >90 days without forward motion → stale-prospects panel ("advance or decide").
4. Solicited → ask logged as a meeting with `ask_amount`; Won → converts to pledge/gift entry; Lost → reason recorded (feeds conversion report).
5. Stewarding: the win triggers the stewardship journey (thank → update at 3 months → invite) and a KIT cadence upgrade suggestion.

## §10 Data hygiene moments

- **Duplicate at entry**: interstitial → open-existing or create-anyway (06 §5).
- **Duplicate later**: nightly pair scan → duplicates queue → merge tool; tombstone redirects old links.
- **Import day** (Phase 1, week 1 of real use): spreadsheet through the wizard — map, normalise, dedupe, dry-run, commit; batch undo available; funds/campaigns created during mapping.
- **Annual GA back-claim campaign** (▸ Beacon): the "unclaimed past gifts within 4 years" view → declaration-request run (drafts, human sends) → recovered declarations sweep old gifts into the rolling claim.
