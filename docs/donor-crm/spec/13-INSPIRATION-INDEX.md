# 13 — Inspiration Index

*The audit trail of borrowing. One row per researched idea: **ADOPT** (as-is) · **ADAPT** (changed for our context — note says how) · **DEFER** (good, later phase — mapped in 12 §4 / 10 §8) · **REJECT** (considered and declined — reason recorded). An idea with no row was forgotten; a REJECT row proves it was weighed. Inline attributions throughout the spec use the `▸ Borrowed:` convention (00).*

## §1 Donor-CRM products

| Idea | Product | Disposition | Note | Spec § |
|---|---|---|---|---|
| Retention rate as headline metric w/ sector benchmarks | Bloomerang / FEP | ADOPT | Benchmarks editable, labelled with year | 04 §1 · 06 §3 |
| First-time-donor call within 48h, surfaced on dashboard | Bloomerang | ADAPT | Nudge card + routed task, not a ranked top-5 | 08 §2 · 07 §3 |
| Daily action feed of dismiss/snooze cards ("Smart Nudges") | DonorDock | ADOPT | The nudge rail + signals system | 04 §1 · 08 §3 |
| Lifecycle panels + about-to-lapse list w/ one-click export | Kindful | ADAPT | Pre-lapsed rescue view + P2 panel | 04 §1 · 06 §1 |
| Composable dashboard cards = saved filter + display type | Beacon | ADOPT | The only dashboard-card mechanism | 03 §6 |
| Engagement meter (Cold→On Fire) w/ decay + drop alerts | Bloomerang | ADAPT | Deterministic formula, weights configurable; drop → signal | 02 §4.3 |
| Two-axis engagement × capacity | Bloomerang / Keela | ADAPT | Capacity is manual knowledge only (no screening) | 02 §3.1 · 04 §5.1 |
| Unified social-style timeline (gifts, declarations, all) | Bloomerang / Donorfy / Givebutter | ADOPT | | 04 §5.2 |
| Computed donor statuses New/Pre-Lapsed/Lapsed | Virtuous | ADAPT | 12/18-month thresholds for annual-cycle giving; missed recurring = lapse signal | 02 §4.4 |
| Smart Ask amount per donor | Keela | ADAPT | Shown formula, only with ≥3 gifts of history | 04 §5.8 |
| Email-to-CRM logging address | Donorfy | DEFER P3 | The email dropbox | 10 §3 |
| Householding: auto-naming, greetings, rollups | NPSP / Neon / LGL | ADOPT | + Hebrew greeting form | 02 §3.13 |
| Soft credits w/ typed roles, parallel rollups | NPSP | ADOPT | | 02 §3.14 |
| Tags w/ categories, metadata, nightly auto-tags | Donorfy | ADOPT | Replaces v1 arrays | 02 §3.16 |
| Fund / Campaign / Appeal three-axis gift coding | LGL | ADOPT | | 02 §3.8 |
| Moves-management stages w/ exit criteria + required next move | DonorPerfect / Blackbaud | ADOPT P2 | Stage seeds for opportunities | 06 §2 |
| Templated cultivation plans w/ plan-level ROI | DonorPerfect | ADAPT | Sequences → journeys; ROI reporting deferred | 08 §4 · 12 §4 |
| Portfolios/caseloads + quarterly-movement covenant | MarketSmart et al. | ADAPT | Visible stale-prospects list, not a hard rule | 06 §2 |
| Lightweight "Goals" ask records (high/low projection) | LGL | ADAPT | Folded into `opportunities` as columns | 02 §3.9 |
| Auto-assigned donor Levels bound to plans | NPSP | REJECT | Tier stays a human judgement (I-7); journeys cover the sequences | — |
| Engagement Plans: task sequences, relative dates, dependencies | NPSP | ADOPT | As the journey mechanism | 08 §4 |
| Pledge = commitment + installment schedule + write-offs | NPSP / Neon | ADOPT | | 02 §3.5 · 05 §2 |
| Automated pledge reminders / overdue notices to donors | Neon | ADAPT | Chase **tasks** for a human, never donor-facing dunning (I-10) | 08 §3 |
| Missed recurring payment = retention emergency w/ retry | Virtuous / Neon | ADOPT | `failing` state + signal | 05 §2 · 08 §3 |
| Tribute gifts: honoree + acknowledgee notification loop | Neon | ADOPT | + yahrzeit/simcha types, annual reminder | 02 §3.15 · 07 §7 |
| Receipting state machine w/ preference cascade | DonorPerfect | ADAPT | P1 = mark-sent + CSV merge; PDF generation deferred | 05 §3 |
| Dynamic ask arrays (HPC, HPC+25%, recent) | Virtuous / RaiseDonors / Bonterra | ADAPT | Entry shortcuts + drafting hints; no donor-facing forms in scope | 05 §1 |
| GA declaration as first-class record, locked HMRC wording | Beacon | ADOPT | + oral written-confirmation tracking | 02 §3.7 |
| Rolling open GA claim, per-payment auto-eligibility | Beacon / Donorfy | ADOPT | Export = HMRC CSV (no API) | 05 §5 |
| Declaration-chasing workflow | Donorfy | ADOPT | Drafts queued; human sends | 08 §2 |
| GASDS small-donation flag | Beacon | ADOPT | | 02 §3.4 · 05 §5 |
| Trigger library keyed to giving milestones, routed by size | Virtuous / DP SmartActions | ADAPT | Fixed legible library + parameters, not a rule-builder UI | 08 §2 |
| Donor journeys w/ wait steps + auto-exit | Virtuous / Bloomerang | ADAPT | Task-only steps (no automated donor emails) | 08 §4 |
| Signals: behaviour thresholds → alert/task, not email | Virtuous | ADOPT | | 08 §3 |
| Tasks linkable to any record | Beacon | ADAPT | Tasks bind to contacts only (I-2); other records via `opportunity_id` + context | 02 §3.3 |
| Context-rich task notification emails | Bloomerang / Beacon | ADOPT | Act from the email itself | 08 §6 |
| Capture-focused mobile app (<1 min logging) | Bloomerang / Virtuous | ADOPT | Via PWA Quick Capture | 04 §4 |
| Tap-to-Pay in-person gifts | Bloomerang | REJECT for now | Cash/cheque/voucher-agency flows suffice; revisit trigger in 12 §4 | — |
| Nearby-supporters map for trip planning | Virtuous | REJECT | Doesn't fit one-city community fundraising | — |
| One-click LYBUNT/SYBUNT actionable lists | DonorPerfect / Givebutter | ADOPT | Seeded smart views | 06 §1 |
| RFM auto-segmentation into named personas | Keela / Donorfy | ADOPT P2 | Nightly auto-tags | 02 §4.5 |
| Benchmarks embedded beside own numbers | Bloomerang / FEP | ADOPT | | 06 §3 |
| Simplicity as the feature; custom record types over modules | LGL / Beacon | ADOPT stance | Fixed concepts; no record-type builder | 01 I-6 |

## §2 Modern CRM UX

| Idea | Product | Disposition | Note | Spec § |
|---|---|---|---|---|
| Action Stream: home = queue of contacts w/ one next action | OnePageCRM | ADOPT | The home screen | 04 §1 |
| Close-the-loop follow-up prompt on completion | Pipedrive | ADOPT | Invariant I-4 | 01 |
| Traffic-light flags; "no activity" ranks worst | Pipedrive | ADOPT | Yellow in the flag language | 03 §2 |
| Queued (dateless, ordered) + Waiting-for task states | OnePageCRM | ADOPT | | 02 §3.3 · 04 §3 |
| Per-stage rotting thresholds, ambient card decay | Pipedrive | ADOPT P2 | Set inline on column | 06 §2 |
| Tiered KIT presets (Monthly/Quarterly/…) + pyramid guidance | Dex | ADOPT | Preset chips + guidance, never enforced | 04 §5.6 |
| "Automatic" cadence inferred from history | Clay.earth | DEFER P3 | Needs usage history first | — |
| Reminders never silently expire | Clay.earth | ADOPT | 03 §5.3 |
| Any logged touch silently resets the KIT clock | Dex / Clay / folk | ADOPT | Computed from timeline | 07 §4 |
| Morning digest pushed to inbox | Dex / Clay | ADOPT | | 08 §6 |
| Inbox/Future/Done triage + snooze as core verb | Close | ADOPT | Stream tabs | 04 §1 |
| "Start queue" focus mode, one task full-screen | HubSpot | ADOPT | | 04 §2 |
| Today/Upcoming/Anytime tiers; This-Evening split | Things 3 | ADAPT | Today/Upcoming tabs; queued ≈ Anytime; no evening split | 04 §1 |
| One-click "Reschedule all" for overdue | Todoist | ADOPT | Post-Yom-Tov recovery | 03 §5.4 |
| Rewarding empty state | Superhuman / Todoist | ADAPT | Quiet visual, no confetti | 03 §5.6 |
| NL quick-add w/ live token highlight + tap-to-unparse | Todoist | ADOPT | Via AI chips + refusable date chip | 04 §4 · 09 §2 |
| Magic Plus omnipresent capture button | Things 3 | ADAPT | Always opens Quick Capture | 03 §1 |
| Post-call sheet: log + note + follow-up in one flow | Pipedrive mobile | ADOPT | Also after wa.me returns | 04 §4 · 10 §2 |
| Auto-logging as default; no required fields on logs | Close / Copper | ADAPT | Auto where observable (email ingest P3); I-5 for the rest | 04 §4 |
| One-click capture from an email thread | Streak / folkX | DEFER P3 | With the dropbox/sidebar decision | 10 §3 |
| Suggested contacts from email traffic | Copper | DEFER P3 | | 10 §3 |
| Saved smart views as named work queues, worked to zero | Close | ADOPT | Seeded set | 06 §1 |
| Views as lenses; objects vs lists w/ list-local attributes | Attio / Notion | ADOPT | saved_views; kanban/calendar layouts | 03 §4 |
| Computed magic columns | Streak | ADOPT | From `contact_stats` | 02 §4.2 |
| Floating bulk-action sheet on multi-select | Attio | ADOPT | | 03 §4 |
| Cmd+K palette + "/" search; shortcuts taught inline | Attio / Linear / Superhuman | ADOPT | | 03 §3 |
| 100ms rule; optimistic UI; undo-instead-of-confirm | Superhuman / Linear | ADOPT | Invariant I-12 | 01 |
| Merged timeline w/ type filters; ONE pinned note | HubSpot | ADOPT | | 04 §5.2 |
| Whole relationship on one page; act-from-record | Attio / Close | ADOPT | | 04 §5.7 |
| Reminders can only exist attached to a person | folk | ADOPT | Invariant I-2, org-self escape hatch | 01 |
| Multi-membership lightweight groups | folk | ADOPT | Via tags | 02 §3.16 |
| Kanban sorted by next-activity urgency; drag-down Won/Lost | Pipedrive | ADOPT P2 | | 06 §2 |
| One-to-many personalised send w/ stop-on-reply | folk | DEFER P3 | Bulk comms out of scope for now | 12 §4 |
| CRM sidebar inside Gmail | Copper / Streak | DEFER P3 | | 10 §3 |
| Colour status pills, editable in cell | monday | ADAPT | Computed pills visually distinct from manual (I-7) | 03 §2 |
| Config lives where the work happens | Pipedrive / Dex / Copper | ADOPT | Invariant I-6 | 01 |

## §3 AI-in-CRM

| Idea | Product | Disposition | Note | Spec § |
|---|---|---|---|---|
| Voice debrief → extraction against a fixed field schema | Momentum / snapAddy | ADOPT | Quick Capture's core | 09 §2 |
| Post-capture "recommended updates" panel, apply/edit/dismiss | HubSpot | ADOPT | The confirm sheet | 04 §4 |
| Raw input kept + click-to-source provenance | Granola | ADOPT | `ai_raw_input` + chip→phrase | 09 §1.3 |
| Botless capture (no meeting-recording bots) | Granola | ADOPT | Post-call dictation; no recordings, no consent tangles | 09 §2 |
| Auto-create unknown contacts, mapping config | Fireflies | ADAPT | Explicit "create new?" chip; never silent | 09 §2 |
| Daily "First Draft" outreach email in the inbox | Gravyty | ADAPT P2 | Max one/day, reason surfaced, AI never sends | 09 §4 |
| Drafts in the fundraiser's own voice, "confirmed by you" | Momentum | ADOPT P2 | Tone from pasted examples | 09 §4 |
| Pre-meeting digest + prep nudge 48h ahead | Salesforce / HubSpot | ADOPT P2 | | 09 §3 |
| Grounded generation w/ source facts rendered alongside | Salesforce NP Cloud | ADOPT | Anti-hallucination rule | 09 §1.3 |
| Next-best-action cards w/ logged accept/reject | Salesforce Einstein | ADOPT | `ai_activity_log` + KPI | 09 §1.5 |
| CRM chat that reads and writes records | Breeze / ChatSpot | ADAPT P3 | Read-only NL→filters, in-context (their own pivot lesson) | 09 §7 |
| AI attributes: prompt-computed typed fields | Attio | DEFER P3 | Internal data only | 09 §7 |
| Eval suites + tracing per prompt version | Attio | ADOPT | The engineering bar, from P1 | 09 §8 |
| Rolling AI "next steps" field on the record | Gong | ADOPT P2 | "Where we're holding" | 04 §5.8 |
| Keyword-based smart trackers | Gong | REJECT | Context misfires; extraction is semantic w/ provenance instead | — |
| Backfill extraction over historical notes | Momentum | DEFER P3 | With review queue | 09 §7 · 06 §5 |
| Insight paired with one-click action | Bloomerang | ADOPT | | 09 §6 |
| Plain-English score tiers + explicit insufficient-data tier | DonorSearch (DS3) | ADOPT | "Not enough history yet" | 02 §4.3 |
| Propensity trained on own giving data only | Dataro | ADAPT | Formulas, not ML, at this scale; AI explains | 09 §6 |
| Wealth screening / external enrichment of individuals | DonorSearch / iWave / Windfall | **REJECT permanently** | ICO fined 13 UK charities for covert screening; capacity stays manual | 09 §6 · 11 §3 |
| Signal → threshold → triggered task | Virtuous / Zoho Zia | ADOPT | Deterministic signals | 08 §3 |
| Autonomy ladder; draft-mode default; earned autonomy | HubSpot Breeze | ADOPT | L0→L2, promotion criteria | 09 §1.2 |
| Two-state AI labelling (generated vs reviewed) | IBM Carbon / Cloudscape / EU guidance | ADOPT | | 09 §1.4 |
| No accept-all; reject first-class; edit-rate as KPI | HITL pattern literature | ADOPT | | 09 §1 |
| Live NL date parse, refusable inline | Todoist / Fantastical | ADOPT | Date chips | 09 §2 |
| Fuzzy cultural dates via deterministic resolver | practitioner pattern (no shipped product) | ADOPT | The Hebcal resolver — signature feature | 09 §2 · 10 §6 |
| Email thread summary + sentiment, pull-based | Pipedrive | DEFER P3 | With email ingest | 10 §3 |
| AI-drafted condolence messaging | (Vanderbilt failure) | **REJECT permanently** | Hard exclusion in every drafting surface | 09 §1.6 |
| Standalone AI chatbot as the interface | ChatSpot v1 | REJECT | Their own retreat: in-context beat standalone | 09 §7 |

## §4 Rejections at a glance

Permanently rejected, with the reason on record: **WhatsApp Web scraping/bridges** (ToS, ban risk — 10 §2) · **covert wealth screening & external enrichment** (ICO enforcement) · **AI-drafted condolence/bereavement content** (Vanderbilt) · **keyword smart-trackers** (context misfires) · **standalone chatbot UI** (adoption) · **ML propensity at this scale** (small-data honesty) · **auto-assigned donor levels** (I-7). Deferred-with-trigger items live in 10 §8 and 12 §4.
