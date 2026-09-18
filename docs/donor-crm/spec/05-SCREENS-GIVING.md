# 05 — Screens: Giving & Gift Aid

*Where money is recorded, promised, chased, thanked and claimed. Wireframe: artboard A7 (Gift Aid workspace); gift-entry insets on A2/A7.*

---

## §1 Gift entry

**Purpose.** Record a gift in under a minute with correct coding, and trigger the downstream loop (thank-you, receipt, Gift Aid) without further thought.

**Layout.** A sheet (from profile ⋯, the Giving screen, or Cmd+K "new gift"): contact (prefilled in context) → amount + currency (GBP default; `amount_gbp` auto via stored rate, editable) → date (default today) → **fund** (required, default General) · campaign · appeal — three compact selects ▸ LGL 3-axis, adopted → method → notes.

**Smart assists inline:**
- **Ask-array chips** above the amount field when history exists: last gift · highest gift · highest+25% ▸ Virtuous/RaiseDonors — adapted: entry shortcuts, not a donor-facing form.
- **Soft-credit prompt**: if the donor has `introduced_by_id`, a one-tap chip "Credit R' Weiss as influencer?" ▸ NPSP soft credits. Household soft credits happen automatically (trigger, 02 §3.14) — no UI needed.
- **Tribute toggle**: opens tribute fields (type incl. yahrzeit/simcha, honoree, acknowledgee + notify) ▸ Neon — adopted; if notify ✓, saving creates the acknowledgee-letter task distinct from the donor's thank-you.
- **Gift Aid line** (computed live): "Eligible — declaration on file ✓ (will join the current claim)" / "No declaration — request one?" (one tap → chase workflow 08 §2) / "Ineligible (non-GBP / company)". GASDS checkbox appears only for cash/contactless ≤£30 ▸ Beacon.
- **Applies-to**: if the donor has an open pledge or an active recurring agreement, a banner offers "Apply to pledge (installment of 15 Sep)?" — one tap links it (02 §3.4).

**On save** (triggers, 08 §2): thank-you task created (unless one open), receipt queued per preference cascade (gift → donor → system ▸ DonorPerfect), GA status computed, timeline entry appears. Undo toast (I-12).

**States/permissions.** Multi-currency note: non-GBP is fine for the ledger, ineligible for GA (flagged inline). Fundraiser+ create; refund/cancel is admin (11 §1).

---

## §2 Pledges & installment schedules

**Purpose.** "Promised £5,000 over 5 payments" as first-class state: balance, schedule, chasing, write-off (brief §8, §11).
▸ **Borrowed:** NPSP/Neon pledge + payment schedule — adopted (02 D4).

**Layout.** Pledge sheet: contact · total · fund/campaign/appeal · pledged date · **schedule builder** — n installments monthly/quarterly/custom from a start date, generated as editable rows (auto-split, remainder on last). Pledge card (profile §5.3 + Giving screen): progress bar (paid/total), balance due, next installment date, status.

**Behaviour.** Payments = ordinary gift entries applied via the applies-to banner (§1). Overdue installments are computed, appear in the Action Stream nudge rail and the pledge-chase automation (08 §2: reminder tasks at +14d, +30d, then monthly — configurable). **Write-off**: admin action on the pledge (amount + reason note) → status `written_off`, balance zero, history preserved ▸ Neon. Cancel: as write-off but flagged cancelled.

**Recurring agreements** live on the same Giving screen as cards: amount/frequency/method, last payment, and the **failing state** — expected payment >7 days late turns the card red, raises a nudge and a signal task ("standing order failed — call, don't email" ▸ Virtuous missed-payment-as-emergency). Reactivate/pause/cancel inline.

---

## §3 Receipting & thanks

**Purpose.** "Was this gift thanked? receipted?" must be queryable state, never memory (brief §8).
▸ **Borrowed:** DonorPerfect's receipting state machine + preference cascade — adapted (no built-in mail-merge in P1; letters export a CSV for Word merge).

**Layout.** A queue view on the Giving screen: **Unthanked gifts** (thank_you_status ≠ done — with days-since-gift, big gifts flagged; the 48-hour thank-you norm shown as a target) and **Unreceipted gifts** (receipt_status = not_sent/queued), each row: gift, donor, one-tap actions.

**Behaviour.** "Mark thanked" completes the thank-you task and stamps the gift. Receipts P1: mark-sent + CSV export for merge; P2: generated PDF/email from a template with the yeshiva's details (deferral register 12 §4). Recurring gifts auto-receipt per agreement setting.

---

## §4 Campaigns, funds & appeals

**Purpose.** Manage the three coding axes and see performance per axis (brief §31 hooks).

**Layout.** Simple admin lists (name, dates, goal, active) + per-campaign page: progress ring vs goal (▸ Beacon progress card), gifts table, pledges outstanding, top gifts, per-appeal breakdown ("Dinner letter £41k · email £6k"). Appeals get a year + channel so "Dinner 2026 vs Dinner 2025" is one filter.

**Permissions.** Admin manages the lists; fundraisers select them at entry.

---

## §5 Gift Aid workspace — artboard A7

**Purpose.** Turn Gift Aid from a quarterly spreadsheet ordeal into an always-ready claim: the "+25%" screen.
▸ **Borrowed:** Beacon's rolling claim + per-payment auto-eligibility; Donorfy's declaration chasing — adopted.

**Layout.** Three panels:
1. **The rolling claim** (hero): the single open claim with live totals — eligible gifts count, donation total, **claimable amount (25%)**, GASDS total separately. Button: **Review & export**.
2. **Declarations**: recent declarations list; **missing-declaration queue** — donors with eligible-but-undeclared gifts, sorted by recoverable value ("£1,200 recoverable from 8 donors"), actions per row: request by email/WhatsApp (draft link to declaration info + form) or "captured orally" (records declaration + queues the required written confirmation ▸ HMRC rule, 02 §3.7).
3. **History**: submitted claims (date, HMRC ref, amount, status paid).

**Review & export flow** (desktop-only, precision work — 03 §7): validation pass (each gift: valid declaration covering the date · GBP · individual, address + postcode present — failures listed with one-click fixes) → generates the **HMRC Charities Online CSV** with the exact column set (Title · First name · Last name · House name or number · Postcode · Aggregated donations · Sponsored event · Donation date · Amount) → claim → `submitted` with reference; gifts stamp `claimed`; a new rolling claim opens. Export is a confirm-dialog action (leaves the system — 03 §5.2). 4-year back-claim: a saved view "GA: unclaimed past gifts within 4 years" feeds a one-off declaration campaign (07 §10).

**Permissions.** Fundraiser: view + chase declarations. Submit/export: admin.
