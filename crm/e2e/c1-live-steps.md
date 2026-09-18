# C1 — the live steps

Everything in this milestone is built, typechecked, built and tested offline.
What is written down here is the part I could not run myself: the Supabase MCP
bridge hung on every call from my session, so **migration 011 was never applied
and neither edge function was ever deployed**. Nothing below has been executed.

Project: `zyvhcnhablkgbsgtljma` (eu-west-2).

---

## 1. Apply the migration

```
apply_migration(
  project_id = "zyvhcnhablkgbsgtljma",
  name       = "011_email",
  query      = <the whole of crm/supabase/migrations/011_email.sql>
)
```

The file is self-contained and idempotent (`create table if not exists`,
`create index if not exists`, policies guarded by `pg_policies` lookups), so a
re-run is safe.

Two blocks are wrapped in exception handlers on purpose, because a managed
project may not let a migration touch `storage.*`:

- `insert into storage.buckets … 'email-attachments'` — private bucket.
- the `email_attachments_read` policy on `storage.objects`.

If either raises the notice instead of running, create the bucket once by hand
(Storage ▸ New bucket, name `email-attachments`, **not** public) and add the
read policy in the dashboard. Nothing else in the milestone depends on it:
inbound attachments simply record their filename until the bucket exists.

**Check it applied:**

```sql
select count(*) from public.emails;                      -- 0
select public.crm_email_key('Dovid <D.Cohen+crm@X.com>');-- d.cohen@x.com
select public.crm_email_subject_key('Re: FW: Re[2]: The dinner'); -- the dinner
```

The third one is the important one — it is the SQL half of the thread key, and
`tests/comms-core-mirror.test.ts` asserts the JavaScript half matches it.

---

## 2. Deploy the two edge functions

Both carry a generated mirror of `src/features/comms/core.ts` as `core.ts`
alongside `index.ts`; **both files must be uploaded**.

### email-inbound — `verify_jwt = FALSE`

```
deploy_edge_function(
  project_id     = "zyvhcnhablkgbsgtljma",
  name           = "email-inbound",
  entrypoint_path= "index.ts",
  verify_jwt     = false,
  files          = [
    { name: "index.ts", content: <crm/supabase/functions/email-inbound/index.ts> },
    { name: "core.ts",  content: <crm/supabase/functions/email-inbound/core.ts>  },
  ],
)
```

`verify_jwt` **must** be false: a mail provider cannot hold a Supabase session.
The function authenticates itself with a constant-time comparison against
`EMAIL_INBOUND_SECRET` and answers 404 to everything else.

### email-send — `verify_jwt = TRUE`

```
deploy_edge_function(
  project_id     = "zyvhcnhablkgbsgtljma",
  name           = "email-send",
  entrypoint_path= "index.ts",
  verify_jwt     = true,
  files          = [
    { name: "index.ts", content: <crm/supabase/functions/email-send/index.ts> },
    { name: "core.ts",  content: <crm/supabase/functions/email-send/core.ts>  },
  ],
)
```

`verify_jwt` **must** be true: I-10 — nothing sends without a human, and the
Sent row is written with the caller's own token so RLS decides whether they may.

---

## 3. Verify the wiring

No provider secrets are set on the project, and I could not set them. That is
fine: the three paths below are exactly the ones that prove the wiring, and all
three are reachable *without* any secret.

```bash
BASE=https://zyvhcnhablkgbsgtljma.supabase.co/functions/v1

# (a) inbound, no secret configured on the project → 503 email_unconfigured
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/email-inbound"
# expect: 503   body: {"error":"email_unconfigured"}

# (b) inbound, wrong secret → 404 (once EMAIL_INBOUND_SECRET *is* set;
#     while it is unset this also answers 503, which is (a))
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/email-inbound?secret=definitely-wrong"
# expect: 503 before the secret is set, 404 after

# (c) send, no Authorization header → 401 from the gateway (verify_jwt)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/email-send" \
  -H 'content-type: application/json' -d '{}'
# expect: 401

# (d) send, valid JWT, no provider keys → 503 email_unconfigured
TOKEN=$(curl -s -X POST \
  "https://zyvhcnhablkgbsgtljma.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: sb_publishable_TUrSdmuJIrQ-YJCH5zDkJg_QDdFCZw-" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@demo.test","password":"YeshivaCrm-demo1"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -s -w '\n%{http_code}\n' -X POST "$BASE/email-send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "apikey: sb_publishable_TUrSdmuJIrQ-YJCH5zDkJg_QDdFCZw-" \
  -H 'content-type: application/json' \
  -d '{"to":["nobody@example.com"],"subject":"probe","body_text":"probe"}'
# expect: {"error":"email_unconfigured"} and 503

# (e) the Settings card's probe — same auth, status mode, always 200
curl -s -X POST "$BASE/email-send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "apikey: sb_publishable_TUrSdmuJIrQ-YJCH5zDkJg_QDdFCZw-" \
  -H 'content-type: application/json' -d '{"status":true}'
# expect: {"configured":false,"from":null,"has_api_key":false,"has_from":false}
```

The parsing, idempotency and matching that a *real* delivery would exercise are
covered offline instead, by `tests/comms-inbound.test.ts` (25 tests over the
Resend shape, the generic fallback, malformed bodies and the idempotency key)
and `tests/comms-core.test.ts` (58 tests over threading, matching and folders).

---

## 4. Demo rows, so the live screen renders

```
execute_sql(
  project_id = "zyvhcnhablkgbsgtljma",
  query      = <the whole of crm/e2e/c1-demo-emails.sql>
)
```

Eight rows, every subject prefixed `[DEMO]`, every `provider_message_id`
prefixed `demo-`. They are meant to stay in place. Removing them later:

```sql
delete from public.emails where provider_message_id like 'demo-%';
```

The script ends with a `select` that prints what the trigger decided for each
row — `thread_key`, `matched_by` and the matched contact. That output **is** the
live proof of the migration: five threads, the matched ones pointing at a real
contact, and one of them matched through a plus-addressed sender.

---

## 5. The live screenshot

Chromium in this sandbox cannot open TLS to `*.supabase.co`, hence the relay.

```bash
cd crm
NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs &          # listens on 5433
VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5197 --strictPort --host &
E2E_BASE_URL=http://localhost:5197 E2E_SHOT_SUFFIX=live node e2e/c1-shots.mjs
```

That writes `e2e/shots/c1-{inbox,thread,compose,inbox-mobile}-live.png`. Only
`c1-inbox-live.png` was asked for; the script produces the other three at no
extra cost.

---

## 6. What an admin does to actually turn it on

These are the three lines the Settings ▸ Email card shows, and the only setup a
human has to perform:

1. Verify the sending domain at Resend and create an API key with send permission.
2. On the Supabase project set three secrets: `RESEND_API_KEY`, `EMAIL_FROM`
   (e.g. `office@yeshiva.org`) and `EMAIL_INBOUND_SECRET` (any long random
   string).
3. Paste the inbound webhook URL into Resend, with the secret in place of the
   placeholder:
   `https://zyvhcnhablkgbsgtljma.supabase.co/functions/v1/email-inbound?secret=<EMAIL_INBOUND_SECRET>`

After step 2 the Settings card flips both status lines to configured by itself:
it probes `email-send`'s status mode and reads `email-inbound`'s 404-vs-503.
