-- Xclr — Migration 002 (002_training.sql)
-- Master Spec §8 — training engine: plan layer (AI-authored prescription),
-- performance layer (actuals), and the weekly progression approve loop.
-- Every table: RLS enabled + policy + indexes in this same migration file.

-- ============================================================
-- exercises (canonical per-user names)
-- ============================================================
create table exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,                   -- push|pull|legs|core|cardio|mobility
  created_at timestamptz default now()
);
alter table exercises enable row level security;
create policy "own exercises" on exercises for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index exercises_uniq on exercises (user_id, lower(name));

-- ============================================================
-- programs / program_days / program_exercises (plan layer)
-- ============================================================
create table programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text, goal text, active boolean default true,
  week_start date,
  created_at timestamptz default now()
);
alter table programs enable row level security;
create policy "own programs" on programs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table program_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  day_index int not null,                    -- 1..7 cycle
  label text,                                -- Push|Pull|Legs|Recovery|Rest
  type text                                  -- strength|cardio|recovery|rest
);
alter table program_days enable row level security;
create policy "own program_days" on program_days for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table program_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_day_id uuid not null references program_days(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  position int,
  prescribed_sets int,
  rep_scheme text,                           -- "8-10" | "Max" | "20-30 min"
  rep_low int, rep_high int,
  suggested_load_value numeric,
  suggested_load_type text,                  -- total_kg|per_side_kg|assist_kg|bodyweight|time_min|none
  target_rpe_low numeric, target_rpe_high numeric,
  coach_note text                            -- AI-written ("Stay at 30kg. Protect wrist.")
);
alter table program_exercises enable row level security;
create policy "own prog_ex" on program_exercises for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- workout_sessions / set_logs (performance layer)
-- ============================================================
create table workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_day_id uuid references program_days(id),
  performed_at timestamptz not null default now(),
  type text,
  my_note text,                              -- "I am sick today"
  created_at timestamptz default now()
);
alter table workout_sessions enable row level security;
create policy "own sessions" on workout_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index sessions_user_time on workout_sessions (user_id, performed_at desc);

create table set_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  set_index int,
  actual_load_value numeric, actual_load_type text,
  actual_reps int,
  actual_rpe numeric,
  is_pr boolean default false,
  created_at timestamptz default now()
);
alter table set_logs enable row level security;
create policy "own set_logs" on set_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index set_logs_ex on set_logs (user_id, exercise_id);

-- ============================================================
-- progression_proposals / proposal_items (weekly approve loop)
-- ============================================================
create table progression_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week_start date,
  status text default 'pending',             -- pending|approved|rejected
  summary text,
  created_at timestamptz default now(),
  decided_at timestamptz
);
alter table progression_proposals enable row level security;
create policy "own proposals" on progression_proposals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table proposal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null references progression_proposals(id) on delete cascade,
  program_exercise_id uuid not null references program_exercises(id) on delete cascade,
  field text,        -- suggested_load_value|coach_note|prescribed_sets|rep_scheme|target_rpe
  old_value text, new_value text,
  rationale text     -- "hit 4x10 @ RPE7 twice → +2.5kg"
);
alter table proposal_items enable row level security;
create policy "own proposal_items" on proposal_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
