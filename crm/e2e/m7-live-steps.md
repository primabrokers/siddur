# M7 — live verification steps (Gift Aid workspace)

Written by the M7 agent, whose Supabase MCP bridge was broken for the whole run
(every `mcp__Supabase__*` call hung without returning). Everything else in M7 is
verified offline and green; the three checks below are the only ones outstanding.

Project: **`zyvhcnhablkgbsgtljma`** (eu-west-2). Run each block with
`mcp__Supabase__execute_sql`.

---

## 1. `ga_submit_claim` in a ROLLED-BACK transaction

**Leaves the database exactly as found** — the final `rollback` undoes the claim
stamping, the GASDS sweep and the new rolling claim.

`ga_submit_claim` guards on `crm_role() = 'admin'` (007 line 220), and
`crm_role()` reads `auth.uid()` from the JWT (002 line 26). A plain MCP session
is `postgres` with no JWT, so `auth.uid()` is null and the function correctly
raises `42501`. The proof therefore impersonates the seeded admin for the length
of the transaction.

```sql
begin;

-- Impersonate the seeded admin so crm_role() = 'admin'.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  (select id::text from public.team_members
              where lower(email) = 'admin@demo.test' and is_active limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

-- BEFORE: the rolling claim and what hangs off it.
select claim_id, status, building_since, gift_count, donations_total,
       claimable_total, gasds_total
  from public.gift_aid_claim_totals
 where status = 'draft-rolling';

-- File it.
select public.ga_submit_claim(
  (select id from public.gift_aid_claims where status = 'draft-rolling' limit 1),
  'CO-ROLLBACK-TEST'
);

-- AFTER — expect all four:
--   a) the old claim is status='submitted', submitted_on=today,
--      hmrc_reference='CO-ROLLBACK-TEST', total_claimed = round(donations*0.25,2)
--   b) every donation that pointed at it is gift_aid_status='claimed'
--   c) GASDS gifts since the previous filed claim were swept onto it
--   d) exactly ONE fresh 'draft-rolling' claim now exists, gift_count 0
reset role;
select claim_id, status, submitted_on, hmrc_reference,
       donations_total, claimable_total, gasds_total, gift_count
  from public.gift_aid_claim_totals
 where hmrc_reference = 'CO-ROLLBACK-TEST'
    or status = 'draft-rolling'
 order by status;

select gift_aid_status, count(*), coalesce(sum(amount_gbp),0) as total
  from public.donations
 where gift_aid_claim_id = (select id from public.gift_aid_claims
                             where hmrc_reference = 'CO-ROLLBACK-TEST')
 group by gift_aid_status;

select count(*) as rolling_claims
  from public.gift_aid_claims where status = 'draft-rolling';   -- must be 1

rollback;
```

Then confirm nothing survived:

```sql
select count(*) as should_be_zero
  from public.gift_aid_claims where hmrc_reference = 'CO-ROLLBACK-TEST';
```

## 2. `ga_claim_validation` — sanity-check the failure rows

```sql
select *
  from public.ga_claim_validation(
    (select id from public.gift_aid_claims where status = 'draft-rolling' limit 1)
  );
```

Each row is one `(donation_id, code)` blocker. Codes are exactly the five the UI
knows (`src/features/giftaid/logic.ts` `CODE_LABEL`): `missing_postcode`,
`missing_house_no`, `not_gbp`, `not_individual`, `no_declaration`. Any code
outside that set would render as the fallback "needs attention" — flag it.

Cross-check that each reported failure is real:

```sql
select d.id, d.donated_on, d.amount_gbp, d.currency,
       c.contact_type, c.postcode,
       public.ga_house_number(c.ga_house_no, c.address_line1) as house_no,
       public.ga_declaration_covers(d.contact_id, d.donated_on) as covered
  from public.donations d
  join public.contacts c on c.id = d.contact_id
 where d.gift_aid_claim_id = (select id from public.gift_aid_claims
                               where status = 'draft-rolling' limit 1)
   and d.status = 'received'
   and not coalesce(d.is_gasds, false)
   and (c.postcode is null or btrim(c.postcode) = ''
        or public.ga_house_number(c.ga_house_no, c.address_line1) = ''
        or upper(coalesce(d.currency,'GBP')) <> 'GBP'
        or c.contact_type <> 'individual'
        or not public.ga_declaration_covers(d.contact_id, d.donated_on));
```

The row set here should match the distinct `donation_id`s from
`ga_claim_validation` one for one.

## 3. `m7-giftaid-live.png`

The sandboxed Chromium cannot open TLS to `*.supabase.co`, hence the relay
(recipe from `e2e/m2-shots.mjs`; the same header comment is in `e2e/m7-shots.mjs`).

```bash
cd /home/user/siddur/crm
NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs --port 5433 &
VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5193 --strictPort --host &
E2E_BASE_URL=http://localhost:5193 E2E_SHOT_SUFFIX=live E2E_SKIP_EXPORT=1 \
  node e2e/m7-shots.mjs
```

Signs in as `admin@demo.test` / `YeshivaCrm-demo1`. **`E2E_SKIP_EXPORT=1` is
required** — it takes the workspace shot only, so nothing opens the submit
dialog against real claim data.

A stale `e2e/shots/m7-giftaid-live.png` from the pre-restart run is already in
git; this run overwrites it.

---

## Already verified (no action needed)

`007b_gift_aid_hardening.sql` on disk is a faithful mirror of live. Introspected
before the bridge broke:

| function | live `proacl` | live `proconfig` |
|---|---|---|
| `ga_claim_validation(uuid)` | `postgres, authenticated, service_role` | `search_path=public, pg_temp` |
| `ga_declaration_covers(uuid,date)` | `postgres, authenticated, service_role` | `search_path=public, pg_temp` |
| `ga_submit_claim(uuid,text)` | `postgres, authenticated, service_role` | `search_path=public, pg_temp` |
| `ga_house_number(text,text)` | `postgres, authenticated, service_role` | `search_path=pg_catalog`, `prosecdef=false` |
| `ga_exclusion_before_write()` | `postgres, service_role` only | `search_path=public, pg_temp` |

No `anon` and no `PUBLIC` on any of them, and `ga_exclusion_before_write` is
revoked from `authenticated` too — exactly what the file applies.
