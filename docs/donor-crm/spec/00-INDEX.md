# 00 — Index & Conventions

*Yeshiva Donor CRM — full product specification · v1 · August 2026*

This folder is the **execution-layer specification** for the custom donor CRM. It sits beneath [`../BUILD_PLAN.md`](../BUILD_PLAN.md) (the strategy layer: architecture, build-vs-buy, phases, costs) and supersedes [`../schema.sql`](../schema.sql) (now regenerated as [`../schema-v2.sql`](../schema-v2.sql) to match `02-DATA-MODEL.md`).

## How to read this spec

| You are… | Read |
|---|---|
| The developer building it | Everything, in numbered order. `01` and `02` before anything else. |
| Reviewing a single feature | Find it in the coverage matrix below, jump to its section. |
| The yeshiva contact | Don't read this folder — read [`../PROPOSAL.md`](../PROPOSAL.md) (or the shared proposal page). |

## The files

| # | File | What it specifies |
|---|---|---|
| 00 | this file | Conventions, glossary, brief coverage matrix |
| 01 | [PRINCIPLES](./01-PRINCIPLES.md) | The product constitution — invariants every other doc obeys |
| 02 | [DATA-MODEL](./02-DATA-MODEL.md) | Entities, field-level dictionary, deltas vs schema v1 |
| 03 | [UI-FOUNDATIONS](./03-UI-FOUNDATIONS.md) | Shell, flag language, search, views, interaction rules |
| 04 | [SCREENS-DAILY](./04-SCREENS-DAILY.md) | Action Stream, focus mode, tasks, Quick Capture, Donor Profile |
| 05 | [SCREENS-GIVING](./05-SCREENS-GIVING.md) | Gift entry, pledges, receipting, campaigns/funds/appeals, Gift Aid |
| 06 | [SCREENS-MANAGE](./06-SCREENS-MANAGE.md) | Lists & smart views, pipeline, reports, settings, merge/import |
| 07 | [WORKFLOWS](./07-WORKFLOWS.md) | Ten end-to-end journeys, step by step |
| 08 | [AUTOMATIONS](./08-AUTOMATIONS.md) | Trigger library, signals, journeys, nightly run, rule reference |
| 09 | [AI-SPEC](./09-AI-SPEC.md) | Every AI feature: contract, review UI, failure modes, evals |
| 10 | [INTEGRATIONS](./10-INTEGRATIONS.md) | WhatsApp, email, calendar, Drive, Hebcal, HMRC |
| 11 | [PERMISSIONS-NFR](./11-PERMISSIONS-NFR.md) | Roles/RLS, GDPR, audit, performance, offline, backups |
| 12 | [BUILD-SEQUENCE](./12-BUILD-SEQUENCE.md) | Milestones, acceptance tests, dependency graph, deferrals |
| 13 | [INSPIRATION-INDEX](./13-INSPIRATION-INDEX.md) | Every borrowed idea → product → disposition → spec section |
| — | [wireframes/](./wireframes/) | Artboard sources + PNG exports + [interactive canvas](https://claude.ai/code/artifact/58504c9e-aa3a-48f0-b276-11c4ba5734f6) |

## Conventions

**Attribution.** This spec is deliberately built from proven ideas in other products. Every borrowed design decision carries an inline attribution where the decision is made:

> ▸ **Borrowed:** *pattern* (Product) — adapted: *how it differs here*

The roll-up lives in `13-INSPIRATION-INDEX.md`: one row per researched idea with a disposition — **ADOPT** (as-is), **ADAPT** (changed for our context), **DEFER** (good, later phase), **REJECT** (considered and declined, with reason). An idea with no row was forgotten; a REJECT row proves it was considered.

**Screen spec template** (used throughout 04–06): Purpose → Layout → Elements (each with its data source from `02`) → States (incl. empty/loading/error) → Interactions → Mobile variant → Permissions → Wireframe link.

**Phase tags.** Features are tagged `[P1]` `[P2]` `[P3]` matching BUILD_PLAN phases. Untagged = P1.

**Source of truth.** Spec text wins over wireframes; wireframes are illustrative. Where this spec deviates from BUILD_PLAN.md, the deviation is listed below — anything else that appears to conflict is a bug in this spec.

### Deviations from BUILD_PLAN.md

1. **Households, soft credits, tributes, funds/appeals, recurring agreements and installment schedules** are added to the data model (BUILD_PLAN's draft schema lacked them). Rationale in `02-DATA-MODEL.md` §2.
2. **Engagement score & computed donor status** replace BUILD_PLAN's manual `engagement_level` field (two-axes rule — see `01`, invariant I-7).
3. **Pipeline stages** adopt moves-management vocabulary as the *seed* configuration for the brief's §5 stage list (still user-configurable).
4. Everything else deepens BUILD_PLAN without contradiction.

## Glossary

| Term | Meaning here — and what it is *not* |
|---|---|
| **Contact** | A person or organisation record. *Not* a household. |
| **Household** | A grouping of contacts (spouses, family) with combined giving rollups and one salutation. A gift always belongs to one contact; the household sees it via soft credit. |
| **Gift / Donation** | Money received (or pledged) — one row per gift. |
| **Pledge** | A gift-shaped *commitment* with an installment schedule; payments are separate gift rows applied to installments. |
| **Installment** | One expected payment within a pledge schedule. |
| **Recurring agreement** | An open-ended standing commitment (monthly standing order) — distinct from a pledge, which has a fixed total. |
| **Fund** | Accounting destination of money (General, Scholarships, Building). |
| **Campaign** | A fundraising initiative with a goal and dates (Building Campaign 2027). |
| **Appeal** | The specific solicitation that produced a gift (Dinner 2026 letter, Purim appeal). |
| **Stage** | The *manual, configurable* relationship stage set by the fundraiser (brief §5). |
| **Donor status** | The *computed* giving state (New / Active / Pre-Lapsed / Lapsed) — never hand-set. |
| **Engagement score** | The computed relationship-warmth tier (Cold → On Fire) — never hand-set. |
| **Task** | Any to-do. A task attached to a contact whose action type is a contact method is that relationship's **next action**. |
| **Interaction** | A logged (or scheduled) touch: call, WhatsApp, meeting, email, event, letter. |
| **Meaningful contact** | An interaction whose type (or per-record override) counts toward the keep-in-touch clock. |
| **KIT** | Keep-in-touch — the per-contact cadence system. |
| **Declaration (GAD)** | A Gift Aid declaration record. |
| **LYBUNT / SYBUNT** | Gave **L**ast **Y**ear / **S**ome **Y**ear **B**ut **U**nfortunately **N**ot **T**his. |

## Brief coverage matrix

Every section of the original requirements brief (§1–35) maps to spec sections and, where applicable, a wireframe artboard. *(Filled during writing; verified complete at the gate — see 12 §5.)*

| Brief § | Requirement | Spec section(s) | Artboard |
|---|---|---|---|
| 1 | Overall objective — CRM remembers for me | 01 (I-1..I-4); 04 §1; 07 §1 | A1, A4 |
| 2 | Core philosophy: Person→…→Next Action→Reminder | 01 I-1; 04 §5; 07 §2 | A2 |
| 3 | Donor/contact profile fields | 02 §3.1; 04 §5 | A2 |
| 4 | Relationship information | 02 §3.1 (relationship block); 04 §5 | A2 |
| 5 | Fundraising/relationship stage (configurable) | 02 §3.1 + §6 (lookups); 06 §2 | A5 |
| 6 | Priority & donor classification | 02 §3.1; 02 §5 (tags) | A2, A6 |
| 7 | Fundraising potential & opportunity | 02 §3.9; 06 §2 | A5 |
| 8 | Donation history, structured + rollups | 02 §3.4–3.8, §4; 05 §1–2 | A2 |
| 9 | Complete interaction history / timeline | 02 §3.2; 04 §5 | A2 |
| 10 | Next Action on every relationship | 01 I-1; 02 §3.3; 04 §1, §3 | A1 |
| 11 | Follow-ups & automatic reminders | 08 §2, §5, §6 | A1 |
| 12 | Keep-in-touch frequency system | 02 §3.1; 04 §5; 07 §4; 08 §5 | A2 |
| 13 | Days since last contact (+ thresholds) | 02 §4; 04 §1, §5; 08 §3 | A1, A6 |
| 14 | Personal relationship intelligence | 02 §3.1; 04 §5; 11 §3 (minimisation) | A2 |
| 15 | Notes (dated, authored, categorised) | 02 §3.11; 04 §5 | A2 |
| 16 | Task management | 02 §3.3; 04 §3 | A1 |
| 17 | Meetings (structured, calendar) | 02 §3.2 (meeting fields); 04 §4; 10 §4 | A3 |
| 18 | Documents & files | 02 §3.12; 04 §5; 10 §5 | A2 |
| 19 | Main dashboard (action dashboard) | 04 §1; 03 §2 | A1, A4 |
| 20 | Smart lists & filters | 06 §1; 03 §4 | A6 |
| 21 | Fast global search | 03 §3 | — |
| 22 | Automation (configurable) | 08 all | — |
| 23 | Email/calendar/WhatsApp/Drive integrations | 10 all | — |
| 24 | Mobile experience, 20–30s update | 04 §4; 03 §7; 11 §6 | A3, A4 |
| 25 | Data quality & structure | 02 §5–6; 06 §5; 01 I-9 | — |
| 26 | Permissions & security | 11 §1–2 | — |
| 27 | Recommended data structure (connected areas) | 02 §1 | — |
| 28 | At-a-glance profile header | 04 §5.1 | A2 |
| 29 | Daily workflow | 07 §1–2 | A1, A3 |
| 30 | Simplicity principle | 01 I-5, I-6; 04 §4 | A3 |
| 31 | Reporting | 06 §3 | A8 |
| 32 | Future scalability | 12 §3–4; 10 §8 | — |
| 33 | What I do NOT want | 01 (anti-goals) | — |
| 34 | Success tests 1–4 | 12 §2 (acceptance tests) | — |
| 35 | Development phases | 12 §1 | — |

Plus additions not in the brief: **Gift Aid** (05 §5, 02 §3.7 — artboard A7), **households & soft credits** (02 §3.13–3.14), **AI features** (09 — artboard A3).
