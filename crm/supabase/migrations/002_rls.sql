-- ============================================================================
-- 002_rls — Row Level Security, per spec/11-PERMISSIONS-NFR.md §1–2
-- ============================================================================
-- RLS is the security boundary; the UI only reflects it.
-- Base predicate on every table: the requester is an ACTIVE team_member.
-- Role capability matrix (11 §1):
--   viewer      select only (donation/pledge amounts gated on can_see_amounts)
--   fundraiser  insert/update on operational tables, no delete, no refund /
--               write-off, no settings, private notes = own only
--   admin       everything
-- ============================================================================

-- --------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so a policy can read team_members without
-- recursing through team_members' own policies. search_path pinned (no
-- schema-injection), STABLE so the planner calls them once per statement.
-- --------------------------------------------------------------------------

create or replace function public.crm_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.role
  from public.team_members tm
  where tm.id = auth.uid()
    and tm.is_active
$$;

create or replace function public.crm_is_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.id = auth.uid() and tm.is_active
  )
$$;

-- Viewers only see money when explicitly granted (11 §1, default off).
create or replace function public.crm_can_see_amounts()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.id = auth.uid()
      and tm.is_active
      and (tm.role in ('admin','fundraiser') or tm.can_see_amounts)
  )
$$;

comment on function public.crm_role() is 'Active team member role for auth.uid(), or null. Basis of every RLS policy (11 §2).';

-- --------------------------------------------------------------------------
-- Operational tables — the uniform matrix row:
--   select  any active team member (viewer included)
--   insert  admin + fundraiser
--   update  admin + fundraiser
--   delete  admin only (11 §1 "Delete, merge, import")
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'households','contacts','tags','taggings','interactions','funds','campaigns',
    'appeals','pledge_installments','recurring_agreements','soft_credits','tributes',
    'gift_aid_declarations','opportunities','tasks','documents'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.crm_is_member())',
      t || '_sel', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.crm_role() in (''admin'',''fundraiser''))',
      t || '_ins', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.crm_role() in (''admin'',''fundraiser'')) with check (public.crm_role() in (''admin'',''fundraiser''))',
      t || '_upd', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.crm_role() = ''admin'')',
      t || '_del', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- donations — amounts are the restricted column set (11 §2).
-- Viewers see gift rows only when can_see_amounts; otherwise they read
-- public.donations_redacted (below), which carries no amount columns.
-- Fundraisers may record gifts but not refund/cancel them (admin-only).
-- --------------------------------------------------------------------------

alter table public.donations enable row level security;

create policy donations_sel on public.donations
  for select to authenticated
  using (public.crm_can_see_amounts());

create policy donations_ins on public.donations
  for insert to authenticated
  with check (public.crm_role() in ('admin','fundraiser'));

create policy donations_upd on public.donations
  for update to authenticated
  using (public.crm_role() in ('admin','fundraiser'))
  with check (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'fundraiser' and status = 'received')  -- no refund/cancel
  );

create policy donations_del on public.donations
  for delete to authenticated
  using (public.crm_role() = 'admin');

-- Amount-free projection for restricted viewers (11 §2).
-- security_invoker = false: the view runs as its owner, so donations' own RLS
-- does not apply; membership is re-asserted in the WHERE clause instead.
create view public.donations_redacted
  with (security_invoker = false) as
select
  d.id, d.contact_id, d.donated_on, d.currency, d.fund_id, d.campaign_id, d.appeal_id,
  d.payment_method, d.status, d.pledge_id, d.installment_id, d.recurring_agreement_id,
  d.receipt_status, d.receipt_pref, d.thank_you_status, d.gift_aid_status,
  d.gift_aid_claim_id, d.is_gasds, d.notes, d.created_by, d.created_at
from public.donations d
where public.crm_is_member();

comment on view public.donations_redacted is
  'Gift ledger without amount/amount_gbp, for viewers whose can_see_amounts is false (11 §2).';

revoke all on public.donations_redacted from anon;
grant select on public.donations_redacted to authenticated, service_role;

-- --------------------------------------------------------------------------
-- pledges — same amount gate; write-off is admin-only (11 §1).
-- --------------------------------------------------------------------------

alter table public.pledges enable row level security;

create policy pledges_sel on public.pledges
  for select to authenticated
  using (public.crm_can_see_amounts());

create policy pledges_ins on public.pledges
  for insert to authenticated
  with check (public.crm_role() in ('admin','fundraiser'));

create policy pledges_upd on public.pledges
  for update to authenticated
  using (public.crm_role() in ('admin','fundraiser'))
  with check (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'fundraiser'
        and status in ('open','fulfilled')
        and write_off_amount is null)                              -- no write-offs
  );

create policy pledges_del on public.pledges
  for delete to authenticated
  using (public.crm_role() = 'admin');

-- --------------------------------------------------------------------------
-- notes — private notes are row-level invisible (11 §2), so they are absent
-- from every list, timeline, export and AI prompt for unauthorised users.
-- --------------------------------------------------------------------------

alter table public.notes enable row level security;

create policy notes_sel on public.notes
  for select to authenticated
  using (
    public.crm_is_member()
    and (not is_private or created_by = auth.uid() or public.crm_role() = 'admin')
  );

create policy notes_ins on public.notes
  for insert to authenticated
  with check (
    public.crm_role() in ('admin','fundraiser')
    and created_by = auth.uid()          -- author stamped server-side (11 §2)
  );

create policy notes_upd on public.notes
  for update to authenticated
  using (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'fundraiser'
        and (not is_private or created_by = auth.uid()))
  )
  with check (public.crm_role() in ('admin','fundraiser'));

create policy notes_del on public.notes
  for delete to authenticated
  using (public.crm_role() = 'admin');

-- --------------------------------------------------------------------------
-- gift_aid_claims — readable by the team, but claim submission is admin-only.
-- The rolling draft claim is created by a SECURITY DEFINER trigger (003),
-- so fundraisers never need write access here.
-- --------------------------------------------------------------------------

alter table public.gift_aid_claims enable row level security;

create policy gift_aid_claims_sel on public.gift_aid_claims
  for select to authenticated using (public.crm_is_member());
create policy gift_aid_claims_ins on public.gift_aid_claims
  for insert to authenticated with check (public.crm_role() = 'admin');
create policy gift_aid_claims_upd on public.gift_aid_claims
  for update to authenticated using (public.crm_role() = 'admin')
  with check (public.crm_role() = 'admin');
create policy gift_aid_claims_del on public.gift_aid_claims
  for delete to authenticated using (public.crm_role() = 'admin');

-- --------------------------------------------------------------------------
-- Configuration — readable by all members, writable by admin (11 §1 Settings).
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lookup_options','automation_rules']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_is_member())', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.crm_role() = ''admin'')', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.crm_role() = ''admin'') with check (public.crm_role() = ''admin'')', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.crm_role() = ''admin'')', t||'_del', t);
  end loop;
end $$;

-- saved_views: admin writes anything; an owner writes their own (06 §1).
alter table public.saved_views enable row level security;

create policy saved_views_sel on public.saved_views
  for select to authenticated using (public.crm_is_member());
create policy saved_views_ins on public.saved_views
  for insert to authenticated
  with check (public.crm_role() = 'admin' or owner_id = auth.uid());
create policy saved_views_upd on public.saved_views
  for update to authenticated
  using (public.crm_role() = 'admin' or owner_id = auth.uid())
  with check (public.crm_role() = 'admin' or owner_id = auth.uid());
create policy saved_views_del on public.saved_views
  for delete to authenticated
  using (public.crm_role() = 'admin' or owner_id = auth.uid());

-- team_members: everyone sees the team; admin manages it; a member may edit
-- their own row (digest preferences, drafting examples).
alter table public.team_members enable row level security;

create policy team_members_sel on public.team_members
  for select to authenticated using (public.crm_is_member());
create policy team_members_ins on public.team_members
  for insert to authenticated with check (public.crm_role() = 'admin');
create policy team_members_upd on public.team_members
  for update to authenticated
  using (public.crm_role() = 'admin' or id = auth.uid())
  with check (public.crm_role() = 'admin' or id = auth.uid());
create policy team_members_del on public.team_members
  for delete to authenticated using (public.crm_role() = 'admin');

-- --------------------------------------------------------------------------
-- signals — the nudge rail is a fundraiser/admin surface (08 §3); viewers
-- have no business acting on nudges, so they cannot read them.
-- --------------------------------------------------------------------------

alter table public.signals enable row level security;

create policy signals_sel on public.signals
  for select to authenticated using (public.crm_role() in ('admin','fundraiser'));
create policy signals_ins on public.signals
  for insert to authenticated with check (public.crm_role() in ('admin','fundraiser'));
create policy signals_upd on public.signals
  for update to authenticated
  using (public.crm_role() in ('admin','fundraiser'))
  with check (public.crm_role() in ('admin','fundraiser'));
create policy signals_del on public.signals
  for delete to authenticated using (public.crm_role() = 'admin');

-- ai_activity_log — the AI guardrail ledger (09 §1). Members read it; the
-- author (or an admin) resolves their own rows.
alter table public.ai_activity_log enable row level security;

create policy ai_activity_log_sel on public.ai_activity_log
  for select to authenticated using (public.crm_is_member());
create policy ai_activity_log_ins on public.ai_activity_log
  for insert to authenticated with check (public.crm_role() in ('admin','fundraiser'));
create policy ai_activity_log_upd on public.ai_activity_log
  for update to authenticated
  using (public.crm_role() = 'admin' or team_member_id = auth.uid())
  with check (public.crm_role() = 'admin' or team_member_id = auth.uid());
create policy ai_activity_log_del on public.ai_activity_log
  for delete to authenticated using (public.crm_role() = 'admin');

-- audit_log — read: admin (11 §4). Written only by the SECURITY DEFINER
-- audit trigger (003), so no insert/update/delete policy exists at all.
alter table public.audit_log enable row level security;

create policy audit_log_sel on public.audit_log
  for select to authenticated using (public.crm_role() = 'admin');

-- --------------------------------------------------------------------------
-- Table grants. RLS decides rows; grants decide verbs. anon never reads CRM
-- data (it has no team_members row, but belt and braces).
-- --------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke all on public.audit_log from anon;
revoke all on public.donations from anon;
revoke all on public.notes from anon;
