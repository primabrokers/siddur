-- ==========================================================================
-- C1 demo emails — eight clearly-marked rows so the live /comms screen has
-- something to render before a real provider is wired up.
--
-- Run with `execute_sql` (this is data, not schema). Safe to run twice: every
-- row carries a `provider_message_id` beginning `demo-`, and the unique index
-- from 011 turns a second run into a no-op via the ON CONFLICT clause.
--
-- What the eight rows demonstrate, deliberately:
--   · a matched three-message thread that spans Inbox *and* Sent, so the
--     reading pane shows a real back-and-forth;
--   · a two-message thread from an address nobody is on file for — the
--     "Not linked" state and the Link-to-contact path;
--   · a plus-addressed sender (donor+dinner@…), which must still match the
--     same donor (011's crm_email_key);
--   · one message in Archive and one in Trash, so those folders are not empty;
--   · `thread_key`, `contact_id`, `matched_by` and `snippet` are all left out
--     on purpose — the 011 BEFORE INSERT trigger fills them, and that is
--     precisely what these rows prove.
--
-- One note on threading. A real delivery is one INSERT per message, so by the
-- time a reply arrives its parent is committed and the trigger's In-Reply-To
-- lookup finds it. This script inserts all eight in a single statement, where
-- rows earlier in the same command are not yet visible to the trigger — so
-- these threads are grouped by the *subject* half of the rule instead. Both
-- halves land on the same key here (`Re:` is stripped, the counterpart is the
-- same address), which is exactly why the fallback exists.
--
-- To remove them all again:
--   delete from public.emails where provider_message_id like 'demo-%';
-- ==========================================================================

with donor as (
  -- Dovid Cohen by preference; failing that, any live contact with an email,
  -- so the matched thread is matched wherever this is run.
  select id, lower(btrim(email)) as addr
  from public.contacts
  where is_archived = false
    and merged_into_id is null
    and email is not null
    and btrim(email) <> ''
  order by
    (lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) = 'dovid cohen') desc,
    created_at asc
  limit 1
),
sender as (
  select id from public.team_members where role = 'admin' and is_active order by created_at limit 1
),
demo_rows as (
  select * from (values
    -- ---------------------------------------------------------- thread A (matched)
    (
      'demo-a1', 'inbox', 'in',
      'Dovid Cohen <{DONOR}>', array['office@yeshiva.org']::text[], array[]::text[],
      '[DEMO] The building appeal',
      'Thank you for sending the brochure. The naming opportunities look well thought through — I would like to talk properly after Sukkos, once the accounts for the year are closed.',
      '<demo-a1@example.com>', null::text,
      (now() - interval '6 days'), (now() - interval '5 days')
    ),
    (
      'demo-a2', 'sent', 'out',
      'office@yeshiva.org', array['{DONOR}']::text[], array[]::text[],
      'Re: [DEMO] The building appeal',
      'Thank you — after Sukkos suits us well. I will call you the week after and we can go through the two options you marked on page four.',
      '<demo-a2@yeshiva.org>', '<demo-a1@example.com>',
      (now() - interval '5 days'), (now() - interval '5 days')
    ),
    (
      'demo-a3', 'inbox', 'in',
      'Dovid Cohen <{DONOR}>', array['office@yeshiva.org']::text[], array[]::text[],
      'Re: [DEMO] The building appeal',
      'That works. One more thing — my brother-in-law asked whether the same naming scheme applies to the beis medrash floor. Could you send whatever you have on that?',
      '<demo-a3@example.com>', '<demo-a2@yeshiva.org>',
      (now() - interval '5 hours'), null::timestamptz
    ),

    -- ------------------------------------------------------- thread B (unmatched)
    (
      'demo-b1', 'inbox', 'in',
      'Feld Brothers Accounts <accounts@feldbrothers.example>',
      array['office@yeshiva.org']::text[], array['dinner@yeshiva.org']::text[],
      '[DEMO] Invoice for the dinner catering',
      'Please find our invoice for the dinner on the 14th. Payment terms are 30 days. Let us know if you need it split across two cost centres.',
      '<demo-b1@feld.example>', null::text,
      (now() - interval '2 days'), null::timestamptz
    ),
    (
      'demo-b2', 'inbox', 'in',
      'Feld Brothers Accounts <accounts@feldbrothers.example>',
      array['office@yeshiva.org']::text[], array[]::text[],
      'Re: [DEMO] Invoice for the dinner catering',
      'Just following up on the invoice below — no rush, but our year end is the 30th.',
      '<demo-b2@feld.example>', '<demo-b1@feld.example>',
      (now() - interval '20 hours'), null::timestamptz
    ),

    -- ------------------------- thread C (matched *through* plus-addressing)
    (
      'demo-c1', 'inbox', 'in',
      'Dovid Cohen <{DONOR_PLUS}>', array['office@yeshiva.org']::text[], array[]::text[],
      '[DEMO] Dinner seating',
      'We would like the same table as last year if that is still possible, and my brother-in-law will be joining us.',
      '<demo-c1@example.com>', null::text,
      (now() - interval '30 hours'), (now() - interval '29 hours')
    ),

    -- ------------------------------------------------- archive and trash
    (
      'demo-d1', 'archive', 'in',
      'Yaakov Weiss <weiss@example.com>', array['office@yeshiva.org']::text[], array[]::text[],
      '[DEMO] Shiur times for the winter zman',
      'Attached are the winter zman times. No reply needed — filing this for the record.',
      '<demo-d1@example.com>', null::text,
      (now() - interval '9 days'), (now() - interval '9 days')
    ),
    (
      'demo-e1', 'trash', 'in',
      'Charity Supplies <newsletter@charitysupplies.example>',
      array['office@yeshiva.org']::text[], array[]::text[],
      '[DEMO] Your Q4 fundraising toolkit is here',
      'Ten tips for year-end giving, a webinar you did not ask for, and an unsubscribe link in four-point type.',
      '<demo-e1@supplies.example>', null::text,
      (now() - interval '11 days'), (now() - interval '10 days')
    )
  ) as t(
    provider_message_id, folder, direction,
    from_addr, to_addrs, cc_addrs,
    subject, body_text,
    rfc_message_id, in_reply_to,
    occurred_at, read_at
  )
)
insert into public.emails (
  provider_message_id, folder, direction,
  from_addr, to_addrs, cc_addrs,
  subject, body_text,
  rfc_message_id, in_reply_to,
  occurred_at, read_at, sent_by
)
select
  demo_rows.provider_message_id,
  demo_rows.folder,
  demo_rows.direction,
  -- `{DONOR}` / `{DONOR_PLUS}` are substituted from the donor CTE, so the
  -- matched thread matches whichever contact this database actually has.
  replace(
    replace(demo_rows.from_addr, '{DONOR_PLUS}', split_part(donor.addr, '@', 1) || '+dinner@' || split_part(donor.addr, '@', 2)),
    '{DONOR}', donor.addr
  ),
  array(select replace(addr, '{DONOR}', donor.addr) from unnest(demo_rows.to_addrs) as addr),
  demo_rows.cc_addrs,
  demo_rows.subject,
  demo_rows.body_text,
  demo_rows.rfc_message_id,
  demo_rows.in_reply_to,
  demo_rows.occurred_at,
  demo_rows.read_at,
  case when demo_rows.direction = 'out' then sender.id else null end
from demo_rows
cross join donor
left join sender on true
on conflict (provider_message_id) where provider_message_id is not null do nothing;

-- What landed, and what the trigger decided about each row.
select
  e.provider_message_id,
  e.folder,
  e.direction,
  e.subject,
  e.thread_key,
  e.matched_by,
  c.first_name || ' ' || coalesce(c.last_name, '') as matched_contact,
  left(e.snippet, 40) as snippet_head
from public.emails e
left join public.contacts c on c.id = e.contact_id
where e.provider_message_id like 'demo-%'
order by e.thread_key, e.occurred_at;
