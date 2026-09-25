-- ============================================================================
-- 007b_gift_aid_hardening — close the RPC surface 007 opened
-- ============================================================================
-- Same finding, same remedy as 005b: PostgREST exposes every function in
-- `public` as /rest/v1/rpc/<name>, and Supabase's default privileges hand
-- EXECUTE to `anon` as well as `authenticated`. For a SECURITY DEFINER function
-- that reads `donations` and `contacts`, that is a real leak — an anonymous
-- caller with a claim id would get donor names, dates and amounts back from
-- `ga_claim_validation` without ever signing in. Found by the Supabase linter
-- (lints 0011 / 0028 / 0029) after 007.
--
-- Deliberately still executable by `authenticated`: all four Gift Aid
-- functions. Each is either guarded by `crm_role()` (`ga_submit_claim`) or
-- reads only what a signed-in member may already read through RLS.
-- ============================================================================

-- lint 0011: pin the search_path. Recreating resets the ACL, so this runs
-- before the grants below.
create or replace function public.ga_house_number(p_ga_house_no text, p_address_line1 text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(btrim(coalesce(p_ga_house_no, '')), ''),
    (regexp_match(btrim(coalesce(p_address_line1, '')), '^([^,[:space:]]+)'))[1],
    ''
  )
$$;

comment on function public.ga_house_number(text, text) is
  'HMRC Charities Online house name/number: ga_house_no, else the leading token of address_line1 (05 §5).';

-- The exclusion trigger function is never called directly; a trigger's
-- privilege check happens when it is created, not when it fires.
revoke all on function public.ga_exclusion_before_write() from public, anon, authenticated;

-- The workspace's RPCs: signed-in members only (11 §2).
revoke all on function public.ga_claim_validation(uuid)            from public, anon;
revoke all on function public.ga_declaration_covers(uuid, date)    from public, anon;
revoke all on function public.ga_submit_claim(uuid, text)          from public, anon;
revoke all on function public.ga_house_number(text, text)          from public, anon;

grant execute on function public.ga_claim_validation(uuid)         to authenticated, service_role;
grant execute on function public.ga_declaration_covers(uuid, date) to authenticated, service_role;
grant execute on function public.ga_submit_claim(uuid, text)       to authenticated, service_role;
grant execute on function public.ga_house_number(text, text)       to authenticated, service_role;
