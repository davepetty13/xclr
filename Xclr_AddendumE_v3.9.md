# Xclr Addendum E — v3.9 (Nov 28, 2026)

Approved by Dave on Nov 28, 2026 from the Xclr v3 canvas mocks (ShareSheetV2, CardSessionWins/Muscle/Top3, TrainHome, EditDay, SwapExercise, AddActivity, HomeSetup, HealthSync, TodayWatch, NotifySettings, NotifyLock, NotifyInbox). Where this addendum and the Master Spec differ, this addendum wins.

## 1. Share card v2
- Title wraps (up to 3 lines) and shrinks to fit; it is never cut off. Sub line = "Week N · goal", not the program name.
- "Show" dropdown: Wins vs last time (default) · By muscle group · Top 3 lifts · Every exercise.
- "Show gains as" % or kg. "Compare to" Last time (most recent earlier session of the same program day) or Week 1 (first time that day was done). "Last time" wording replaces the mock's "Last week" because sessions are compared by day, not calendar week.
- Gains compare the same load type only; home sessions are not compared with gym sessions. No comparison = no gain shown. Lifts that went down are not listed. Drawn on the phone, $0.

## 2. Edit day (supersedes Spec §11 / §15.8 for the user's own edits)
- Dave's own edits save straight away, no AI and no proposal.
- "This week only" → `day_edits` (full replacement list for that day/week). "From now on" → edits `program_exercises` directly and writes a line to `program_edit_log`.
- Pending weekly-review items for a row that was swapped or removed are dropped, so an approval can never land on a different exercise.
- The weekly review sees both kinds of edit and must not propose undoing Dave's own change without saying why.
- Coach (AI) changes still only happen through proposals Dave approves.

## 3. At home today
- `at_home_days` (one row per date = home mode on). `profiles.home_equipment` holds the gear. Swaps come from a built-in map (`lib/home-swaps.ts`), $0. The gym plan is untouched.
- Sessions logged in home mode are flagged `workout_sessions.at_home`; home loads are never treated as regressions in reviews, charts or share cards.

## 4. Add activity
- Manual extra activity (badminton, run, home workout…) saved as `workout_sessions` type `activity` with `duration_min`, `effort`, `kcal` (only if typed — never estimated). Never marks a program day done.

## 5. Watch & phone sync (supersedes Spec §9 `daily_metrics` / healthkit design)
- Free route: iPhone Shortcuts posts Apple Health data to `POST /api/health/sync` with a private link (Bearer token, stored only as a SHA-256 hash). Android: any app that can send Health Connect data to a web link. No paid app, no Apple developer fee.
- Several syncs a day are fine (upsert by date; workouts deduplicated).
- Tables: `health_daily` (replaces the spec's `daily_metrics`: steps, active_kcal, resting_hr, sleep_minutes, weight_kg, source), `health_workouts` (Watch workouts — kept separate from `workout_sessions`), `health_sync_tokens`. `weights.source` marks synced weigh-ins; a synced weight never overwrites a manual one.
- Today: "Burned" shows synced active calories; calories left stays target − eaten (burn is shown, not eaten back). Activity card shows steps, burn, sleep, resting HR and the latest Watch workout; tiles with no data are hidden.
- Weekly review gets averages and Watch workouts only when "Share with my coach" is on. Resting HR is never sent to the AI.

## 6. Notifications
- Web Push to the Home Screen app (iOS 16.4+) plus an in-app bell inbox. VAPID keys in Vercel env only.
- Scheduler: Supabase pg_cron + pg_net calls `/api/cron/notify` every 15 minutes (Vercel Hobby crons are daily only). No AI.
- Kinds: breakfast / lunch / dinner not logged; today's session; no workout logged yet (8 PM, training days only); calories off track (under half the target by 8 PM, or over target, once a day); weekly review ready; nudges (weigh-in, protein short, photo deleting soon).
- Each fires once a day and only if still true. Quiet hours stop the push but the bell still gets it. Wording is plain and never diagnoses.
- Tables: `push_subscriptions` (known push hosts only), `notification_prefs`, `notifications`.
