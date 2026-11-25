-- Xclr — Migration 006 (006_day_skips.sql)
-- "Skip this day": a training day can be skipped for the current week, with an
-- optional note (why). The weekly review reads skips + notes so the coach can
-- adjust kindly. One skip per day per week; tapping Undo removes it.
-- RLS + policy + indexes in this same file. Safe to re-run.

create table if not exists day_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  program_day_id uuid not null references program_days(id) on delete cascade,
  week_started_on date not null,           -- which week this skip belongs to
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, program_day_id, week_started_on)
);
alter table day_skips enable row level security;
drop policy if exists "own day_skips" on day_skips;
create policy "own day_skips" on day_skips for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists day_skips_user_week on day_skips (user_id, program_id, week_started_on);
