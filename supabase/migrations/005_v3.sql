-- Xclr — Migration 005 (005_v3.sql)
-- v3 build: training weeks, timezone, AI usage tracking, chat cards on reload,
-- chat-proposed changes (approve before apply), and 48-hour photo reads.
--
-- NUMBERING NOTE: a 004 was pasted into Supabase earlier for the old week
-- feature but never reached the repo. This file does NOT depend on it and uses
-- its own column names, so it is safe to run whether or not that 004 exists.
-- Everything uses "if not exists" so a re-run is harmless.
--
-- Every new table: RLS enabled + policy + indexes in this same file.

-- ============================================================
-- programs: which training week you're on, and when it started
-- ============================================================
alter table programs add column if not exists current_week int not null default 1;
alter table programs add column if not exists week_started_on date;
update programs
  set week_started_on = coalesce(week_start, (created_at at time zone 'Asia/Manila')::date)
  where week_started_on is null;

-- ============================================================
-- profiles: the user's timezone ("today" = their local calendar day)
-- ============================================================
alter table profiles add column if not exists timezone text not null default 'Asia/Manila';

-- ============================================================
-- messages: structured extras (food cards, proposals) so chat bubbles
-- look the same after a reload
-- ============================================================
alter table messages add column if not exists meta jsonb;

-- ============================================================
-- medical_conditions: where a note came from + last edit time
-- ============================================================
alter table medical_conditions add column if not exists source text default 'manual'; -- manual|chat|photo
alter table medical_conditions add column if not exists updated_at timestamptz default now();

-- ============================================================
-- ai_usage: one row per AI call, so the Goals screen can show cost
-- ============================================================
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,                      -- parse|coach|vision|program|review
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
alter table ai_usage enable row level security;
-- Read + add only: a cost history can't be edited or deleted from the app.
drop policy if exists "own ai_usage" on ai_usage;
drop policy if exists "own ai_usage read" on ai_usage;
drop policy if exists "own ai_usage insert" on ai_usage;
create policy "own ai_usage read" on ai_usage for select
  using (user_id = auth.uid());
create policy "own ai_usage insert" on ai_usage for insert
  with check (user_id = auth.uid());
create index if not exists ai_usage_user_time on ai_usage (user_id, created_at desc);

-- ============================================================
-- pending_changes: goal / health / profile changes the coach proposes
-- from chat or a photo. Nothing applies until the user taps Approve.
-- ============================================================
create table if not exists pending_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                       -- goal|health|profile
  payload jsonb not null,
  status text not null default 'pending',   -- pending|approved|rejected
  source text not null default 'chat',      -- chat|photo
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table pending_changes enable row level security;
drop policy if exists "own pending_changes" on pending_changes;
create policy "own pending_changes" on pending_changes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists pending_changes_user_status on pending_changes (user_id, status, created_at desc);

-- ============================================================
-- photo_reads: a photo kept for at most 48 hours, then deleted.
-- Only the numbers the user confirms are saved anywhere else.
-- ============================================================
create table if not exists photo_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                       -- food|health|scale
  storage_path text not null,               -- <user_id>/<uuid>.jpg in bucket xclr-photos
  result jsonb,                             -- what the coach read (numbers only)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  deleted_at timestamptz
);
alter table photo_reads enable row level security;
drop policy if exists "own photo_reads" on photo_reads;
create policy "own photo_reads" on photo_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists photo_reads_user_time on photo_reads (user_id, created_at desc);
create index if not exists photo_reads_expiry on photo_reads (expires_at) where deleted_at is null;

-- A row may only point at a file inside its owner's own folder, so the
-- cleanup job can never be tricked into deleting someone else's photo.
alter table photo_reads drop constraint if exists photo_reads_path_owner;
alter table photo_reads add constraint photo_reads_path_owner
  check (storage_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.jpg$'));

-- Users can't stretch the 48 hours: the app may only set these columns.
revoke insert, update on photo_reads from authenticated;
grant insert (user_id, kind, storage_path) on photo_reads to authenticated;
grant update (result, deleted_at) on photo_reads to authenticated;

-- Private storage bucket for photos (not public; 5 MB cap; images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('xclr-photos', 'xclr-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each user can only touch files inside their own folder (<user_id>/...).
drop policy if exists "xclr photos own read" on storage.objects;
create policy "xclr photos own read" on storage.objects for select to authenticated
  using (bucket_id = 'xclr-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "xclr photos own insert" on storage.objects;
create policy "xclr photos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'xclr-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "xclr photos own delete" on storage.objects;
create policy "xclr photos own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'xclr-photos' and (storage.foldername(name))[1] = auth.uid()::text);
