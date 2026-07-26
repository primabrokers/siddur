-- Luach app schema: additive only, namespaced luach_*, no changes to existing tables
-- (This migration has been applied to project qdofumucgrggpehrxvdr as 'luach_app_initial_schema')

create table if not exists public.luach_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  nusach text not null default 'ashkenaz' check (nusach in ('ashkenaz','sefard','edot_hamizrach')),
  zmanim_settings jsonb not null default '{"shema":"gra_and_ma","tzeis_minutes":42,"alos_minutes":72,"rt_tzeis":true}'::jsonb,
  candle_offset_minutes int not null default 18,
  location jsonb,
  diaspora boolean not null default true,
  kl_wait_days int not null default 3 check (kl_wait_days in (3,7)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.luach_alarms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  time_of_day time not null,
  ring_seconds int not null default 60 check (ring_seconds between 10 and 600),
  sound text not null default 'chime',
  scope text not null default 'weekday' check (scope in ('weekday','every_shabbos','yomtov_block')),
  block_key text,
  day_assignments jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.luach_minyanim (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shul_name text not null,
  tefillah text not null check (tefillah in ('shacharis','mincha','maariv')),
  minyan_time time not null,
  remind_minutes_before int not null default 15,
  location jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.luach_notification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anchor text not null check (anchor in ('candle_lighting','shkia','tzeis','alos','netz','chatzos','plag','sof_zman_shema','havdalah','fixed')),
  offset_minutes int not null default 0,
  fixed_time time,
  message text not null,
  day_filter text not null default 'daily' check (day_filter in ('daily','weekdays','erev_shabbos_yomtov','fast_days','rosh_chodesh','motzei_shabbos')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.luach_yahrzeits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relationship text,
  heb_month int not null check (heb_month between 1 and 13),
  heb_day int not null check (heb_day between 1 and 30),
  notes text,
  remind_days_before int not null default 7,
  created_at timestamptz not null default now()
);

create table if not exists public.luach_siddur_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nusach text not null default 'ashkenaz' check (nusach in ('ashkenaz','sefard','edot_hamizrach')),
  display_mode text not null default 'interlinear' check (display_mode in ('interlinear','hebrew_only','side_by_side')),
  bookmarks jsonb not null default '[]'::jsonb,
  last_ref text,
  updated_at timestamptz not null default now()
);

create table if not exists public.luach_siddur_texts (
  ref text primary key,
  nusach text not null,
  payload jsonb not null,
  english_segments int not null default 0,
  total_segments int not null default 0,
  fetched_at timestamptz not null default now()
);

alter table public.luach_profiles enable row level security;
alter table public.luach_alarms enable row level security;
alter table public.luach_minyanim enable row level security;
alter table public.luach_notification_rules enable row level security;
alter table public.luach_yahrzeits enable row level security;
alter table public.luach_siddur_prefs enable row level security;
alter table public.luach_siddur_texts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['luach_alarms','luach_minyanim','luach_notification_rules','luach_yahrzeits']
  loop
    execute format('create policy "own rows select" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

create policy "own profile select" on public.luach_profiles for select to authenticated using (id = auth.uid());
create policy "own profile insert" on public.luach_profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.luach_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "own prefs select" on public.luach_siddur_prefs for select to authenticated using (user_id = auth.uid());
create policy "own prefs insert" on public.luach_siddur_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "own prefs update" on public.luach_siddur_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "siddur cache public read" on public.luach_siddur_texts for select to anon, authenticated using (true);

create index if not exists luach_alarms_user_idx on public.luach_alarms(user_id);
create index if not exists luach_minyanim_user_idx on public.luach_minyanim(user_id);
create index if not exists luach_rules_user_idx on public.luach_notification_rules(user_id);
create index if not exists luach_yahrzeits_user_idx on public.luach_yahrzeits(user_id);
create index if not exists luach_siddur_texts_nusach_idx on public.luach_siddur_texts(nusach);
