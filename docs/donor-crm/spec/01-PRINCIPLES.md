# 01 — Principles

*The constitution. Every screen, rule and feature in this spec must satisfy these invariants. When two designs are possible, the one that better honours this file wins.*

## Who this is for

One primary fundraiser (the rosh yeshiva / development director), a tiny part-time team, a few hundred to a few thousand donor families. **Adoption is the only metric that matters**: industry experience is that ~70% of CRM failures are adoption failures, not technology failures. Every design choice below exists to make the system the path of least resistance on a busy day.

## The invariants

**I-1 — Every active relationship has exactly one visible next action.**
The home screen is a queue of *people*, each carrying their single next action, sorted by urgency. Not charts, not a table of names.
▸ **Borrowed:** Action Stream (OnePageCRM) — adopted wholesale; it is the closest shipped product to the brief's §1–2.

**I-2 — Tasks only exist attached to a person.**
There is no orphan to-do in this product. Every task references a contact (a rare `admin` context exists for genuinely personless work like "run Gift Aid claim", attached to the organisation record). This guarantees the dashboard is always a list of relationships.
▸ **Borrowed:** folk's reminder model (reminders can only exist tied to a contact) — adopted, with the single organisation-record escape hatch.

**I-3 — "Nothing scheduled" is a worse state than "scheduled for later".**
A contact in an active stage with no open next action shows a **yellow** flag — visually worse than a grey "future" flag. The system surfaces the gap; a human decides the action.
▸ **Borrowed:** Pipedrive's activity traffic-lights, where deals with no activity rank above deals with future activities — adopted as a core flag colour (03 §2).

**I-4 — Never complete into a void.**
Completing any next action immediately offers "schedule the follow-up" in the same dialog, prefilled where possible. Declining is allowed (the contact goes yellow) — skipping the question is not.
▸ **Borrowed:** Pipedrive's close-the-loop follow-up prompt — adopted verbatim.

**I-5 — Twenty seconds or it didn't happen.**
Routine logging (call/WhatsApp/meeting summary + outcome + next action + date) must complete in 20–30 seconds on a phone, including via dictation. No required field may ever block saving an interaction.
▸ **Borrowed:** Close's "no required fields on activity logs" + Pipedrive's post-call sheet + Todoist's quick-add — combined in Quick Capture (04 §4, 09 §2).

**I-6 — Simplicity is the feature.**
Few, fixed, jargon-free concepts (see 00 Glossary). No modules, no admin maze. Configuration lives inline where the work happens (cadence set on the profile; rotting threshold set on the pipeline stage), not in a settings labyrinth.
▸ **Borrowed:** Little Green Light / Beacon's product stance; Pipedrive/Dex/Copper's config-in-context.

**I-7 — Manual and computed facts never share a field.**
The fundraiser's judgement (relationship *stage*, priority, tier) is manual and configurable. The system's arithmetic (donor *status* New/Active/Pre-Lapsed/Lapsed, *engagement score*, days-since-contact, rollups) is computed, read-only, and self-correcting. They are displayed side by side and never overwrite each other. BUILD_PLAN's manual `engagement_level` field is deleted in favour of the computed score.
▸ **Borrowed:** Virtuous's computed donor statuses + Bloomerang's computed engagement meter, kept separate from the manual stage.

**I-8 — SQL for arithmetic, AI for language.**
Every number shown to a user comes from a query. AI is used only where language is the bottleneck: capturing what was said, summarising a relationship, drafting words. "Who have I neglected?" is a query, never a prompt.

**I-9 — Computed, not stored; stored, not duplicated.**
Anything derivable (rollups, overdue, KIT due dates, statuses) is a view or a nightly recompute with a timestamp — it can never silently drift. Any fact lives in exactly one place (brief §33: no information duplicated).

**I-10 — Automations create tasks and flags. Humans send messages.**
No automation and no AI feature ever sends anything to a donor. The system's strongest verb toward the outside world is "prepare a draft".
▸ **Borrowed:** Gravyty's founding posture ("AI drafts, fundraiser sends") — adopted as law, extended to all automations.

**I-11 — AI proposes; a human confirms; everything is labelled and logged.**
Every AI output arrives as a structured preview with provenance, is editable, and requires an explicit save. Records touched by AI carry a source label; accept/edit/reject is logged. Full contract in 09 §1.
▸ **Borrowed:** HubSpot Breeze's review-first autonomy ladder + Salesforce Einstein NBA's logged accept/reject + IBM Carbon's AI labelling.

**I-12 — Fast means faster than thought.**
Interactions respond in under 100ms (optimistic UI, local cache); destructive actions execute immediately with an undo toast instead of a confirmation dialog. Confirmation dialogs are reserved for irreversible, outward-facing, or bulk actions.
▸ **Borrowed:** Superhuman's 100ms rule; Linear's undo-instead-of-confirm.

**I-13 — Only store what helps the relationship.**
Personal information is recorded when it genuinely serves the relationship (brief §14), is protected by role permissions, and profiling of any kind is disclosed in the privacy notice — UK charities have been fined for covert donor screening (see 09 §6, 11 §3).

## Anti-goals (brief §33, restated as tests)

The product has failed if any of these becomes true:

- The home screen is a database table or a wall of decorative charts.
- Logging a routine call requires more than one screen or any required field beyond the contact.
- A donor's history must be reconstructed from a long free-text comments box.
- Two places disagree about lifetime giving, last contact, or pledge balance.
- The user must remember to check anything — the system pushes (morning digest) and surfaces (Action Stream); memory is never load-bearing.
- A feature exists because a big CRM has it rather than because the yeshiva's daily loop needs it (the deferral register in 12 §4 is the enforcement mechanism).
