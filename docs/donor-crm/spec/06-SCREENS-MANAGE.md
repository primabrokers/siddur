# 06 — Screens: Lists, Pipeline, Reports, Settings, Data Quality

*Wireframes: A5 (pipeline), A6 (smart list), A8 (reports).*

---

## §1 Contacts list & smart views — artboard A6

**Purpose.** Every segmentation and work-queue need (brief §20) through one mechanism: saved views over the contacts dataset (03 §4).

**Layout.** Left: pinned views (icon + name + live count). Main: the active view in its layout (table default; kanban/calendar per view). Table = person rows + chosen columns incl. magic columns (03 §4); header click sorts; filter bar shows the view's criteria as removable chips; "Save as view" when criteria are dirty. Multi-select → floating bulk sheet (add tag · set owner · set priority · create task each · export `[admin]`).

**Seeded views** (▸ Close's queue-sequence pattern — each is a queue to work to zero; brief §20's list mapped 1:1):

| View | Criteria sketch |
|---|---|
| Follow-ups today / Overdue follow-ups | open tasks due today / before today |
| No contact 30/60/90 days | days_since_contact thresholds (+ priority variant: "High-priority, quiet 30+") |
| **LYBUNT** / SYBUNT | gave last year not this / some year not this ▸ DonorPerfect one-click |
| High-priority prospects | stage=prospect-ish + priority=high |
| Awaiting response | stage=awaiting_response, sorted by days in stage |
| Meetings this week | scheduled interactions, calendar layout |
| Proposals outstanding | stage=proposal_sent, days-in-stage column |
| Pledges outstanding | pledge balance > 0 |
| Recent gifts needing stewardship | gifts <30 days, thank_you ≠ done |
| Major donors / VIPs | tier=A / tag VIP |
| Gave this year / last year | rollup filters |
| London / Manchester / by community | city / community tag |
| Interested in <project> | interest tag |
| Pre-lapsed rescue list | donor_status=pre_lapsed `[P2 headline, P1 data]` |
| GA: missing declarations | eligible gifts, no declaration (feeds 05 §5) |

**States.** Empty view: what would appear + the creating action. Counts live in the sidebar (a view at 0 is a satisfying grey).

**Permissions.** Views respect row/field RLS automatically (11 §2) — a viewer's LYBUNT list simply lacks amount columns.

---

## §2 Pipeline board `[P2]` — artboard A5

**Purpose.** Manage active asks (opportunities) as moves through stages, with the board itself telling you which ask to push today (brief §7).

**Layout.** Kanban: columns = opportunity stages (identified → qualified → cultivating → solicited → pledged → stewarding), each column header shows the stage's **exit criteria** ("what must be true to advance" ▸ DonorPerfect/Blackbaud moves management) + column total £. Cards: donor, ask amount, probability, expected decision date, flag, next move (the linked task). Footer drop-zones appear on drag: **Won · Lost · On hold** ▸ Pipedrive.

**The three borrowed behaviours:**
1. **Cards sort by next-activity urgency within columns** (red/orange top, yellow "no next move" above grey future) — not by value ▸ Pipedrive — adopted.
2. **Rotting**: per-stage idle threshold (set inline on the column header — I-6); a card idle past it shades red, ambient, no notifications ▸ Pipedrive — adopted. Data: `stage_entered_at`.
3. **Stale-prospects exception list**: a side panel listing opportunities with `last_moved_forward_at` > 90 days ("advance or decide" ▸ MarketSmart quarterly-movement covenant — adapted to a visible list, not a hard rule).

**Interactions.** Drag between stages → `stage_entered_at`/`last_moved_forward_at` update; stage-advance prompts for the next move if none open (I-3/I-4). New opportunity requires contact + name + ask. Won → prompts pledge or gift entry (05); Lost → reason (lookup) for the conversion report.

**Portfolio filter**: "Mine" (relationship_owner) default for fundraisers; "Everyone" toggle. A **weighted pipeline** header: Σ ask, Σ expected (ask × probability).

---

## §3 Reports `[P2]` — artboard A8

**Purpose.** Decisions, not statistics (brief §31): every report answers a question and ends in an actionable list.

**Layout.** A report gallery; each report = charts + the underlying contact/gift list ("…and here are the people"). Core set:

| Report | Content · borrowed pattern |
|---|---|
| **Retention** | Donor retention % YoY with sector benchmarks shown beside own numbers ("you 61% · sector ≈43% · 7+ year donors ≈87%") ▸ Bloomerang/FEP — adopted; new/repeat/lapsed/reactivated counts (lapsed list = one click) |
| Giving over time | By month/year; hard vs soft credit columns kept separate ▸ NPSP |
| By fund / campaign / appeal | The three axes, cross-tab; appeal YoY ("Dinner 2026 vs 2025") |
| **RFM personas** | Champions / Loyal / At-Risk / Can't-Lose-Them / New & Promising / Small & Steady — counts, movement since last quarter, click-through to lists ▸ Keela/Donorfy |
| Pipeline | By stage, weighted value, expected by month, win/loss reasons |
| Fundraiser activity | Interactions logged, tasks completed, asks made — per team member |
| Conversion | Prospect → donor rate; average days in each stage |
| Gift Aid | Claimed this year, recoverable outstanding, declaration coverage % |

Charts follow the app's palette and both themes; every number traces to a query (I-8); benchmarks are labelled with source + year and editable in settings (they age).

---

## §4 Settings & admin

**Purpose.** The few things that genuinely are global (I-6 keeps the rest inline): lookup-list editor (02 §6 — add/rename/recolour/retire values; retiring never deletes history) · automation rules (08 §7 table rendered as toggles + parameter fields, each with plain-English description) · team & roles (invite, role, `can_see_amounts`, digest hour) · AI settings (per-feature on/off, drafting tone examples, monthly cost display) · benchmarks · organisation details (charity number, HMRC reference — feeds GA export) · data export `[admin]` · backups status.

---

## §5 Data quality: merge & import

**Duplicate handling.** At the door: create-time interstitial on normalised phone/email match or name-trigram ≥0.6 — "Is this the same person?" side-by-side, choose open-existing or create-anyway (02 §6). After the fact: a **duplicates queue** (nightly scan pairs, same signals) → **merge tool** (desktop-only): side-by-side field picker, winner keeps all children (interactions, gifts, tasks, tags, declarations re-parented), loser becomes a `merged_into` tombstone so old links redirect. Merge is admin + confirm dialog + audit-logged.

**CSV import wizard** (Phase 1 — the existing spreadsheet is the first real data): upload → column mapping with saved mapping templates → normalisation preview (phones→E.164, dates, titles) → **dedupe pass against existing + within-file** (same signals; per-row resolution: merge/skip/create) → dry-run summary ("142 contacts, 3 duplicates held for review, 890 gifts") → commit with import batch id (one-click undo of the whole batch). Gifts import requires fund mapping; unknown funds prompt creation. `[P3]` **AI backfill**: run the Quick-Capture extractor over a "notes" column to structure legacy free-text into interactions, all rows through a review queue ▸ Momentum Backfill — deferred, 09 §7.
