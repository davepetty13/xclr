-- Xclr — Migration 008 (008_health_notify.sql)
-- A) Apple Health sync (free, via iPhone Shortcuts): daily totals, Watch
--    workouts, and a private sync link (only its SHA-256 hash is stored).
-- B) Notifications: Web Push subscriptions, per-user reminder settings, and
--    the in-app inbox (the bell on Today).
--
-- Every new table: RLS enabled + policy + indexes in this same file.
-- Everything uses "if not exists" / "drop ... if exists", so a re-run is harmless.
--
-- The 15-minute reminder schedule is NOT created here (it needs your
-- CRON_SECRET). See the comment at the very bottom of this file.

-- ============================================================
-- profiles: which Apple Health fields Xclr accepts, plus share_with_coach
-- (send weekly averages + Watch workouts to the weekly review; set to true
-- when the first sync link is made, and the user can switch it off).
-- ============================================================
alter table profiles add column if not exists health_sync_fields jsonb not null
  default '{"steps":true,"active":true,"workouts":true,"sleep":true,"weight":true,"resting_hr":true}'::jsonb;

-- Safe to re-run on a database where an earlier draft of this file ran.
alter table if exists health_sync_tokens add column if not exists sync_day date;
alter table if exists health_sync_tokens add column if not exists sync_count_today int not null default 0;
alter table if exists notification_prefs add column if not exists workout_reminder_on boolean not null default true;
alter table if exists notification_prefs add column if not exists workout_reminder_time time not null default '20:00';
alter table if exists notification_prefs add column if not exists calories_on boolean not null default true;
alter table if exists notification_prefs add column if not exists calories_time time not null default '20:00';

-- ============================================================
-- weights: where a weigh-in came from (manual|chat|photo|apple_health)
-- ============================================================
alter table weights add column if not exists source text not null default 'manual';

-- ============================================================
-- health_daily: one row per user per local day, from Apple Health
-- ============================================================
create table if not exists health_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  steps int check (steps is null or steps between 0 and 200000),
  active_kcal int check (active_kcal is null or active_kcal between 0 and 20000),
  resting_hr int check (resting_hr is null or resting_hr between 20 and 250),
  sleep_minutes int check (sleep_minutes is null or sleep_minutes between 0 and 1440), -- last night's sleep
  weight_kg numeric check (weight_kg is null or weight_kg between 20 and 400),
  source text not null default 'apple_health'
    check (source in ('apple_health', 'health_connect', 'other')),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table health_daily enable row level security;
-- Read + remove your own rows. Rows are written only by the sync endpoint
-- (service role), so a page can't plant numbers.
drop policy if exists "own health_daily read" on health_daily;
create policy "own health_daily read" on health_daily for select
  using (user_id = auth.uid());
drop policy if exists "own health_daily delete" on health_daily;
create policy "own health_daily delete" on health_daily for delete
  using (user_id = auth.uid());
create index if not exists health_daily_user_date on health_daily (user_id, local_date desc);

-- ============================================================
-- health_workouts: Watch workouts (shown in Train as extra activity)
-- ============================================================
create table if not exists health_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  kind text not null default 'Workout' check (char_length(kind) between 1 and 60),
  minutes int check (minutes is null or minutes between 0 and 1440),
  kcal int check (kcal is null or kcal between 0 and 20000),
  avg_hr int check (avg_hr is null or avg_hr between 20 and 250),
  source text not null default 'apple_health'
    check (source in ('apple_health', 'health_connect', 'other')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
alter table health_workouts enable row level security;
drop policy if exists "own health_workouts read" on health_workouts;
create policy "own health_workouts read" on health_workouts for select
  using (user_id = auth.uid());
drop policy if exists "own health_workouts delete" on health_workouts;
create policy "own health_workouts delete" on health_workouts for delete
  using (user_id = auth.uid());
create index if not exists health_workouts_user_time on health_workouts (user_id, started_at desc);

-- ============================================================
-- health_sync_tokens: the private sync link. Only a SHA-256 hash of the
-- token is stored; the token itself is shown once and never saved.
-- ============================================================
create table if not exists health_sync_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,             -- last accepted sync (also the rate limit)
  sync_day date,                        -- local day that sync_count_today counts
  sync_count_today int not null default 0 check (sync_count_today >= 0)
);
alter table health_sync_tokens enable row level security;
-- The owner may see that a link exists and delete it ("Turn off sync").
-- Making a link and every sync-time update go through the service role, so a
-- page can't reset the rate limit or plant a hash.
drop policy if exists "own health_sync_tokens" on health_sync_tokens;
drop policy if exists "own health_sync_tokens read" on health_sync_tokens;
create policy "own health_sync_tokens read" on health_sync_tokens for select
  using (user_id = auth.uid());
drop policy if exists "own health_sync_tokens delete" on health_sync_tokens;
create policy "own health_sync_tokens delete" on health_sync_tokens for delete
  using (user_id = auth.uid());
revoke insert, update on health_sync_tokens from authenticated, anon;
grant select, delete on health_sync_tokens to authenticated;
-- (token_hash is unique, which also indexes the endpoint's lookup.)

-- Atomic rate limit for the sync endpoint: claims the link only if it wasn't
-- used in the last p_gap_seconds, and counts today's syncs in the same
-- statement. No row back = unknown link or too soon. Service role only.
create or replace function public.claim_health_sync(p_token_hash text, p_gap_seconds int, p_today date)
returns table (out_user_id uuid, out_sync_count int)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.health_sync_tokens t
     set last_used_at = now(),
         sync_count_today = case when t.sync_day = p_today then t.sync_count_today + 1 else 1 end,
         sync_day = p_today
   where t.token_hash = p_token_hash
     and (t.last_used_at is null
          or t.last_used_at < now() - make_interval(secs => greatest(coalesce(p_gap_seconds, 60), 1)))
  returning t.user_id, t.sync_count_today;
$$;
revoke all on function public.claim_health_sync(text, int, date) from public, anon, authenticated;
grant execute on function public.claim_health_sync(text, int, date) to service_role;

-- ============================================================
-- push_subscriptions: one row per iPhone/browser that allowed notifications
-- ============================================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
alter table push_subscriptions enable row level security;
drop policy if exists "own push_subscriptions" on push_subscriptions;
create policy "own push_subscriptions" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
-- Only the real push services (Google/Chrome, Apple, Mozilla, Windows) — the
-- server never posts to any other host.
alter table push_subscriptions drop constraint if exists push_subscriptions_known_host;
alter table push_subscriptions add constraint push_subscriptions_known_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
);

-- ============================================================
-- notification_prefs: which reminders, at what local time
-- ============================================================
create table if not exists notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,   -- send to this iPhone (the bell always gets them)
  breakfast_on boolean not null default true,
  breakfast_time time not null default '10:00',
  lunch_on boolean not null default true,
  lunch_time time not null default '14:00',
  dinner_on boolean not null default true,
  dinner_time time not null default '21:00',
  session_on boolean not null default true,
  session_time time not null default '07:00',
  workout_reminder_on boolean not null default true,  -- planned day, nothing logged yet
  workout_reminder_time time not null default '20:00',
  calories_on boolean not null default true,          -- eaten far under / over target
  calories_time time not null default '20:00',
  review_on boolean not null default true,
  nudges_on boolean not null default true,
  quiet_start time default '22:00',          -- null = no quiet hours
  quiet_end time default '06:00',
  updated_at timestamptz not null default now()
);
alter table notification_prefs enable row level security;
drop policy if exists "own notification_prefs" on notification_prefs;
create policy "own notification_prefs" on notification_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- notifications: the in-app inbox. Written only by the reminder job
-- (service role); the owner can read them and mark them read.
-- ============================================================
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (char_length(kind) <= 40),
  title text not null check (char_length(title) <= 120),
  body text check (body is null or char_length(body) <= 400),
  -- An in-app path only: "/x", never "//host" or "/\\host".
  url text check (url is null or (url ~ '^/(?![/\\])' and char_length(url) <= 200)),
  action jsonb,                              -- optional one-tap action
  dedupe_key text not null check (char_length(dedupe_key) <= 120),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  unique (user_id, dedupe_key)
);
alter table notifications enable row level security;
drop policy if exists "own notifications read" on notifications;
create policy "own notifications read" on notifications for select
  using (user_id = auth.uid());
drop policy if exists "own notifications mark read" on notifications;
create policy "own notifications mark read" on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- The app may only change read_at; no inserts or deletes from a user session.
revoke insert, update, delete on notifications from authenticated, anon;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
alter table notifications drop constraint if exists notifications_url_internal;
alter table notifications add constraint notifications_url_internal check (
  url is null or url ~ '^/(?![/\\])'
);
create index if not exists notifications_user_time on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread on notifications (user_id) where read_at is null;

-- ============================================================
-- Reminder schedule (run by hand, once, AFTER this migration).
-- Vercel Hobby crons only run daily, so Supabase calls the endpoint every
-- 15 minutes instead. Needs the pg_cron and pg_net extensions (Database →
-- Extensions). Replace <CRON_SECRET> with the same value as in Vercel.
-- Never commit the real secret.
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'xclr-notify',
--     '*/15 * * * *',
--     $$ select net.http_post(
--          url := 'https://xclr.vercel.app/api/cron/notify',
--          headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--          timeout_milliseconds := 30000
--        ) $$
--   );
--
-- To stop it:  select cron.unschedule('xclr-notify');
-- (The same snippet lives in docs/notify-cron.sql.)
-- ============================================================
