# Xclr — Addendum D: v3 (approved Nov 26, 2026)

Augments the Master Spec and Doc 02. Where this conflicts with older text, this wins.

## 1. AI model plan and cost
| Job | Model | Notes |
|---|---|---|
| Reading a log message | claude-haiku-5-5 | only when the food library can't answer |
| Coach answer | claude-haiku-5-5 | only for questions (Ask mode, or a log that also asks) |
| Photo read | claude-haiku-5-5 | food / health paper / scale-watch |
| Program build | claude-sonnet-5-5 | ~monthly |
| Weekly review | claude-sonnet-5-5 | on demand; no overnight Batch (saves ~3¢/week, not worth the moving parts) |

Every AI call writes a row to `ai_usage` (tokens + estimated USD); Goals shows "AI usage this month". Target ≈ $1/user/month (was ≈ $30 on Opus 5 everywhere).

## 2. Logging
- Library-first: saved dishes log with no AI (quick-log chips on Today, Food and Coach; typed messages made only of saved dishes at their saved portion). A different stated portion keeps the AI estimate and stays `is_estimate`.
- Plain logs get a confirmation built in code (no coach call). Composer has a Log | Ask switch.
- Anti-fabrication is enforced in code as well as the prompt: foods without numbers / sets without load or reps → one question, nothing saved. An unreadable day → "Which day was that?", nothing saved.
- `food_logs.source` adds `'photo'`.

- Units: the kg/lbs setting covers body weight everywhere (cards, messages, coach replies). Lifting loads stay in kg with their load type (kg, kg / side, kg assist), as in Spec §6.

## 3. "Today"
The user's local calendar day (`profiles.timezone`, default Asia/Manila) — never UTC. All boundaries go through `lib/time.ts`.

## 4. Training weeks
- `programs.current_week`, `programs.week_started_on`. Train shows "Week N · done/planned · Next day".
- Weeks run **Monday–Sunday** (calendar). Starting a week mid-week makes a **short week**: only as many training days as there are days left before Sunday (Thursday → 4). Days already done stay; then main lifting days are kept, cardio next, recovery/light days drop first. Dropped days show "not this week".
- After Sunday the week is over: Today and Train ask **Repeat or Fresh** (never automatic).
- Default day = first planned training day not yet logged or skipped this week.
- **Skip a day** (Train → "Skip this day"): marks a planned day skipped for this week with an optional reason (≤300 chars), with Undo. Skipped days count as handled (the week can complete), show "skipped" on Train and Today, and are sent with their reasons to the weekly review, which treats them as context, never failure (no progression from skipped-only exercises; illness/pain → hold or ease off). Table `day_skips` (migration 006).
- Starting a new week always asks **Repeat week N** or **Fresh week N+1**. Unfinished days simply stay unlogged (history = skipped).
- Weekly review: every card needs an explicit Approve or Keep; the "current value" shown comes from the program, never the model. Saving decisions never starts a week by itself.

## 5. Update by chat (`pending_changes`)
- Today's food / weight / sleep save immediately with Undo; past-day food waits for a tap ("Add to Wed, Nov 25").
- Goal change → "Change goal?" card (estimated targets, editable via Change goal) → Approve. If the goal changed, Xclr offers to build a new program (approved in the builder; nothing auto-replaces).
- Health note → card → Save, only with health consent; otherwise a pointer to Profile.

## 6. Profile ("You") and Change goal
- `/profile` edits everything from onboarding plus weight unit and timezone; health notes (consent on/off, add/edit/resolve; turning consent off clears pending health items and asks whether to delete saved notes); Download my data (JSON).
- `/goals/change`: pick goal + goal weight, see What changes (deterministic estimate from current targets + latest weight, editable), save. History untouched; only targets from today.

## 7. Photos (`photo_reads`, bucket `xclr-photos`)
- Private bucket, per-user folder, 5 MB, JPEG/PNG/WebP; browser resizes to 1280px JPEG (strips location).
- Kept at most 48 h. Deleted: on next app open after expiry, by "Delete now", by a failed/unclear read (immediately), and by a daily 2 AM Manila sweep (Vercel Hobby allows one cron/day → worst case ~72 h if the app isn't opened; hourly on Pro).
- Read results are cleared when the photo is deleted. Only numbers the user logs are kept elsewhere.
- Health papers need consent; values are transcribed, never interpreted or diagnosed.

## 8. Design — "Glass · Sora"
Frosted cards on a soft paper backdrop with faint green/ember glows; ONE dark-green band per screen (first row of numbers) with a 3px ember edge; floating surfaces solid; ink primary buttons with a rationed accent edge; plain-word tabs with an ember dot; 7px-corner marks; Sora for big numbers and titles, Hanken Grotesk for UI. Tokens + component classes live in `app/globals.css` only.

## 9. Schema — migration 005_v3.sql
programs.current_week, programs.week_started_on · profiles.timezone · messages.meta (cards survive reload) · medical_conditions.source/updated_at · tables `ai_usage` (select+insert only), `pending_changes`, `photo_reads` (path must sit in the owner's folder; only result/deleted_at updatable) · storage bucket + per-folder policies. A stray 004 pasted earlier for the old week feature is not relied on.
