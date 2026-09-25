# Going live — the setup the yeshiva performs

Everything in the CRM is built, deployed and verified. What remains is the
handful of accounts and secrets only the yeshiva can create. Each section below
is independent: the app works before any of them, says plainly what is missing,
and lights up the moment the secret lands.

The app: **https://yeshiva-crm-primabrokers-projects.vercel.app**
Supabase project: `zyvhcnhablkgbsgtljma` (eu-west-2 · London).
Secrets are set in **Supabase → Edge Functions → Secrets** (or
`supabase secrets set --project-ref zyvhcnhablkgbsgtljma KEY=value`).
No secret is ever sent to the browser: the Settings screens report set/unset by
probing the deployed functions.

## 1 · AI features (Quick Capture parsing, donor briefs, drafting, digest)

| Secret | Where from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

Until set: every AI entry point answers `503 ai_unconfigured`; the manual paths
(typed capture, hand-written drafts) work in full — AI is an accelerant, not a
dependency (spec 09).

## 2 · Email (the /comms inbox — inbound filing and sending)

| Secret | Where from |
|---|---|
| `RESEND_API_KEY` | resend.com → API keys (send permission) |
| `EMAIL_FROM` | the verified sending address, e.g. `office@yeshiva.org` |
| `EMAIL_INBOUND_SECRET` | invent one: `openssl rand -hex 24` |

1. Verify the sending domain at Resend (DNS records they show you).
2. Set the three secrets.
3. Paste the inbound webhook URL into Resend, secret substituted:
   `https://zyvhcnhablkgbsgtljma.supabase.co/functions/v1/email-inbound?secret=<EMAIL_INBOUND_SECRET>`

Settings ▸ Email flips both status lines to "configured" by itself. Until
then: reading the inbox works (the demo threads show the flow), compose shows a
setup notice with Send disabled.

## 3 · WhatsApp Business (the /comms WhatsApp pane)

Prerequisite: a Meta Business account that has passed **business
verification**, with a phone number on the WhatsApp Business Platform. This is
Meta's process and takes days, not minutes; the wa.me deep links and Quick
Capture logging (Tier 1) work throughout.

| Secret | Where in Meta |
|---|---|
| `WA_ACCESS_TOKEN` | Business settings → System users → Generate token (scopes `whatsapp_business_messaging`, `whatsapp_business_management`) |
| `WA_PHONE_NUMBER_ID` | App → WhatsApp → API setup → "Phone number ID" |
| `WA_VERIFY_TOKEN` | invent one (`openssl rand -hex 24`) |
| `WA_APP_SECRET` | App → App settings → Basic → "App secret" |
| `WA_BUSINESS_ACCOUNT_ID` | App → WhatsApp → API setup → "WhatsApp Business Account ID" (only needed by "Sync templates") |

Then in the Meta app: WhatsApp → Configuration → Webhook → callback URL
`https://zyvhcnhablkgbsgtljma.supabase.co/functions/v1/wa-webhook`, verify
token = `WA_VERIFY_TOKEN`, press **Verify and save**, and subscribe to the
**`messages`** field. Message templates are written and approved in WhatsApp
Manager; "Sync templates" in Settings mirrors the approved list.

The 24-hour rule is enforced server-side: free-form replies only within 24h of
the donor's last message, approved templates any time — the composer and the
`wa-send` function apply the same rule, so it cannot be worked around.

## 4 · Morning digest email (the 7:30 push)

Uses the same `RESEND_API_KEY`/`EMAIL_FROM` as §2 — nothing extra. Until set,
`send-digest` answers `503 email_unconfigured` and the digest stays in-app.

## 5 · Gift Aid

Nothing to configure in the app. To actually file: HMRC Charities Online
credentials, and the exported CSV is uploaded there. The workspace builds the
rolling claim, validates rows and generates the HMRC-format schedule; the
declaration-request drafts are sent by a person, like everything else (I-10).

## 6 · Real data

Settings ▸ Import takes the current donor spreadsheet (CSV) with a mapping
step, duplicate detection and a batch undo. The demo data is marked and
removable:

```sql
delete from public.emails where provider_message_id like 'demo-%';
delete from public.wa_messages where wa_message_id like 'demo.c2.%';
delete from public.wa_conversations c
 where c.profile_name like 'DEMO ·%'
   and not exists (select 1 from public.wa_messages m where m.conversation_id = c.id);
```

Team members are created in Supabase Auth and mirrored in `team_members` with a
role (`admin` / `fundraiser` / `viewer`) — roles drive every permission via RLS
(spec 11 §1). The seeded demo sign-ins should be disabled once real accounts
exist.

## Outstanding engineering notes (not user-facing)

- `crm/e2e/m7-live-steps.md` §1 holds a rolled-back live proof of
  `ga_submit_claim` (needs a direct SQL session with admin impersonation; the
  function's ACLs, logic tests and UI gating are all verified).
- `crm/src/lib/database.types.ts` deliberately exports `any`; regenerate the
  typed schema (`supabase gen types typescript`) after any future migration and
  swap it in (`database.types.generated.ts` holds the pre-011 snapshot).
- The main JS chunk is ~1.1MB (only the pipeline board is code-split); further
  route-level splitting is worthwhile before slow-network use.
