# 09 — AI Features

*AI where language is the bottleneck; queries everywhere else (I-8). All calls run in Supabase Edge Functions against the Claude API (`claude-opus-5` default; the key is a server secret; the browser never talks to the model). Every feature below follows the §1 contract — no exceptions.*

## §1 The guardrail contract (applies to every feature)

▸ **Borrowed wholesale** from the products that shipped AI in CRMs and the ones that got burned: HubSpot Breeze's review-first autonomy ladder · Salesforce Einstein NBA's logged accept/reject · Gravyty's "AI drafts, fundraiser sends" · IBM Carbon/Cloudscape AI labelling · Granola's provenance · the Vanderbilt condolence-email failure · the ICO wealth-screening fines.

1. **Propose → preview → confirm → write.** AI output always lands as a structured, editable preview (suggestion card / confirm sheet, 03 §6). Nothing writes to the database and nothing leaves the building without an explicit human save. There is **no accept-all** for donor-facing content.
2. **Autonomy ladder.** Every feature has a declared level: **L0** suggest (chips/insights) · **L1** draft (content a human sends) · **L2** auto-with-undo (internal writes only, e.g. auto-filed email ingest `[P3]`). Every feature ships at L0/L1; promotion to L2 requires weeks of logged accuracy on that feature and an explicit settings opt-in ▸ Breeze. Nothing donor-facing can ever reach L2.
3. **Provenance.** Every extracted field can show its source phrase (tap chip → highlighted dictation ▸ Granola); every draft renders the CRM facts it used alongside the text ▸ Salesforce grounded-generation — a draft may contain **only** retrieved facts, and the reviewer can see that at a glance (anti-hallucination).
4. **Labelling.** Two states: "Drafted with AI" (chip + tinted card) until a human accepts/edits → "Reviewed". One boolean, rendered everywhere the content appears ▸ Carbon/Cloudscape.
5. **Logging.** Every run writes `ai_activity_log` (02 §3.17) with resolution accepted/edited/rejected — rejections included ▸ Einstein NBA. **KPI: % of outputs edited before acceptance**, per feature, shown in Settings; a rising edit rate is the tuning alarm.
6. **Hard exclusions.** Condolence, bereavement and serious-illness messages are never AI-drafted — the compose screen detects these categories (tribute type in_memory, keywords) and opens blank-page mode with a notice ▸ Vanderbilt 2023.
7. **Privacy.** Prompts include only fields the requesting user may see (private notes excluded unless author/admin; amounts excluded for restricted viewers) — the Edge Function builds context through the same RLS as the UI (11 §2). Profiling is disclosed in the privacy notice; **no external data enrichment or wealth screening** (§6; ICO fined 13 UK charities for covert screening).
8. **Explanation.** Every AI-initiated surface carries "why am I seeing this" (the rule or evidence that produced it) — ambiguous, unexplained insights are the documented adoption killer.

## §2 Quick Capture `[P1]` — L0 chips into a human save

**Trigger.** Pane 1 text (typed or dictated) submitted (04 §4).
**Inputs.** Raw text · today's date/timezone · the user's recent-contact shortlist (id + names + orgs, for matching) · lookup values (kinds, action types) · the Jewish-calendar table (below).
**Contract.** One structured-output call returning strictly-typed JSON:

```json
{ "contact_query": "dovid cohen", "confidence": 0.93,
  "interaction": { "kind": "meeting", "occurred_at": "2026-08-23T10:00", "location": "London",
    "summary": "…", "outcome": "…", "ask_amount": 20000, "is_scheduled": false },
  "next_action": { "type": "call", "title": "Call re building project / £20k",
    "date_expression": "after sukkos", "resolved_due_on": null },
  "suggested_updates": [ {"kind": "add_tag", "value": "Building Project"} ],
  "unparsed_remainder": null }
```

▸ Extraction against a predefined schema, not open summarisation (Momentum/snapAddy). Model: `claude-opus-5`, structured outputs, low effort — latency target <3s.

**Date resolution is deterministic, not model arithmetic.** The model extracts the *expression* ("after sukkos", "in three months", "before the dinner"); a resolver maps it: relative dates via date math; **Jewish-calendar expressions via a Hebcal-derived lookup** (10 §6) with house rules — "after ⟨chag⟩" = 2 business days after isru chag; "before ⟨chag⟩" = 7 days prior; "after the chagim" = after the last of the Tishrei cycle; ambiguous ("around Chanukah") = first candle + flag the chip. The UI echoes the resolution as a refusable chip ("after sukkos → **Tue 6 Oct**") ▸ Todoist/Fantastical + the never-let-the-model-do-date-arithmetic pattern. No shipped CRM handles this; it is the product's signature trick.

**Contact matching is deterministic too**: trigram + phone/email lookup over `contact_query`; ≥1 strong match → chip; several → picker; none → explicit "Create new?" ▸ Fireflies, adapted (never silent creation).

**Review UI.** The confirm sheet (04 §4 pane 2). Save maps chips → `interactions` + `tasks` rows; `ai_raw_input` stored verbatim; `ai_activity_log.resolution` = accepted/edited (+ which fields).
**Failure modes.** Timeout/offline → manual form prefilled with raw text (the dictation is never lost). Low confidence (<0.6) → chips render empty, raw text shown. Wrong parse → user edits chips (that *is* the recovery); edit patterns feed the eval set (§8).
**Multilingual.** Yinglish/Hebrew/Yiddish input supported; summary normalised to English by default (per-user setting keeps original + translation).

## §3 Pre-meeting brief & donor summary `[P2]` — L0

**Trigger.** "Brief me" on profile/meeting (04 §5.8); auto-nudge 48h before a scheduled meeting ▸ Salesforce Meeting Digest.
**Inputs.** at-a-glance stats (from `contact_stats` — the numbers are computed, the model only narrates them) · last 15 timeline entries · relationship-intelligence panel · open tasks/pledges/opportunities · household context. Private notes only if the requester may see them (§1.7).
**Output.** Five fixed bullets: who & how you know him · trajectory · giving pattern & capacity signal · last time + what was promised · talking points + the one thing not to forget. Plus the **"Where we're holding"** rolling one-liner, rewritten after each capture ▸ Gong `Next_Steps`.
**Review UI.** Rendered card, labelled, regenerate button; cached until a new interaction lands (cost ≈ pennies).
**Failure modes.** Sparse history → the brief says so ("3 interactions on record — thin file") rather than padding; numbers come pre-computed so they cannot be hallucinated (I-8).

## §4 Drafting `[P2]` — L1, human always sends

**Surfaces.** Thank-you (from the thank-you task: gift, project, history, donor's preferred language) · proposal/pledge follow-up · project update cover note · GA declaration request. Output lands in a copy-to-WhatsApp/email box.
**Tone.** Learned from `team_members.drafting_examples` (a few real messages pasted once in Settings — includes the Anglo-charedi register, titles, Hebrew phrases) ▸ Momentum "in your voice".
**The Gravyty pattern, adapted:** the `[P2]` digest includes at most **one** "first draft" a day — the highest-priority relationship with the reason surfaced and a ready-to-edit draft in the email itself ▸ Gravyty Raise. Never more than one; scarcity keeps it read.
**Grounding.** The facts panel renders beside every draft (gift amount, date, project, last meeting) — the draft may reference only those facts (§1.3).
**Hard exclusion** per §1.6. **Failure modes:** wrong language/register → edit + the correction is logged; repeated heavy edits on a surface auto-suggest refreshing tone examples.

## §5 Digest narrative `[P2]` — L0

The morning/weekly digest's numbers are assembled by SQL (08 §6); the model writes only the two-sentence narrative on top ("Three relationships need rescuing this week; the Reuven proposal has been quiet 12 days."). Failure → digest sends without narrative. Never blocks delivery.

## §6 Scoring stance — deterministic, explained, disclosed

- Engagement score, donor status, RFM, smart-ask are **formulas** (02 §4), not ML — at a few-hundred-donor scale, honest arithmetic beats trained models ▸ Dataro's own small-data caveat. AI's only role is *explaining* them in the brief ("cooling because no meaningful contact in 80 days after a monthly rhythm").
- Every score has an explicit **insufficient-data state** shown as such ▸ DonorSearch DS3 — never a fake number.
- Every insight pairs with a one-click action (draft the call task, open the list) ▸ Bloomerang insight→action.
- **No wealth screening, no external enrichment** of private individuals: the ICO fined the RSPCA, BHF and eleven more charities for covert donor screening; capacity is a manual field from personal knowledge, and the profiling we do (scores from our own interaction/giving data) is disclosed in the privacy notice (11 §3).

## §7 Later `[P3]` — each gated on the §1 contract

- **NL search → filters** (L0): "London donors interested in the building project, quiet 60 days" → translated into the existing saved-view filter schema — the model can only express filters the UI already has (never raw SQL); result shown as chips, saveable as a view ▸ Breeze/ChatSpot lesson: in-context, read-only first.
- **Email ingest** (L2 for internal filing, after probation): dropbox address → match sender → summarised interaction, review queue for unmatched ▸ Donorfy Send-To + Fireflies auto-create with config.
- **AI attributes** (L0): admin-defined prompt-computed fields over internal data only ("preferred communication style"), typed, filterable, recomputed on new evidence ▸ Attio — adopted with their engineering bar (below).
- **Backfill** (L1): the §2 extractor over legacy spreadsheet notes → structured interactions, 100% through a review queue ▸ Momentum Backfill.

## §8 Engineering bar, evals & cost

▸ **Borrowed:** Attio's "you can't just prompt your way to great AI features" — adopted as process:
- **Typed everything**: structured outputs on every call; schema versioned in the repo next to its prompt; prompt changes are code-reviewed diffs.
- **Eval suite**: a fixture set of real dictations (grown from every edited/rejected capture, anonymised) scored per prompt version — accuracy per field, date-resolution accuracy, contact-match precision. Run in CI before any prompt ships. Target: ≥90% of captures need zero chip edits by end of P1.
- **Tracing**: `ai_activity_log` keeps model, latency, tokens per run; Settings shows per-feature monthly cost and edit-rate.
- **Cost model** (Claude API, Aug 2026: `claude-opus-5` $5/M in · $25/M out): capture ≈1.5k in/0.3k out → 40/day ≈ **$18/mo**; briefs cached ≈ $3/mo; drafts/digests ≈ $5/mo. Ceiling ~£25/mo; a per-month token budget alarm in Settings. High-volume parsing can drop to `claude-haiku-4-5` ($1/$5) if ever needed — a config switch, not a redesign.
