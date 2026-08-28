-- Applied to the live project under the migration name 005_function_hardening
-- (renamed on disk to 005b_ to avoid colliding with 005_journeys_and_ics).
-- ============================================================================
-- 005_function_hardening — close the RPC surface opened by the automation layer
-- ============================================================================
-- PostgREST exposes every function in `public` as /rest/v1/rpc/<name>, and
-- Postgres grants EXECUTE to PUBLIC by default. That meant a signed-in user
-- could call run_nightly(), mint a Gift Aid claim via crm_rolling_ga_claim(),
-- or rewrite soft credits — none of which the 11 §1 matrix permits. Found by
-- the Supabase database linter (lints 0028 / 0029) after 003c.
--
-- Trigger functions do not need EXECUTE to fire: the privilege is checked when
-- the trigger is created, not when it runs. So revoking here costs nothing.
--
-- Deliberately still executable by `authenticated`:
--   crm_role(), crm_is_member(), crm_can_see_amounts() — every RLS policy
--   calls them in the caller's own context, and each returns only facts about
--   the caller. They are revoked from `anon`, which no policy addresses.
--
-- Deliberately left as-is: `donations_redacted` is reported by lint 0010
-- (security_definer_view). That is the point of it — the view must bypass the
-- amount policy on `donations` to serve restricted viewers a row set with no
-- amount columns (11 §2), and it re-asserts membership in its own WHERE clause.
-- ============================================================================

-- trigger functions — never called directly
do $$
declare f text;
begin
  foreach f in array array[
    'audit_row()',
    'touch_updated_at()',
    'touch_rule_updated_at()',
    'donations_before_write()',
    'donations_after_write()',
    'gift_aid_declarations_after_write()',
    'tributes_after_write()',
    'contacts_after_household_change()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- internal machinery — only ever called from inside a SECURITY DEFINER
-- function (where the privilege check is against the definer, not the caller)
-- or by pg_cron as postgres
do $$
declare f text;
begin
  foreach f in array array[
    'crm_rule(text)',
    'crm_rolling_ga_claim()',
    'crm_gift_aid_status(uuid, date, boolean, text, text)',
    'crm_sync_household_soft_credits(uuid)',
    'crm_recompute_pledge(uuid)',
    'crm_auto_tag_contacts(jsonb)',
    'crm_tier_rank(text)',
    'run_nightly()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.run_nightly() to service_role;

-- policy helpers: the caller needs these, anonymous callers never do
revoke all on function public.crm_role()            from public, anon;
revoke all on function public.crm_is_member()       from public, anon;
revoke all on function public.crm_can_see_amounts() from public, anon;
grant execute on function public.crm_role(), public.crm_is_member(), public.crm_can_see_amounts()
  to authenticated, service_role;

-- lint 0011: pin the one function that still had a role-mutable search_path
create or replace function public.crm_tier_rank(p_tier text)
returns int
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_tier
    when 'cold' then 1 when 'cool' then 2 when 'warm' then 3
    when 'hot'  then 4 when 'on_fire' then 5 else 0 end
$$;

revoke all on function public.crm_tier_rank(text) from public, anon, authenticated;
