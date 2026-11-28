-- Xclr — Migration 007 (007_day_edits.sql)
-- Train tab: "Edit day" and "At home today". No AI involved in either.
--
--  1. day_edits      — "This week only" changes to a program day. One row per
--                      day per training week, holding the FULL replacement
--                      exercise list for that day that week. The program itself
--                      is untouched; "From now on" edits program_exercises
--                      directly and never writes here.
--  2. profiles.home_equipment — what the user has at home (dumbbells up to N
--                      kg, bands, pull-up bar, bench, mat). Drives home swaps.
--  3. at_home_days   — one row per local date the user switched "At home
--                      today" on. Deleting the row switches it off. Kept apart
--                      from day_edits on purpose: it is per calendar date (not
--                      per program day / week) and never changes the plan.
--  4. workout_sessions.duration_min / effort / kcal — "+ Add activity"
--                      (Badminton 60 min, moderate, kcal only if typed).
--
-- RLS + policy + indexes in this same file. Safe to re-run.

-- ============================================================
-- day_edits
-- ============================================================
create table if not exists day_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  program_day_id uuid not null references program_days(id) on delete cascade,
  week_started_on date not null,            -- which training week this belongs to
  edits jsonb not null,                     -- full replacement list for the day
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, program_day_id, week_started_on),
  -- An array of at most 20 items and about 16 KB: a day, never a dump.
  constraint day_edits_shape check (
    jsonb_typeof(edits) = 'array'
    and jsonb_array_length(edits) <= 20
    and pg_column_size(edits) <= 16384
  )
);
alter table day_edits enable row level security;
drop policy if exists "own day_edits" on day_edits;
create policy "own day_edits" on day_edits for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists day_edits_user_week on day_edits (user_id, week_started_on);

-- ============================================================
-- profiles.home_equipment
-- e.g. {"dumbbells_max_kg":10,"bands":false,"pullup_bar":false,"bench":false,"mat":true}
-- null = not set yet (the app treats that as bodyweight only).
-- Covered by the existing "own profile" policy (id = auth.uid()).
-- ============================================================
alter table profiles add column if not exists home_equipment jsonb;
alter table profiles drop constraint if exists profiles_home_equipment_shape;
alter table profiles add constraint profiles_home_equipment_shape check (
  home_equipment is null
  or (jsonb_typeof(home_equipment) = 'object' and pg_column_size(home_equipment) <= 1024)
);

-- ============================================================
-- at_home_days
-- ============================================================
create table if not exists at_home_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,                 -- the user's local calendar day
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)         -- also the lookup index
);
alter table at_home_days enable row level security;
drop policy if exists "own at_home_days" on at_home_days;
create policy "own at_home_days" on at_home_days for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- workout_sessions: extra activities ("+ Add activity" — Badminton 60 min)
-- An activity is a normal session with type = 'activity' and no program day
-- (so it never marks a program day done), plus one set_logs row holding the
-- minutes (actual_load_type = 'time_min') so History and the review see it.
-- kcal is only ever what the user typed — never estimated. Covered by the
-- existing "own sessions" policy and sessions_user_time index.
-- ============================================================
alter table workout_sessions add column if not exists duration_min int;
alter table workout_sessions add column if not exists effort text;
alter table workout_sessions add column if not exists kcal int;
alter table workout_sessions drop constraint if exists workout_sessions_activity_shape;
alter table workout_sessions add constraint workout_sessions_activity_shape check (
  (duration_min is null or duration_min between 1 and 1440)
  and (effort is null or effort in ('easy', 'moderate', 'hard'))
  and (kcal is null or kcal between 0 and 10000)
);

-- ============================================================
-- workout_sessions.at_home — the session was logged with "At home today" on.
-- Home loads are lighter on purpose, so the review, share cards and progress
-- charts never compare them with gym sessions as if they were a regression.
-- ============================================================
alter table workout_sessions add column if not exists at_home boolean not null default false;

-- ============================================================
-- program_edit_log — one line per "From now on" edit the user made to their
-- own plan ("Day 2: swapped Bench press for Dumbbell floor press"). The weekly
-- review reads the last 7 days so the coach doesn't quietly undo them.
-- ============================================================
create table if not exists program_edit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  program_day_id uuid references program_days(id) on delete set null,
  summary text not null check (char_length(summary) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table program_edit_log enable row level security;
drop policy if exists "own program_edit_log" on program_edit_log;
create policy "own program_edit_log" on program_edit_log for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists program_edit_log_user_time on program_edit_log (user_id, created_at desc);

-- ============================================================
-- proposal_items.exercise_id — which exercise the program row held when the
-- coach proposed the change. Approving checks the row still holds it, so a
-- swap made after the review can never receive the old exercise's numbers.
-- (Covered by the existing "own proposal_items" policy.)
-- ============================================================
alter table proposal_items add column if not exists exercise_id uuid references exercises(id) on delete cascade;
create index if not exists proposal_items_user_program_exercise on proposal_items (user_id, program_exercise_id);
