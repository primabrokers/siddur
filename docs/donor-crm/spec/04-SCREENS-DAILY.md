# 04 — Screens: The Daily Loop

*The five surfaces the fundraiser touches every day. Wireframes: artboards A1–A4.*

---

## §1 Action Stream (home / "Today") — artboards A1 (desktop), A4 (mobile)

**Purpose.** Answer "who needs me today?" in one glance, with zero memory required (brief §1, §19, §29). It is a queue of **people**, not a database or a chart wall.
▸ **Borrowed:** OnePageCRM's Action Stream — adopted as the product's home screen; DonorDock's ActionBoard nudges; Close's Inbox/Future/Done; Beacon's metric cards.

**Layout (desktop).** Three zones:
1. **Metric strip** (top): 4 metric cards (03 §6) — *Due today* (count) · *Overdue* (count) · *Donor retention* (headline %, with sector benchmark caption "sector ≈43%" ▸ Bloomerang/FEP) `[P2]` · *This month's giving* (progress ring vs same month last year). Cards are live saved-filters; clicking opens the underlying list.
2. **The stream** (centre, the bulk): person rows (03 §6), one per contact with an actionable item, sorted red → orange → yellow → blue, then by priority. Tabs: **Today** (default: overdue + due-today + nudges) · **Upcoming** (dated future + snoozed, grouped by day) · **Done** (today's completions, for the end-of-day glow). ▸ Close's three-state inbox; Things 3's Today/Upcoming split.
   Sections within Today, in order: **Meetings today** (scheduled interactions, with time and "Brief me" button `[P2]`) · **Next actions due** (grouped by action type: calls together, WhatsApps together — brief §19's "Calls Due / Messages Due") · **Keep-in-touch due** (KIT tasks) · **Needs a next action** (yellow-flag contacts — the I-3 surfacing; header shows count: "3 active relationships have no next action").
3. **Nudge rail** (right): nudge cards (03 §6) from signals & automations — "First gift this week: call the Kleins 🔥" (▸ Bloomerang first-time-donor calls) · "No contact in 92 days — VIP" · "Standing order failed — Reuven" · "3 pledge installments overdue". Each: act / snooze / dismiss. Dismissals are logged. `[P2]`: an **about-to-lapse** panel (pre-lapsed donors, one-click export to a call list ▸ Kindful).

**Elements & data.** Everything reads `contact_stats` + open tasks + scheduled interactions + the signals table produced by the nightly run (08). Nothing on this screen is stored dashboard state; it is all live query (I-9).

**States.** Empty Today = the reward state (03 §5.6). Overdue group header always carries **"Reschedule all"** (03 §5.4). Loading: skeleton rows. Error: cached last-known list with a stale banner (offline: 11 §6).

**Interactions.** Row tap → profile. Inline: ☎ / WhatsApp buttons launch the channel (wa.me deep link — 10 §2) and, on return, prompt Quick Capture ("Log the call?" ▸ Pipedrive post-call). Checking a next action done → close-the-loop dialog (I-4). Drag to reorder within the same day ▸ OnePageCRM. "Start my day" button → Focus mode (§2).

**Mobile (A4).** The stream only: metric strip collapses to a one-line summary; nudges fold into the stream as cards. Same sections, swipe right = done, swipe left = snooze.

**Permissions.** Viewer: read-only, no amounts unless `can_see_amounts` (metric strip hides giving card). Fundraiser+: full.

---

## §2 Focus mode ("Start my day")

**Purpose.** Turn "make today's 12 calls" into a wizard: one person at a time, full context, no navigation.
▸ **Borrowed:** HubSpot task queues ("Start") — adopted; queue = the current Action Stream section or any saved view.

**Layout.** Full-screen: left = the person's at-a-glance header + pinned note + last 3 timeline entries + things-to-remember; right = the task, big action buttons (Call · WhatsApp · Done · Skip · Snooze), and the Quick Capture box ready for the outcome. Progress "3 of 12" on top.

**Interactions.** Done → close-the-loop → auto-advance to next. Skip → next (task untouched). Esc exits. Keyboard: D done, S snooze, K skip, Q capture.

**Permissions.** Fundraiser+.

---

## §3 Tasks & follow-ups view

**Purpose.** Manage the full task inventory beyond today (brief §16); the Action Stream shows the *edge* of this iceberg.

**Layout.** A saved-view page (03 §4) over tasks: default grouping by status — **Today · Overdue · Upcoming · Waiting · Queued · Done**. Columns: task, contact (always present — I-2), action type, due, priority, assigned, origin (badge for automation/AI-created). Filters: mine/everyone, action type, origin.

**Waiting** rows show `waiting_for` inline ("GA form sent 12 May — awaiting return"); blue flag everywhere the contact appears.
**Queued** (dateless, ordered): a contact's pre-planned sequence. When the contact's active next action completes, the first queued task activates — it gets `due_on = today + 3 days` default (configurable) and enters the stream. ▸ **Borrowed:** OnePageCRM queued actions — adopted.

**Interactions.** Inline edit of due/priority/assignee; bulk sheet (03 §4); every completion runs close-the-loop (I-4). New task always requires a contact picker first (organisation-self for admin work).

**Permissions.** Viewer: read-only. Fundraiser: full on own + shared; reassignment fundraiser+.

---

## §4 Quick Capture — artboard A3 (mobile, 3 panes)

**Purpose.** The 20–30-second promise (brief §24, §30; I-5): everything the user knows after a call/meeting lands in structured records with two taps and one sentence. Also the entry point for *scheduling* ahead ("meeting with Katz Thursday 3pm").

**Entry points.** Mobile **[+]** tab & home-screen shortcut; desktop capture button & Cmd+K "log"; the post-channel prompt (after tapping ☎/WhatsApp from any row: "Log it?" ▸ Pipedrive); Focus mode's capture box.

**Pane 1 — Input.** One full-screen text box, keyboard up, mic-friendly (OS dictation). Placeholder rotates real examples ("met dovid cohen in london, warm, discussed 20k for the building, call him after sukkos"). Nothing else on screen. A small "manual form" link for AI-free entry (same fields, blank).

**Pane 2 — Confirm sheet** (the AI review panel — full contract in 09 §2):
- **Contact chip**: fuzzy-matched (trigram over name/Hebrew name/org/phone). Ambiguous → inline picker of top 3. No match → explicit **"Create new: Dovid Cohen?"** chip — never silent creation. ▸ Fireflies, adapted.
- **Interaction chips**: kind · when · where · summary (editable text) · outcome · ask amount if mentioned.
- **Next-action chips**: type · title · **date chip showing the resolved date** — "after sukkos → Tue 6 Oct". Tap to change; the resolution is refusable. ▸ Todoist/Fantastical live-parse bar; Hebcal resolution 09 §2/10 §6.
- **Suggested updates** (if any): "add tag Building Project?" — off by default, one tap to accept.
- Source line: "Parsed from your note · original kept" (▸ Granola provenance — tapping any chip shows the source phrase highlighted in the dictation).
- **[Save]** — one button. No required fields beyond contact + summary (I-5).

**Pane 3 — Saved.** Confirmation + the close-the-loop state ("Next: call after Sukkos ✓ scheduled") + "Add another". Total flow budget: ≤30s including dictation; ≤3 taps after speaking.

**States.** AI unavailable/offline → Pane 2 renders as the manual form prefilled with the raw text in summary; the dictation is never lost (`ai_raw_input` stored regardless). Low-confidence parse → chips render empty rather than guessed, with the raw text visible.

**Scheduling mode.** If the parsed date is future + kind is meeting → saved as `status='scheduled'` interaction (appears in Meetings today/this week, ICS feed — 10 §4) instead of a logged one; confirm sheet says so explicitly.

**Permissions.** Fundraiser+. Every capture writes an `ai_activity_log` row; resolution set by the user's action (09 §1).

---

## §5 Donor Profile — artboard A2

**Purpose.** Understand the entire relationship in 30–60 seconds (brief §1, success test 2) and act without leaving (▸ Attio/Close act-from-record).

### §5.1 At-a-glance header (brief §28)

Top band, always visible: photo/initials · **name + title** (+ Hebrew name) · household link ("Goldstein Family") · flag · stage pill (manual) beside **donor-status pill + engagement meter** (computed, outlined — I-7) · priority/tier chips · relationship owner. Second line, the numbers (from `contact_stats`): Lifetime **£65,000** · Last gift **£15,000 — Mar 2026** · Last contact **12 days ago (meeting)** · **Next: Call re proposal — 22 Aug** · KIT cadence chip · GA declaration ✓/✗. Third line: interests tags · "Introduced by: R' Weiss". Amounts hidden for restricted viewers (11 §2).

The engagement meter renders as five segments Cold→On Fire with the tier named; `unknown` shows as "Not enough history yet" — never a fake score. ▸ Bloomerang meter + DonorSearch DS3 honesty.

### §5.2 Pinned note + timeline

Directly under the header: the **pinned note**, styled distinctly ("Prefers calls after 8pm; ask about son in Gateshead") — one per contact, any note can be pinned/unpinned. ▸ HubSpot — adopted.
Then the **merged timeline**: interactions, gifts, pledges & installment payments, GA declarations, notes, tasks completed, documents — one reverse-chron feed, each entry per 03 §6, with type filter chips (All · Conversations · Giving · Notes · Files). ▸ Bloomerang/Donorfy/HubSpot — adopted. Scheduled items (future meetings, upcoming installments) show in a slim "Upcoming" block above the past.

### §5.3 Giving tab

Table of gifts (date, amount, fund/campaign/appeal, method, receipt & thank-you status, GA status) + pledge cards (total, schedule progress bar, balance, next installment) + recurring agreement card (status; **failing = red banner**) + rollup sidebar (the §5.1 numbers expanded, hard vs soft credit totals ▸ NPSP). "Record gift" / "Record pledge" here and in the header's ⋯ menu (05 §1–2).

### §5.4 Relationship intelligence panel

The brief-§14 block: birthday, spouse/family, occupation/business, communities & interests (tags), mutual connections, best time, preferred channel & language, things-to-remember. Grouped, scannable before a call; feeds the AI brief (09 §3). Sensitive/private notes stay in the notes system with `is_private` (11 §2) — this panel holds only workaday facts (I-13).

### §5.5 Household & Gift Aid panels

**Household**: members with roles, combined giving rollup, greetings (auto + override) ▸ NPSP. Gifts by other members appear in this contact's timeline as soft-credit entries, visually distinct.
**Gift Aid**: current declaration status (method, date, enduring?), "New declaration" / "Send declaration request" (→ chase workflow, 08 §2), eligible-unclaimed total for this donor.

### §5.6 Keep-in-touch cadence

Inline control (no settings page — I-6): preset chips **2w · Monthly · 2m · Quarterly · 6m · Annual · Custom · None** ▸ Dex presets — adopted; plus "pause until…" (kit_paused_until). Shows the computed next-due date live. Any meaningful logged interaction silently resets the clock ▸ Dex/Clay/folk — adopted (no extra taps, ever).

### §5.7 Act from the record

Header action bar: **Call** (tel:) · **WhatsApp** (wa.me + return-prompt) · **Email** · **Log** (Quick Capture pre-filled with this contact) · **Task** · **Meet** (schedule) · ⋯ (gift, pledge, document, merge `[admin]`, archive). Every action returns to the profile.

### §5.8 AI assists on the profile `[P2]`

- **"Brief me"** button → the pre-meeting brief (09 §3), cached until a new interaction lands.
- **"Where we're holding"** — one rolling AI-maintained line under the header ("Discussed £20k for the building at the June meeting; he asked to talk after Sukkos"), rewritten after each captured interaction, labelled per 03 §5.7. ▸ **Borrowed:** Gong's `Next_Steps` rolling field — adopted.
- Smart-ask hint in the giving tab ("history suggests an ask of £X–£Y" with the arithmetic shown) ▸ Keela — adapted: formula-based, explainable, never shown without ≥3 gifts of history.

**Permissions.** Viewer: header + timeline without amounts/private notes (11 §2). Wireframe: A2.
