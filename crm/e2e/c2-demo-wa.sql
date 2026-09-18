-- ==========================================================================
-- c2-demo-wa.sql — a small, clearly-labelled demo WhatsApp dataset
--
-- Purpose: make the live Comms pane render something real before Meta is
-- connected, and prove the two things migration 012 claims:
--
--   1. the BEFORE INSERT trigger matches a `wa_id` to a donor by
--      `contacts.whatsapp` then `contacts.phone`, normalised;
--   2. the 24-hour customer-service window is *computed* — one conversation is
--      inside it (free text allowed) and one is outside (approved template
--      only), and neither stores a boolean saying so.
--
-- It picks the first two non-archived contacts that have a usable number, so it
-- needs no hard-coded ids and is safe to run against any seeded database.
--
-- Everything it writes is marked: `profile_name` starts with `DEMO ·` and every
-- `wa_message_id` starts with `demo.c2.`. The cleanup block at the foot removes
-- exactly those rows and nothing else.
--
-- Re-runnable: conversations upsert on `wa_id`, messages do nothing on a
-- `wa_message_id` collision — the same idempotency the webhook relies on.
--
--   Run with: supabase SQL editor, psql, or execute_sql against
--             project zyvhcnhablkgbsgtljma.
-- ==========================================================================

do $$
declare
  v_open_contact   uuid;
  v_open_wa        text;
  v_closed_contact uuid;
  v_closed_wa      text;
  v_open_conv      uuid;
  v_closed_conv    uuid;
begin
  -- ---------------------------------------------------------------- donors
  -- The number is taken from the donor record, so the trigger has something
  -- real to match: this is the matching test, not a fixture.
  select c.id, public.crm_wa_normalise(coalesce(c.whatsapp, c.phone))
    into v_open_contact, v_open_wa
  from public.contacts c
  where c.is_archived = false
    and coalesce(c.is_organisation_self, false) = false
    and public.crm_wa_normalise(coalesce(c.whatsapp, c.phone)) is not null
  order by c.created_at, c.id
  limit 1;

  select c.id, public.crm_wa_normalise(coalesce(c.whatsapp, c.phone))
    into v_closed_contact, v_closed_wa
  from public.contacts c
  where c.is_archived = false
    and coalesce(c.is_organisation_self, false) = false
    and public.crm_wa_normalise(coalesce(c.whatsapp, c.phone)) is not null
    and public.crm_wa_normalise(coalesce(c.whatsapp, c.phone)) is distinct from v_open_wa
  order by c.created_at, c.id
  limit 1;

  if v_open_wa is null then
    raise notice 'c2 demo: no contact carries a usable phone or WhatsApp number — nothing written.';
    return;
  end if;

  -- ------------------------------------------------- 1 · window OPEN (2h ago)
  insert into public.wa_conversations (wa_id, profile_name, last_inbound_at, last_message_at, unread_count)
  values (v_open_wa, 'DEMO · window open', now() - interval '2 hours', now() - interval '90 minutes', 2)
  on conflict (wa_id) do update
    set profile_name    = excluded.profile_name,
        last_inbound_at = excluded.last_inbound_at,
        last_message_at = excluded.last_message_at,
        unread_count    = excluded.unread_count
  returning id into v_open_conv;

  insert into public.wa_messages
    (conversation_id, direction, wa_message_id, msg_type, body, status, occurred_at)
  values
    (v_open_conv, 'out', 'demo.c2.open.1', 'text',
     '[DEMO] Good morning — are you around this week? I wanted to show you the new beis medrash plans.',
     'read', now() - interval '28 hours'),
    (v_open_conv, 'in', 'demo.c2.open.2', 'text',
     '[DEMO] Thursday works. What time?',
     'received', now() - interval '27 hours'),
    (v_open_conv, 'out', 'demo.c2.open.3', 'text',
     '[DEMO] 11am at the yeshiva? I''ll have the drawings out.',
     'delivered', now() - interval '26 hours'),
    (v_open_conv, 'in', 'demo.c2.open.4', 'text',
     '[DEMO] Perfect — and I''ll sort out the standing order on Sunday bez"H.',
     'received', now() - interval '2 hours'),
    (v_open_conv, 'out', 'demo.c2.open.5', 'text',
     '[DEMO] Thank you — that means a great deal. See you Thursday.',
     'read', now() - interval '90 minutes')
  on conflict (wa_message_id) do nothing;

  raise notice 'c2 demo: open conversation % on % (contact %)', v_open_conv, v_open_wa, v_open_contact;

  -- --------------------------------------------- 2 · window CLOSED (40h ago)
  if v_closed_wa is null then
    raise notice 'c2 demo: only one contact had a number — the closed-window conversation was skipped.';
    return;
  end if;

  insert into public.wa_conversations (wa_id, profile_name, last_inbound_at, last_message_at, unread_count)
  values (v_closed_wa, 'DEMO · window closed', now() - interval '40 hours', now() - interval '39 hours', 0)
  on conflict (wa_id) do update
    set profile_name    = excluded.profile_name,
        last_inbound_at = excluded.last_inbound_at,
        last_message_at = excluded.last_message_at,
        unread_count    = excluded.unread_count
  returning id into v_closed_conv;

  insert into public.wa_messages
    (conversation_id, direction, wa_message_id, msg_type, body, template_name, status, occurred_at)
  values
    (v_closed_conv, 'in', 'demo.c2.closed.1', 'text',
     '[DEMO] Can you send me the dinner details again?', null,
     'received', now() - interval '40 hours'),
    (v_closed_conv, 'out', 'demo.c2.closed.2', 'template',
     null, 'dinner_invite_2026',
     'read', now() - interval '39 hours 30 minutes'),
    (v_closed_conv, 'out', 'demo.c2.closed.3', 'text',
     '[DEMO] 18 November, 8pm, at the hall on Bell Lane. You''re on table 3.', null,
     'delivered', now() - interval '39 hours')
  on conflict (wa_message_id) do nothing;

  raise notice 'c2 demo: closed conversation % on % (contact %)', v_closed_conv, v_closed_wa, v_closed_contact;
end $$;

-- --------------------------------------------------------------------------
-- What it should look like afterwards: one row `window_open = true`, one false,
-- and both matched to a donor by the trigger rather than by this file.
-- --------------------------------------------------------------------------

select
  c.profile_name,
  c.wa_id,
  c.matched_by,
  c.unread_count,
  w.window_open,
  w.window_expires_at,
  (select count(*) from public.wa_messages m where m.conversation_id = c.id) as messages
from public.wa_conversations c
join public.wa_conversation_window w on w.conversation_id = c.id
where c.profile_name like 'DEMO ·%'
order by c.last_message_at desc;

-- --------------------------------------------------------------------------
-- Cleanup — removes exactly what this file wrote, and nothing a webhook may
-- have added since. Run it when the demo data has served its purpose.
-- --------------------------------------------------------------------------
--
-- delete from public.wa_messages where wa_message_id like 'demo.c2.%';
-- delete from public.wa_conversations c
--  where c.profile_name like 'DEMO ·%'
--    and not exists (select 1 from public.wa_messages m where m.conversation_id = c.id);
