# 03 — UI Foundations

*The shared visual and interaction system. Screens in 04–06 compose these parts; they never invent parallel mechanisms.*

## 1. App shell & navigation

**Desktop** (≥1024px): left sidebar — Today (Action Stream) · Contacts · Pipeline `[P2]` · Giving · Reports `[P2]` · Settings — with pinned saved views under Contacts (06 §1). Content area right. Top bar: global search ("/"), quick-capture button, user menu.

**Mobile**: bottom tab bar — Today · Contacts · **[ + ]** · Giving · More — where **[ + ]** is the omnipresent capture button, thumb-reachable, opening Quick Capture with a sensible default destination.
▸ **Borrowed:** Things 3's Magic Plus — adapted: it always opens Quick Capture (the product's one capture entry point) rather than a positional insert.

The PWA manifest registers a home-screen shortcut directly to Quick Capture (same pattern as the existing siddur app's shortcuts).

## 2. The flag language

One colour system encodes relationship/task health everywhere it appears — Action Stream rows, profile headers, pipeline cards, list chips:

| Flag | Meaning | Source of truth |
|---|---|---|
| 🔴 red | Next action overdue | `tasks.due_on < today`, open |
| 🟠 orange | Next action due today | `tasks.due_on = today` |
| 🟡 yellow | **No next action at all** (active-stage contact) | no open dated task & no KIT cadence |
| 🔵 blue | Waiting on them | `tasks.status = 'waiting'` (+ `waiting_for` shown) |
| ⚪ grey | Future action scheduled | `tasks.due_on > today` |
| ▫ dashed | Only queued (dateless) actions behind the current one | `status='queued'` |

▸ **Borrowed:** OnePageCRM's Action-Stream flags merged with Pipedrive's traffic-lights — adopted, with Pipedrive's key insight kept intact: **yellow ranks worse than grey** in every sort (I-3).

Sort order wherever flags sort a list: red → orange → yellow → blue → grey. Status pills (stage, donor status, pledge state) are full-colour, editable in place with one click where manual.
▸ **Borrowed:** monday.com's colour-pill language — adapted: computed pills (donor status, engagement tier) are visually distinct (outlined, lock glyph on hover) from manual pills (filled), reinforcing I-7.

## 3. Command palette & global search (brief §21)

- **"/" anywhere** opens record search: fuzzy, typo-tolerant, across name, Hebrew name, organisation, phone (digit-normalised), email, city. Results show name · stage pill · flag · last gift · last contact · next action — enough to act without opening the record (brief §21's exact field list).
- **Cmd/Ctrl+K** opens the command palette: actions ("log interaction", "new gift", "go to Pipeline", "start my day"), each displaying its keyboard shortcut inline so the palette teaches the faster path. Context-aware ranking (current screen, usage frequency), default suggestions before typing.
- Implementation: Postgres FTS + `pg_trgm` behind one endpoint; results <300ms (11 §5); recent-records cache serves instantly while the query runs.

▸ **Borrowed:** Attio's "/" vs Cmd+K split + Superhuman's palette rules (fuzzy, synonyms, shortcut teaching, context ranking) — adopted.

## 4. Views as lenses

One dataset, many named views. A **saved view** (02 §3.18) = entity + filters + sort + layout (table / kanban / calendar) + visible columns + group-by. Switching views never mutates data; the same contact appears in any number of views.

- **Magic columns**: any derived field from `contact_stats` (days since contact, YTD giving, days in stage, pledge balance, engagement tier, RFM segment…) can be added as a read-only sortable column. ▸ **Borrowed:** Streak — adopted.
- **Bulk actions**: checkbox-select rows → a floating action sheet rises from the bottom with count + verbs (add tag, set owner, set priority, create task for each, export `[admin]`). Appears only while a selection exists. ▸ **Borrowed:** Attio — adopted.
- Views are workable queues: a view's rows change as records match/unmatch its criteria; the daily habit is "work the view to zero". ▸ **Borrowed:** Close smart views — adopted (seeded set in 06 §1).

## 5. Interaction rules

1. **100ms.** Every tap/keystroke acknowledges in under 100ms: optimistic writes with background sync; skeletons only for cold loads. ▸ Superhuman.
2. **Undo, not confirm.** Single-record mutations execute immediately with a 6-second undo toast. Confirmation dialogs only for: bulk mutations, merges, deletes `[admin]`, and anything leaving the system (an export, an HMRC file). ▸ Linear.
3. **Snooze is a first-class verb** on every task/nudge/reminder: tomorrow · next week · after a date · pick date. Snoozed items return silently. Nothing auto-dismisses (▸ Clay: reminders never silently expire; ▸ Close: snooze).
4. **Overdue is recoverable in one tap**: any overdue group shows "Reschedule all → today / spread over this week". Coming back after Yom Tov must not mean 40 individual re-dates. ▸ Todoist.
5. **Close the loop**: completing a next action opens the follow-up prompt in the same dialog (I-4), prefilled from context (action type default: same channel; date default: the contact's cadence or +1 week).
6. **Empty states are rewards, not blanks.** Action Stream at zero shows a full-bleed congratulatory state ("Everyone's taken care of today"); list empty states say what would appear here and offer the creating action. ▸ Superhuman inbox-zero — adapted: quiet visual, no confetti.
7. **Every AI touchpoint is labelled** ("Drafted with AI" chip until a human accepts → label changes to "Reviewed") and carries "why am I seeing this" on hover (09 §1).

## 6. Component vocabulary

| Component | Used in | Definition |
|---|---|---|
| **Person row** | Action Stream, lists, search results | Avatar/initials · name · flag · one next-action line · 2–3 context chips (stage, days-since, YTD) · inline actions on hover (call, WhatsApp, log, snooze) |
| **Timeline entry** | Profile | Icon by kind · date · summary · outcome · source label (manual/AI/import) · expandable detail |
| **Metric card** | Dashboard, reports | A saved filter + display type: single number · progress ring · live list ▸ Beacon — adopted as the only dashboard-card mechanism |
| **Nudge card** | Action Stream rail | Reason ("No contact in 92 days — VIP") · person · two buttons (act / snooze) · dismiss ▸ DonorDock |
| **Suggestion card** | AI surfaces | Provenance line · proposed content/chips · Accept / Edit / Dismiss ▸ Einstein NBA |
| **Ask-array chips** | Gift/pledge entry, drafting | 3–4 amounts computed from history (last gift · HPC · HPC+25%) ▸ Virtuous |
| **Stage/status pills** | Everywhere | §2 above |
| **Confirm sheet** | Quick Capture | Editable chip per extracted field; tap chip → correct; date chips show the resolved date ▸ Todoist/Fantastical (09 §2) |

## 7. Responsive strategy (brief §24)

True mobile-first designs (not reflow): **Today/Action Stream**, **Quick Capture**, **Profile (read + act)** — these are the after-meeting, out-of-the-building surfaces. Responsive reflow is acceptable for: lists, giving screens, reports, settings. Desktop-only: merge tool, import wizard, Gift Aid claim submission (precision work). Offline behaviour for capture: 11 §6.
