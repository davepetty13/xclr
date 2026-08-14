-- Xclr — Migration 001 (001_init.sql)
-- Master Spec §7 + Doc 02 §1 profiles addendum (availability & context).
-- Every table: RLS enabled + policy + indexes in this same migration.

-- ============================================================
-- profiles
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  sex text,                                  -- optional, for estimates
  birthdate date,                            -- optional
  height_cm numeric,                         -- for BMI (computed, never stored)
  weight_unit text default 'kg',
  goal_weight_kg numeric,
  primary_goal text default 'general_health',-- build_muscle|lose_fat|maintain|endurance|general_health
  sports text[] default '{}',                -- {lifting,running,cycling,swimming,...}
  daily_calorie_target int default 2200,
  daily_protein_target int default 150,
  daily_step_target int default 8000,
  coach_persona jsonb default '{}'::jsonb,
  health_data_consent_at timestamptz,
  -- Doc 02 §1 addendum: availability & context for program generation
  training_days_per_week int default 4,
  session_minutes int default 60,            -- typical session length
  preferred_days text[] default '{}',        -- {mon,tue,...} optional
  preferred_time text,                       -- morning|lunch|evening|flexible
  training_experience text default 'intermediate',  -- beginner|intermediate|advanced
  equipment_access text default 'commercial_gym',   -- commercial_gym|home_basic|bodyweight_only
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================
-- food_logs
-- ============================================================
create table food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  meal text,                       -- breakfast|brunch|lunch|dinner|snack
  name text not null,
  serving text,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  source text default 'chat',      -- chat|manual|library
  is_estimate boolean default true,
  created_at timestamptz default now()
);
alter table food_logs enable row level security;
create policy "own food" on food_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index food_logs_user_time on food_logs (user_id, logged_at desc);

-- ============================================================
-- food_library (personal accuracy memory)
-- ============================================================
create table food_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  serving text,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  times_logged int default 1,
  updated_at timestamptz default now()
);
alter table food_library enable row level security;
create policy "own library" on food_library for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index food_library_uniq on food_library (user_id, lower(name));

-- ============================================================
-- weights
-- ============================================================
create table weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null default current_date,
  kg numeric not null,
  created_at timestamptz default now()
);
alter table weights enable row level security;
create policy "own weights" on weights for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index weights_uniq on weights (user_id, measured_on);

-- ============================================================
-- sleep_logs (manual v1; HealthKit later)
-- ============================================================
create table sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slept_on date not null default current_date,
  bedtime timestamptz, wake_time timestamptz,
  duration_min int,
  quality int,                               -- 1-5
  source text default 'manual',
  note text,
  created_at timestamptz default now()
);
alter table sleep_logs enable row level security;
create policy "own sleep" on sleep_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index sleep_uniq on sleep_logs (user_id, slept_on);

-- ============================================================
-- medical_conditions (consent-gated: only written after
-- profiles.health_data_consent_at is set — enforced in app layer)
-- ============================================================
create table medical_conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  condition text not null,
  notes text,
  active boolean default true,
  created_at timestamptz default now()
);
alter table medical_conditions enable row level security;
create policy "own medical" on medical_conditions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
