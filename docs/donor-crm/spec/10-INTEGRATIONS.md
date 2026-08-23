# 10 — Integrations

*Law (brief §23): the core CRM must work excellently with zero integrations. Each integration below has a cheap tier shipped early and an upgrade gated on evidence — the decision-point register (§8) says exactly what evidence.*

## §1 Principles

Integrations reduce duplicate entry; they never become load-bearing. Every integration writes through the same records (interactions, documents, meetings) — no shadow inboxes.

## §2 WhatsApp

| Tier | What | Status |
|---|---|---|
| **1 — Click-to-chat + capture prompt** `[P1]` | wa.me deep link on every person row/profile (E.164). On return to the app after tapping it, the "Log it?" prompt opens Quick Capture pre-filled with the contact ▸ Pipedrive post-call pattern applied to WhatsApp | Ship |
| **2 — Business Platform (Cloud API)** `[P3]` | Real 2-way logging: inbound messages auto-file as interactions; templated outbound (invites, receipts). Costs: Meta business verification; UK ≈£0.04/marketing msg, utility cheaper, 1,000 free service conversations/mo, 24-hour service-window rules; BSP markup if via Twilio | Decision point |
| **3 — Unofficial bridges / WhatsApp Web scraping** | **Rejected permanently**: ToS violation, realistic ban risk to the fundraiser's personal number — an existential risk to the relationships themselves | Never |

Tier 1 + Quick Capture covers ~90% of the need: the durable value is the *summary and next action*, not the transcript.

## §3 Email

- `[P2/P3]` **Dropbox address** (e.g. `log@crm.…`): forward/BCC any donor email → Edge Function matches sender/recipient → AI-summarised interaction on the timeline; unmatched → review queue ▸ Donorfy Send-To-Donorfy — adopted. Runs at autonomy L2 only after probation (09 §7).
- Deferred: full Gmail sync, suggested-contacts-from-traffic (▸ Copper), inbox sidebar (▸ Copper/Streak) — highest permissions and effort, smallest marginal value over the dropbox. Register: §8.

## §4 Calendar

- `[P2]` **ICS feed** (read-only, tokenised URL per user): every scheduled CRM meeting appears in Google Calendar within its refresh window. One Edge Function, no OAuth.
- `[P3]` Two-way Google Calendar sync (OAuth per user): create/edit in either direction; calendar events with known donor emails suggest attaching to the contact.

## §5 Google Drive & files

`[P1]` Link fields on documents (a donor's Drive folder URL on the profile) + native uploads to Supabase Storage. `[P3]` Drive picker only if link-pasting proves annoying in practice.

## §6 Hebcal (Jewish calendar) — the quiet differentiator

A build-time-generated lookup table (from Hebcal data, as the siddur app already uses) of chagim/zmanim dates for ±3 years: feeds the Quick-Capture date resolver ("after sukkos" → real date, 09 §2), yahrzeit-tribute annual reminders (07 §7), and digest context ("Rosh Hashanah in 3 weeks — 14 annual givers usually give this month"). Refreshed yearly by a script; no runtime dependency.

## §7 HMRC Charities Online

Not an API integration: a validated **CSV file export** in the exact Charities Online schedule format (05 §5) that the admin uploads to the HMRC portal. Organisation charity/HMRC reference stored in Settings. GASDS totals reported separately on the claim record.

## §8 Decision-point register

| Upgrade | Trigger evidence | Cost of upgrading |
|---|---|---|
| WhatsApp Tier 2 | ≥10 inbound donor WhatsApps/week going unlogged, or bulk event invites needed | Verification + per-msg fees + template approval workflow |
| Full email sync | Dropbox address used >20×/week and still missing threads | OAuth scopes, sync infra, noise management |
| Calendar two-way | ICS feed insufficient because meetings are *created* in Calendar first | OAuth + conflict handling |
| Drive picker | Link-pasting friction reported repeatedly | OAuth + picker UI |
| Receipt PDF generation | Manual/CSV receipting exceeds ~30 min/week | Template engine + numbering scheme |

Until a trigger fires, the cheap tier stands (I-6; brief §33: no features for their own sake).
