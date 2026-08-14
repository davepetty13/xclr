# Xclr — Master Specification & Handoff Document

*Version 1.0 · July 20, 2026 · Owner: Dave Petty*
*Purpose: complete project handoff. This document is self-contained — it carries the full context, decisions, data model, AI behavior, and build plan so work can continue without prior chat history.*

---

## 1. What Xclr is

**Xclr is a personal health & wellness app with an AI coach at its core.** One place that replaces three fragmented tools Dave currently juggles:

| Current tool | What it does today | What replaces it |
|---|---|---|
| ChatGPT bot ("HEALTH") in Telegram | Natural-language food/weight logging, calorie & protein estimates, motivational coaching with memory | **Chat tab** (same experience, persistent storage) |
| Google Sheets | Workout program + logged sets (plan vs actual, RPE, notes) | **Workout tab** (program, logging, progression charts, weekly review) |
| Nothing / manual | Sleep, trends, goals | **Today dashboard, Goals, Trends** |

Core thesis: **the AI is the parser, estimator, and coach; Supabase is the memory.** The user talks naturally ("today, weight 71.75, brunch: mcdo chicken 1 leg, 1/2 rice, protein bar"), the AI turns it into structured rows, the dashboard reads those rows.

**Key differentiator:** LLM-based nutrition estimation handles **Filipino food** (adobo, sinigang, kare-kare) that standard nutrition databases handle poorly. Estimates improve over time via a personal food library ("my adobo = 310 kcal" once confirmed).

**Users:** Dave + up to ~5 friends. Not commercial (yet). A future "sell to gyms" idea exists but is explicitly deferred — the architecture keeps that path open (add `tenant_id` later) without building for it now.

## 2. Origin & context

- Dave already built the chat-logging half with a ChatGPT Telegram bot. It works well (parses food, tracks weight trend, coaches with personality: "Dave… 😏 remember panicking at 73.33 kg?"). Its weaknesses: data lives in chat scrollback (not queryable), and it's a separate app layer he doesn't want.
- Workout tracking lives in a Google Sheet with columns: Day, Exercise, Sets, Reps, Actual Reps, Suggested Weight, Actual Weight, Target RPE, RPE, Coach Notes, My Notes. Load formats include "30kg", "15kg/side", "40kg assist", "Bodyweight", "20-30 min". Progression is hard to see in Sheets — that pain is a primary motivation.
- Dave is the builder of **MERS** (multi-tenant SaaS for PH beauty/wellness industry) and applies the same disciplined build workflow to Xclr (see §3).
- Three interactive HTML mockups were iterated; the approved one is **xclr-mock-v2.html** (5 tabs, weekly review loop). Dave's verdict: "very well looks like something I will use daily."

## 3. Build workflow (non-negotiable, inherited from MERS)

- **Gates: Document → Mockup → Approve → Build.** Nothing is built without an approved doc + mockup.
- Plan mode before any non-trivial build. Force-clarify when confidence < ~95%. Stop and flag discrepancies.
- **RLS on every table from creation** — policies + indexes in the same migration file. Sequential numbered migrations.
- `tsc --noEmit` clean before commits. Manual verification before commit. **Never push without Dave's explicit instruction.**
- Design tokens only — never hardcode hex values.

## 4. Stack & project identity

- **Next.js 14 App Router · Supabase · Vercel · Google OAuth (only) · Resend · Claude Code** for building.
- **New, separate repo and new, separate Supabase project.** Do NOT reuse MERS's repo or Supabase project (`brwtqqsxexaufhrygivq`). Xclr is single-user-per-row; MERS is multi-tenant. Keep them isolated.
- iOS distribution via **Capacitor shell + TestFlight** (≤100 testers) — no App Store review needed for the friend group. Requires Apple Developer account ($99/yr), HealthKit entitlement, `NSHealthShareUsageDescription`/`NSHealthUpdateUsageDescription`, and a privacy policy.
- **Strava is ruled out**: its API terms prohibit use of Strava data in connection with AI applications, and restrict third-party display of user data. **Apple Watch via HealthKit is the activity source** (heart rate, steps, workouts, calories, sleep). HealthKit is native/on-device only — hence the Capacitor shell; the web app alone cannot read it.

## 5. Security model

- RLS everywhere, single shape: `user_id = auth.uid()` (profiles: `id = auth.uid()`). Each user sees only their own rows — this is all that's needed for Dave + friends.
- Future commercial path = additive `tenant_id`, not a rewrite.
- Medical data is consent-gated (§8) and would carry real compliance weight (PH Data Privacy Act+) if ever commercial.

## 6. Units convention

Store metric always: **kg** and **kcal**. `profiles.weight_unit` ('kg'|'lbs') is a display-only preference; convert at render (×2.20462). Never store lbs; switching units is a view toggle, never a migration.

## 7. Data model — Migration 001 (`001_init.sql`)

> Every table below: RLS enabled + policy + indexes in the same migration.

### profiles
```sql
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());
```
Signup collects: name, height, optional sex/birthdate, goal weight, primary goal, sports, unit pref, optional medical (with consent). **BMI is computed and displayed at signup as one datapoint with an explicit caveat** — it can't distinguish muscle from fat, so for lifters it's context, never a verdict; planning uses goal + trend, not BMI alone. **`primary_goal` + `sports` reconfigure the dashboard** (build_muscle → progression; endurance → pace/distance/HR; lose_fat → deficit) and are changeable anytime (change triggers an AI program review).

### food_logs
```sql
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
```

### food_library (personal accuracy memory)
```sql
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
```
First log of a dish = AI estimate; user can correct; confirmed values upsert here; future logs of the same dish use the user's own number. Everyone eats the same ~40–50 dishes on repeat — accuracy compounds.

### weights
```sql
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
```

### sleep_logs (manual v1; HealthKit later)
```sql
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
```

### medical_conditions (consent-gated)
```sql
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
```
Only written after `profiles.health_data_consent_at` is set. Guardrail in §11.

## 8. Data model — Migration 002 (`002_training.sql`)

Two layers mirroring Dave's sheet — **plan** (prescription, AI-authored) and **performance** (actuals) — plus a **weekly proposal** layer for the approve loop.

### exercises (canonical per-user names)
```sql
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
```

### programs / program_days / program_exercises (plan layer)
```sql
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
```
**Load type is critical**: Dave's real loads include total kg, per-side kg, assist kg (lower = stronger), bodyweight, and time-based. Store value + type; never flatten.

### workout_sessions / set_logs (performance layer)
```sql
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
```

### progression_proposals / proposal_items (weekly approve loop)
```sql
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
```
**On approve:** apply each item's `new_value` to its `program_exercises.field`; mark proposal approved. User can edit items before approving, or reject to keep the week unchanged. Approved proposals are the program history.

### Progression query (the payoff Sheets can't deliver)
```sql
select w.performed_at::date as day, s.actual_load_value, s.actual_reps, s.actual_rpe,
       round(s.actual_load_value * (1 + s.actual_reps/30.0), 1) as est_1rm   -- Epley
from set_logs s
join workout_sessions w on w.id = s.session_id
join exercises e on e.id = s.exercise_id
where s.user_id = auth.uid() and e.name = 'Chest Press Machine'
order by w.performed_at;
```

## 9. Data model — Migration 003 (`003_metrics.sql`, Apple Watch)

```sql
create table daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_date date not null default current_date,
  steps int,
  active_kcal numeric,
  resting_hr int,
  sleep_min int,
  source text default 'healthkit',
  created_at timestamptz default now()
);
alter table daily_metrics enable row level security;
create policy "own metrics" on daily_metrics for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index daily_metrics_uniq on daily_metrics (user_id, metric_date);
```
Synced on-device by the Capacitor iOS app via a HealthKit plugin (e.g. Cap-go/capacitor-health or @perfood/capacitor-healthkit) → pushed to Supabase. Cardio workouts from HealthKit can also create `workout_sessions` rows (`source='healthkit'`).

## 10. AI-parse contract (chat → JSON → tables)

The AI never free-writes to the DB. It returns strict JSON; the app maps it to rows.

```json
{
  "foods": [
    {"name":"chicken adobo","serving":"1 cup","meal":"lunch",
     "kcal":290,"protein_g":26,"carbs_g":6,"fat_g":18,"is_estimate":true}
  ],
  "workout": {
    "type":"push",
    "sets":[{"exercise":"chest press machine","load_value":30,"load_type":"total_kg","reps":10,"rpe":7}]
  },
  "sleep": {"duration_min":450,"quality":4},
  "weight_kg": 71.75,
  "needs_clarification": null
}
```
Mapping: `foods[]` → food_logs (check food_library first for known dishes); `workout` → workout_sessions + set_logs (upsert exercises by name); `sleep` → sleep_logs; `weight_kg` → weights (convert lbs→kg on the way in if the user speaks in lbs).
**Anti-fabrication rule:** vague input ("had lunch") → set `needs_clarification`, write **nothing**. Never invent numbers — fake-precise data poisons trends. All logged estimates are tap-to-edit; confirmed edits upsert into food_library.

## 11. AI coach behavior (the product's soul)

- **Workout — AI builds & adjusts; Dave approves.** Initial program generated at signup from primary_goal + height/BMI-context + sports + consented medical notes. Weekly: AI reviews set_logs vs program (RPE-driven, cautious — e.g. "increase only if back feels good"), writes a progression_proposal with per-item rationale. **Nothing changes without user approval.** Goal/sport change triggers a program review.
- **Nutrition — recommends, never strict.** Freeform logging, gentle nudges ("60g protein short — 2 eggs + a shake covers it"), can suggest meals to close gaps. Explicitly not a rigid meal-plan enforcer.
- **Dashboard cadence — weekly.** The 7-day program cycle is the natural unit: plan vs done, adherence, progression vs last week.
- **Voice — motivational, emotional, personal.** Per-user `coach_persona` jsonb (e.g. `{"coach_name":"Xclr","tone":"motivational","sass_level":2,"emoji":true,"focus":["protein","consistency","don't chase the scale"]}`). The personality is delivered by the **system prompt** (Doc 02), which reads the profile + recent logs before each reply — that's what produces "Dave… 😏 remember panicking at 73.33?" The persona field stores settings; the prompt is the craft.
- **Medical guardrail (hard rule):** the coach may *account for* consented conditions (lower-impact alternatives, "protect wrist" notes) but must **never diagnose, prescribe, or override a doctor**; anything medical → point to a professional.
- **BMI framing (hard rule):** computed at signup, shown once as context with the muscle-vs-fat caveat; never used as the sole planning input, never presented as a verdict.

## 12. App structure (approved mock: xclr-mock-v2.html)

Five tabs:
1. **Today** — calories left (hero), protein bar, this-week vs plan (workouts done, avg sleep, kcal burned), weight trend sparkline with "don't chase single readings" note, today's meals.
2. **Food** — search/barcode (later), meal segment, quick-add from personal library, logged list (tap to remove/edit).
3. **Workout** — four sub-views: *Today* (prescribed day: sets × reps @ load, target RPE, coach note; check off + log actuals), *Progress* (per-exercise charts; assist-type charts render downward-as-progress), *Week review* (pending proposal: old → new per exercise + rationale + Approve / Keep-as-is per item), *History* (sessions with PRs, volume, "my notes").
4. **Chat** — the coach. Freeform logging, food cards with running totals, quick-log chips, coaching replies. Same parser writes to the same tables as everything else.
5. **Goals** — primary goal (drives dashboard), sports chips (changeable), calorie/protein/weight/sleep targets, kg⇄lbs preference.

## 13. Design system

- Tokens in `globals.css` (CSS custom properties), never hardcode hex:
  `--paper #F6F3EC · --card #FFFFFF · --ink #16211B · --muted #6E7A72 · --faint #9AA49C · --line #ECE7DC · --green #1E7A4D (nutrition/intake/progress) · --green-soft #E5F1EA · --ember #E0603A (activity/burn/attention) · --ember-soft #F9E9E1 · --amber #E0A11B (carbs) · --violet #7C6BD6 (fat/sleep)`
- Type: **Fraunces** (display, big numbers) + **Hanken Grotesk** (UI/body). Tabular numerals for all metrics.
- Feel: warm paper background, white cards, soft borders, rounded 16–26px, restrained shadows. Distinct from MERS's design system by intent.

## 14. Phased build plan (all tabs in scope; thin-first order)

- **Phase 0 — Foundation.** New repo + new Supabase project, Google OAuth, migration 001, token layer, signup flow (goal/height/sports/consent, BMI display with caveat). No features.
- **Phase 1 — Spine (v1).** Chat parse → food + weight (+ sleep) writes; read-only Today dashboard. **Ship and use daily ~2 weeks before continuing.** Success test: Dave stops opening Telegram/GPT/Sheets.
- **Phase 2 — Training engine.** Migration 002; AI generates initial program; session logging; Progress + History views; weekly proposal → approve loop.
- **Phase 3 — Apple Watch.** Capacitor iOS shell + HealthKit plugin → daily_metrics (+ cardio sessions); TestFlight to friends.
- **Phase 4 — Analytics & polish.** Trends tab (query-based: protein/calorie adherence, weight rate-of-change, PR timeline, volume by category, RPE trend, sleep vs performance, plan adherence), unit toggle UI, Resend weekly summary email, goal-driven dashboard reconfiguration.

## 15. Decision log (all resolved)

1. Separate Supabase project + repo from MERS — **YES**
2. Units — store kg/kcal; kg⇄lbs display toggle — **YES**
3. All tabs in scope; build order thin-first — **YES**
4. Name — **Xclr**
5. Coach persona — per-user jsonb + prompt-driven emotion/motivation — **YES**
6. Wishlist approved: weight (manual), sleep (manual), BMI at signup (computed, caveated), medical conditions (consent-gated), progression dashboard, multi-sport tied to changeable primary goal, result analytics — **YES**
7. Program authorship — **AI builds & adjusts** (not user-authored)
8. Weekly progression — **AI suggests; Dave approves each week** (never auto-applied)
9. Strava — **ruled out** (API terms prohibit AI-app use); Apple Watch/HealthKit instead
10. Distribution — web (Vercel) + iOS TestFlight via Capacitor

## 16. Open items / next deliverables

- **Doc 02 — Coach Persona & Prompt System** (next up; load-bearing since the AI authors the program and the coaching voice). Must specify: system prompt structure (profile + recent logs + program context), persona schema, weekly-review prompt logic, anti-fabrication + medical guardrails in prompt form, tone examples matching Dave's existing bot.
- Phase 0 kickoff prompt for Claude Code (references this doc; standard gates apply).
- Signup/onboarding mockup (the only unmocked flow: goal/sports/height/consent + BMI display).
- Later decisions: app icon/branding, TestFlight setup timing, weekly summary email design.

## 17. Reference artifacts

- `xclr-mock-v2.html` — approved interactive mock (5 tabs, weekly review loop, Dave's real exercises/numbers).
- Dave's workout sheet (screenshot) — source of truth for the plan/actual split, RPE columns, load formats, coach-note style.
- Dave's existing bot transcripts (screenshots) — source of truth for coach voice: warm, sassy, protein-focused, "don't chase the scale," celebrates trends over single readings.

---

*End of master spec. This document supersedes Doc 01 and Doc 01 v2.*
