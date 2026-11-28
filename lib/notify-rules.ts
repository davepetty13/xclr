import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDayPlan, getWeekStatus } from "@/lib/programs";
import { addDays, DEFAULT_TZ, localDayStartISO, todayLocal } from "@/lib/time";
import { MEAL_COUNTS, inQuietHours, readPrefs, timeLabel, toMinutes, type NotifyPrefs } from "@/lib/notify-prefs";
import { pushToUser } from "@/lib/push";

// The reminder job (app/api/cron/notify, every 15 min). For each user with
// settings, work out what is due right now in THEIR timezone and still true
// (lunch really isn't logged, the session really isn't done), write it to the
// inbox once (dedupe_key), then push it. No AI calls anywhere in here.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

// A reminder fires in the first WINDOW minutes after its time. The job runs
// every 15 min; 30 covers one late or missed run. dedupe_key stops doubles.
const WINDOW = 30;

export type Candidate = {
  kind: string;
  title: string;
  body: string;
  url: string;
  action?: { type: "log_library"; library_id: string; meal: string; label: string } | { type: "link"; href: string; label: string };
  dedupe_key: string;
};

function localParts(tz: string, at: Date): { minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: get("weekday").slice(0, 3).toLowerCase(),
  };
}

function due(time: string, now: number): boolean {
  const d = now - toMinutes(time);
  return d >= 0 && d < WINDOW;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const MEAL_SLOTS = [
  { key: "breakfast", on: "breakfast_on", time: "breakfast_time", counts: MEAL_COUNTS.breakfast },
  { key: "lunch", on: "lunch_on", time: "lunch_time", counts: MEAL_COUNTS.lunch },
  { key: "dinner", on: "dinner_on", time: "dinner_time", counts: MEAL_COUNTS.dinner },
] as const;

type Ctx = {
  admin: Supa;
  userId: string;
  tz: string;
  today: string;
  now: number; // local minute of day
  weekday: string;
  prefs: NotifyPrefs;
};

// Lazy, cached per-user reads: only what a due reminder needs.
function loaders(c: Ctx) {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T,>(k: string, f: () => Promise<T>): Promise<T> => {
    if (!memo.has(k)) memo.set(k, f());
    return memo.get(k) as Promise<T>;
  };
  const dayStart = localDayStartISO(c.today, c.tz);
  return {
    profile: () =>
      once("profile", async () => {
        const { data } = await c.admin
          .from("profiles")
          .select("daily_calorie_target, daily_protein_target, preferred_days, daily_step_target")
          .eq("id", c.userId)
          .maybeSingle();
        return data as Record<string, unknown> | null;
      }),
    foods: () =>
      once("foods", async () => {
        const { data } = await c.admin
          .from("food_logs")
          .select("meal, kcal, protein_g")
          .eq("user_id", c.userId)
          .gte("logged_at", dayStart);
        return (data ?? []) as { meal: string | null; kcal: number | null; protein_g: number | null }[];
      }),
    week: () =>
      once("week", () =>
        getWeekStatus(c.admin as unknown as Parameters<typeof getWeekStatus>[0], c.userId, c.tz)
      ),
    sessionsToday: () =>
      once("sessionsToday", async () => {
        const { count } = await c.admin
          .from("workout_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", c.userId)
          .gte("performed_at", dayStart);
        return count ?? 0;
      }),
    watchToday: () =>
      once("watchToday", async () => {
        const { count } = await c.admin
          .from("health_workouts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", c.userId)
          .gte("started_at", dayStart);
        return count ?? 0;
      }),
  };
}

type L = ReturnType<typeof loaders>;

// The user's most-logged library dish for a meal in the last 30 days.
async function usualDish(c: Ctx, meal: string) {
  const { data: logs } = await c.admin
    .from("food_logs")
    .select("name")
    .eq("user_id", c.userId)
    .eq("meal", meal)
    .gte("logged_at", localDayStartISO(addDays(c.today, -30), c.tz))
    .limit(200);
  const counts = new Map<string, number>();
  for (const r of logs ?? []) {
    const k = String(r.name ?? "").trim().toLowerCase();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 2) return null;
  const { data: lib } = await c.admin
    .from("food_library")
    .select("id, name, serving, kcal")
    .eq("user_id", c.userId)
    .limit(200);
  const row = (lib ?? []).find((r) => String(r.name).trim().toLowerCase() === top[0]);
  if (!row) return null;
  return {
    id: row.id as string,
    label: `${row.name as string}${row.serving ? ` ${row.serving as string}` : ""}`,
    kcal: row.kcal != null ? Number(row.kcal) : null,
  };
}

// Is today a day to train? Never if something was already logged today.
//  - preferred_days set → only on those weekdays.
//  - not set → only when the days still to do (planned, not done, not
//    skipped) are at least the days left this week, today included — i.e.
//    you'd have to train today to finish the week.
// A "Skip day" tapped today silences today only if the day skipped is the
// one that would have been next today.
async function plannedDay(c: Ctx, l: L) {
  const status = await l.week();
  if (!status || status.weekComplete || !status.nextDay) return null;
  if ((await l.sessionsToday()) > 0) return null; // already trained today

  const pref = (await l.profile())?.preferred_days;
  const days = Array.isArray(pref) ? (pref as string[]) : [];
  if (days.length) {
    if (!days.includes(c.weekday)) return null; // rest day
  } else {
    const planned = status.days.filter((d) => d.inWeek);
    const toDo = planned.filter((d) => !d.done && !d.skipped).length;
    const daysLeft =
      Math.round((Date.parse(`${status.weekEndsOn}T00:00:00Z`) - Date.parse(`${c.today}T00:00:00Z`)) / 86_400_000) + 1;
    if (toDo < daysLeft) return null; // still time later in the week
  }

  const { data: skipsToday } = await c.admin
    .from("day_skips")
    .select("program_day_id")
    .eq("user_id", c.userId)
    .eq("program_id", status.program.id)
    .eq("week_started_on", status.weekStartedOn)
    .gte("created_at", localDayStartISO(c.today, c.tz));
  const skippedToday = new Set((skipsToday ?? []).map((k) => k.program_day_id as string));
  if (skippedToday.size) {
    const wouldBeNext = status.days.find((d) => d.inWeek && !d.done && (!d.skipped || skippedToday.has(d.id)));
    if (wouldBeNext && skippedToday.has(wouldBeNext.id)) return null; // today's session was skipped
  }
  const d = status.nextDay;
  return { id: d.id, name: `Day ${d.day_index}${d.label ? ` · ${d.label}` : ""}`, programId: status.program.id, weekStartedOn: status.weekStartedOn };
}

async function mealReminders(c: Ctx, l: L, out: Candidate[]) {
  for (const s of MEAL_SLOTS) {
    if (!c.prefs[s.on] || !due(c.prefs[s.time], c.now)) continue;
    const foods = await l.foods();
    if (foods.some((f) => f.meal && (s.counts as readonly string[]).includes(f.meal))) continue;
    const dish = await usualDish(c, s.key);
    out.push({
      kind: `meal_${s.key}`,
      title: `${s.key[0].toUpperCase()}${s.key.slice(1)} isn't logged`,
      body: dish
        ? `Your usual: ${dish.label}${dish.kcal != null ? ` · ${fmt(dish.kcal)} kcal` : ""}.`
        : `Tap to add what you had for ${s.key}.`,
      url: "/food",
      action: dish ? { type: "log_library", library_id: dish.id, meal: s.key, label: `Log usual ${s.key}` } : undefined,
      dedupe_key: `meal_${s.key}:${c.today}`,
    });
  }
}

async function trainingReminders(c: Ctx, l: L, out: Candidate[]) {
  if (c.prefs.session_on && due(c.prefs.session_time, c.now)) {
    const day = await plannedDay(c, l);
    if (day) {
      // This week's list ("This week only" edits win), and At home today.
      const [plan, { data: home }] = await Promise.all([
        getDayPlan(c.admin as unknown as Parameters<typeof getDayPlan>[0], c.userId, day.programId, day.id, day.weekStartedOn),
        c.admin.from("at_home_days").select("local_date").eq("user_id", c.userId).eq("local_date", c.today).maybeSingle(),
      ]);
      const count = plan.items.length;
      out.push({
        kind: "session",
        title: `${day.name} today`,
        body: count
          ? `${count} exercise${count === 1 ? "" : "s"} planned${home ? ", home versions" : ""}.`
          : "Your session is ready in Train.",
        url: "/workout",
        dedupe_key: `session:${c.today}`,
      });
    }
  }
  if (c.prefs.workout_reminder_on && due(c.prefs.workout_reminder_time, c.now)) {
    const day = await plannedDay(c, l);
    if (day && (await l.watchToday()) === 0) {
      out.push({
        kind: "workout_missing",
        title: "No workout logged yet",
        body: `${day.name} isn't logged yet. Still time for a short one, or tap Skip day.`,
        url: "/workout",
        dedupe_key: `workout_missing:${c.today}`,
      });
    }
  }
}

async function calorieReminders(c: Ctx, l: L, out: Candidate[]) {
  if (!c.prefs.calories_on) return;
  const target = Number((await l.profile())?.daily_calorie_target) || 0;
  if (target <= 0) return;
  const eaten = (await l.foods()).reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  // Too high: any check after noon, at most once a day.
  if (c.now >= 12 * 60 && eaten > target * 1.15) {
    out.push({
      kind: "calories_high",
      title: "Over today's target",
      body: `You're about ${fmt(eaten - target)} kcal over today's target. Tomorrow evens it out.`,
      url: "/food",
      dedupe_key: `calories_high:${c.today}`,
    });
  }
  // Too low: only at the chosen time, and only if something was logged (an
  // empty day is the meal reminders' job, not this one).
  if (due(c.prefs.calories_time, c.now) && eaten > 0) {
    const low = eaten < target * 0.5 || (target >= 1200 && eaten < 1200);
    if (low) {
      out.push({
        kind: "calories_low",
        title: "Eaten less than usual today",
        body: `You've eaten ${fmt(eaten)} of ${fmt(target)} kcal so far. A proper dinner keeps you on track.`,
        url: "/food",
        dedupe_key: `calories_low:${c.today}`,
      });
    }
  }
}

async function reviewReminder(c: Ctx, out: Candidate[]) {
  if (!c.prefs.review_on) return;
  const nowMs = Date.now();
  const { data } = await c.admin
    .from("progression_proposals")
    .select("id, created_at")
    .eq("user_id", c.userId)
    .eq("status", "pending")
    .lte("created_at", new Date(nowMs - 30 * 60_000).toISOString()) // not the one you're looking at
    .gte("created_at", new Date(nowMs - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  const p = data?.[0];
  if (!p) return;
  const { count } = await c.admin
    .from("proposal_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", c.userId)
    .eq("proposal_id", p.id);
  out.push({
    kind: "review",
    title: "Weekly review ready",
    body: count
      ? `${count} change${count === 1 ? "" : "s"} waiting for your OK.`
      : "Your coach looked at the week. Nothing changes until you say so.",
    url: "/workout/review",
    action: { type: "link", href: "/workout/review", label: "Open review" },
    dedupe_key: `review:${p.id as string}`,
  });
}

async function nudges(c: Ctx, l: L, out: Candidate[]) {
  if (!c.prefs.nudges_on) return;

  // Weigh-in day: every 7 days after the last weigh-in, at 8 AM.
  if (due("08:00", c.now)) {
    const { data: w } = await c.admin
      .from("weights")
      .select("measured_on")
      .eq("user_id", c.userId)
      .order("measured_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (w?.measured_on) {
      const days = Math.round(
        (Date.parse(`${c.today}T00:00:00Z`) - Date.parse(`${w.measured_on as string}T00:00:00Z`)) / 86_400_000
      );
      if (days >= 7 && days % 7 === 0) {
        out.push({
          kind: "weigh_in",
          title: "Weigh-in day",
          body: `It's been ${days} days. Step on the scale before breakfast and tell your coach.`,
          url: "/chat",
          dedupe_key: `weigh_in:${c.today}`,
        });
      }
    }
  }

  // Protein short at 8 PM by more than 30 g.
  if (due("20:00", c.now)) {
    const target = Number((await l.profile())?.daily_protein_target) || 0;
    const foods = await l.foods();
    const protein = foods.reduce((s, f) => s + (Number(f.protein_g) || 0), 0);
    if (target > 0 && foods.length > 0 && target - protein > 30) {
      out.push({
        kind: "protein",
        title: "Protein still short",
        body: `${fmt(target - protein)} g to go. A protein shake or a few eggs would close some of it.`,
        url: "/food",
        dedupe_key: `protein:${c.today}`,
      });
    }
  }

  // A photo is deleted within 6 hours.
  const nowMs = Date.now();
  const { data: photos } = await c.admin
    .from("photo_reads")
    .select("id, expires_at")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .gt("expires_at", new Date(nowMs).toISOString())
    .lte("expires_at", new Date(nowMs + 6 * 3_600_000).toISOString())
    .limit(5);
  for (const p of photos ?? []) {
    const at = new Date(p.expires_at as string);
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: c.tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
    const hours = Math.max(1, Math.round((at.getTime() - nowMs) / 3_600_000));
    out.push({
      kind: "photo_expiring",
      title: `Photo deletes in ${hours} h`,
      body: `A photo you read is removed at ${timeLabel(local)}. Log anything you need from it first.`,
      url: "/photo",
      dedupe_key: `photo:${p.id as string}`,
    });
  }
}

// Watch & activity — only for users with Watch & phone sync set up. Data comes
// from health_daily (what the sync saved today); nothing is ever guessed.
async function watchReminders(c: Ctx, l: L, out: Candidate[]) {
  const p = c.prefs;
  const wantSteps = p.steps_on && due(p.steps_time, c.now);
  const wantSleep = p.sleep_on && c.now >= 5 * 60 && c.now < 12 * 60;
  const wantSync = p.sync_check_on && due(p.sync_check_time, c.now);
  if (!wantSteps && !wantSleep && !wantSync) return;

  const { data: tok } = await c.admin.from("health_sync_tokens").select("user_id").eq("user_id", c.userId).maybeSingle();
  if (!tok) return; // sync not set up
  const { data: day } = await c.admin
    .from("health_daily")
    .select("steps, sleep_minutes")
    .eq("user_id", c.userId)
    .eq("local_date", c.today)
    .maybeSingle();

  if (wantSync && !day) {
    out.push({
      kind: "sync_missing",
      title: "Watch hasn't synced today",
      body: "Xclr didn't get today's Watch data. Unlock your phone and tap Xclr Sync.",
      url: "/profile/health-sync",
      dedupe_key: `sync_missing:${c.today}`,
    });
  }

  if (wantSteps && day && typeof day.steps === "number") {
    const target = Number((await l.profile())?.daily_step_target) || 8000;
    if (day.steps < target / 2) {
      out.push({
        kind: "steps_low",
        title: "Steps are low today",
        body: `${fmt(day.steps)} of ${fmt(target)} steps so far. A 20-minute walk after dinner closes most of it.`,
        url: "/",
        dedupe_key: `steps_low:${c.today}`,
      });
    }
  }

  if (wantSleep && day && typeof day.sleep_minutes === "number" && day.sleep_minutes > 0 && day.sleep_minutes < 360) {
    const h = Math.floor(day.sleep_minutes / 60);
    const m = day.sleep_minutes % 60;
    const status = await l.week();
    const trainsToday = status?.nextDay && !status.weekComplete && (await l.sessionsToday()) === 0;
    const name = trainsToday && status?.nextDay ? `Day ${status.nextDay.day_index}${status.nextDay.label ? ` · ${status.nextDay.label}` : ""}` : null;
    out.push({
      kind: "sleep_short",
      title: "Short night",
      body: name
        ? `You slept ${h}h ${m}m last night. Keep today's ${name} on the lighter side — fewer sets is fine.`
        : `You slept ${h}h ${m}m last night. Go easy on hard training today.`,
      url: "/workout",
      dedupe_key: `sleep_short:${c.today}`,
    });
  }
}

export async function evaluateUser(admin: Supa, userId: string, prefsRow: Record<string, unknown>, tzRaw: string | null) {
  const tz = tzRaw || DEFAULT_TZ;
  const at = new Date();
  let parts: { minutes: number; weekday: string };
  try {
    parts = localParts(tz, at);
  } catch {
    parts = localParts(DEFAULT_TZ, at);
  }
  const prefs = readPrefs(prefsRow);
  const c: Ctx = { admin, userId, tz, today: todayLocal(tz), now: parts.minutes, weekday: parts.weekday, prefs };
  // Quiet hours only stop the phone buzzing: the bell still gets every reminder.
  const quiet = inQuietHours(prefs, c.now);

  const l = loaders(c);
  const out: Candidate[] = [];
  await mealReminders(c, l, out);
  await trainingReminders(c, l, out);
  await calorieReminders(c, l, out);
  await reviewReminder(c, out);
  await nudges(c, l, out);
  await watchReminders(c, l, out);
  if (!out.length) return { created: 0, pushed: 0 };

  // Insert once per dedupe_key; only rows that are new come back.
  const { data: inserted, error } = await admin
    .from("notifications")
    .upsert(
      out.map((n) => ({
        user_id: userId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        url: n.url,
        action: n.action ?? null,
        dedupe_key: n.dedupe_key,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("id, title, body, url, kind");
  if (error) throw new Error(`insert failed: ${error.code ?? "?"}`);

  let pushed = 0;
  if (prefs.enabled && !quiet) {
    for (const n of inserted ?? []) {
      const sent = await pushToUser(admin, userId, {
        title: n.title as string,
        body: n.body as string | null,
        url: n.url as string | null,
        tag: n.kind as string,
      });
      if (sent > 0) {
        pushed++;
        await admin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id).eq("user_id", userId);
      }
    }
  }
  return { created: inserted?.length ?? 0, pushed };
}

export async function runNotify(admin: Supa) {
  const { data: rows, error } = await admin.from("notification_prefs").select("*").limit(1000);
  if (error) throw new Error(`prefs read failed: ${error.code ?? "?"}`);
  const ids = (rows ?? []).map((r) => r.user_id as string);
  const tzById = new Map<string, string | null>();
  if (ids.length) {
    const { data: profs } = await admin.from("profiles").select("id, timezone").in("id", ids);
    for (const p of profs ?? []) tzById.set(p.id as string, (p.timezone as string | null) ?? null);
  }
  let users = 0;
  let created = 0;
  let pushed = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    try {
      const res = await evaluateUser(admin, r.user_id as string, r, tzById.get(r.user_id as string) ?? null);
      users++;
      created += res.created;
      pushed += res.pushed;
    } catch (err) {
      failed++;
      console.error(`[cron:notify] user failed: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return { users, created, pushed, failed };
}
