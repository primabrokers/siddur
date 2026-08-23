# 11 — Permissions, Privacy & Non-Functional Requirements

## §1 Roles & capability matrix (brief §26)

Enforced in Postgres RLS — the API physically cannot return what a role may not see; the UI only *reflects* permissions, never *implements* them.

| Capability | Admin | Fundraiser | Viewer |
|---|---|---|---|
| View contacts, timelines, tasks | ✓ | ✓ | ✓ |
| Edit contacts, log interactions, tasks, notes, documents | ✓ | ✓ | — |
| Record gifts/pledges/declarations | ✓ | ✓ | — |
| Refund/cancel gifts, write off pledges | ✓ | — | — |
| View donation amounts | ✓ | ✓ | per `can_see_amounts` (default off) |
| View private notes | ✓ | author only | — |
| Export data / GA claim submission | ✓ | — | — |
| Delete, merge, import | ✓ | — | — |
| Settings: lookups, automation rules, team, AI config | ✓ | — | — |

## §2 RLS policy spec

- Every table: RLS enabled; base predicate = requester is an active `team_member`.
- **Private notes**: `not is_private or created_by = auth.uid() or role = 'admin'` — row-level, so private notes are absent from every list, timeline, export and **AI prompt** for unauthorised users.
- **Amounts for restricted viewers**: donations/pledges exposed to viewers through a security-barrier view without amount columns (`donations_redacted`); `contact_stats` ships a redacted variant. Reports and metric cards for such viewers read the redacted views — the join points named here so they can't be missed: reports (06 §3), metric cards (04 §1), digest (08 §6), **AI context builders (09 §1.7)**.
- Writes: role-checked per the matrix; `origin`/`created_by` stamped server-side.
- The Claude Edge Functions run with the *requesting user's* JWT (not service role) so every AI context inherits these policies mechanically — the AI×permissions leak is closed structurally, not by convention.

## §3 UK GDPR & donor privacy

- **Registration & basis**: data stored in London (eu-west-2); lawful basis legitimate interest for donor-relationship management, with a short documented LIA; the privacy notice names purposes, retention, processors (Supabase, Vercel, Anthropic — none train on the data) **and the profiling we perform** (engagement/RFM scores computed from our own records) with the right to object — the ICO fined 13 UK charities (RSPCA, BHF…) for covert donor screening; disclosure is the line we never cross.
- **No external enrichment/wealth screening** of individuals (09 §6). `estimated_capacity` is manual knowledge.
- **Data minimisation** (brief §14, I-13): note categories include `sensitive` with guidance text; the team guidance line — record what helps the relationship, nothing else — appears in onboarding and the notes UI.
- **Erasure & retention**: DSAR export per contact (admin, one click). Erasure = anonymisation — personal fields nulled, tombstone kept so ledger integrity survives; **financial records (gifts, GA declarations/claims) retained ~6 years** per HMRC, then eligible for purge. Yahrzeit/tribute names of deceased persons are not personal data but are handled with the same care.
- **Access hygiene**: Supabase Auth (magic link + Google), MFA required for admins, session revocation in Settings, no shared logins.

## §4 Audit trail (brief §25)

Trigger-fed `audit_log` on: contacts, donations, pledges, declarations, claims, tasks, notes, opportunities, team_members, automation_rules — action, actor, old/new values. Merges and GA submissions additionally write a human-readable summary row. Retention: life of the system. Read: admin.

## §5 Performance budgets

| Interaction | Budget |
|---|---|
| Any tap/keystroke acknowledgement | <100ms (optimistic UI — I-12) |
| Global search results | <300ms |
| Action Stream cold load | <1s on 4G |
| Quick Capture end-to-end (dictation → saved) | ≤30s, ≤3 taps |
| AI capture parse | <3s (spinner allowed; input never blocked) |
| Nightly run | <5 min at 10k contacts |

Ceilings assumed: ~10k contacts, ~100k interactions, ~50k gifts — orders of magnitude above the yeshiva's need; Postgres with the 02 indexes handles this without architecture changes.

## §6 Offline & poor-signal behaviour (the field reality)

Quick Capture must work leaving a meeting in a basement simcha hall: the input pane always opens and saves locally (IndexedDB queue) regardless of connectivity; parse + confirm run when back online, notifying "3 captures waiting to confirm". Read-side: last-loaded Action Stream and recently viewed profiles cached (service worker) with a stale banner. Everything else may require connectivity. (This is the same PWA discipline the siddur app already implements.)

## §7 Backups & recovery

Supabase PITR/daily backups (Pro tier once real data lands) + weekly `pg_dump` to the yeshiva's own Drive (encrypted, retention 12 weeks) + the import wizard's batch-undo as application-level recovery. Restore drill: once, during Phase 1 handover, documented in a runbook page.

## §8 Test fixtures & seeded data

A deterministic seed set (~120 contacts across households, 400 gifts over 3 years, pledges in every state, declarations, tasks, one of every automation condition) powers: the four §34 acceptance tests (12 §2), screenshots/wireframe fidelity, and the demo instance for the yeshiva. Fixtures use invented names and are clearly watermarked "DEMO" in the UI banner.
