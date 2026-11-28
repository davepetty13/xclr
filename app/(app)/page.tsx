import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { getDayPlan, getWeekStatus } from "@/lib/programs";
import { GOAL_LABEL, getUserTz, isGoal } from "@/lib/goal-change";
import { addDays, localDayStartISO, todayLocal } from "@/lib/time";
import { WeightSparkline } from "@/components/app/weight-sparkline";
import { QuickLog, type QuickLogItem } from "@/components/app/quick-log";
import { MEALS } from "@/lib/parse-schema";
import { getCurrentUser } from "@/lib/session";
import { NotifyBell } from "@/components/app/notify-bell";
import { loadInbox } from "@/lib/inbox";
import { fmtSleep, toHealthDay } from "@/lib/health";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// "Asia/Manila" → "Manila"; anything unparseable falls back to the tz name.
function cityFromTz(tz: string): string {
  const last = tz.split("/").pop();
  return last ? last.replace(/_/g, " ") : tz;
}

function localHour(tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(
      new Date()
    );
    return Number(h) || 0;
  } catch {
    return new Date().getHours();
  }
}

export default async function TodayPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;
  const tz = await getUserTz(supabase, user.id);
  const today = todayLocal(tz);

  const [
    { data: profile },
    status,
    { data: todayFoods, error: foodsError },
    { data: weightRows, error: weightError },
    { data: libRows },
    { data: healthRow },
    { data: watchRows },
    inbox,
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, primary_goal, daily_calorie_target, daily_protein_target, daily_step_target, weight_unit")
        .eq("id", user.id)
        .single(),
      getWeekStatus(supabase, user.id, tz),
      supabase
        .from("food_logs")
        .select("id, name, serving, meal, kcal, protein_g")
        .eq("user_id", user.id)
        .gte("logged_at", localDayStartISO(today, tz))
        .order("logged_at", { ascending: true }),
      supabase
        .from("weights")
        .select("measured_on, kg, source")
        .eq("user_id", user.id)
        .order("measured_on", { ascending: false })
        .limit(14),
      supabase
        .from("food_library")
        .select("id, name, serving, kcal")
        .eq("user_id", user.id)
        .order("times_logged", { ascending: false })
        .limit(3),
      // Apple Health / Health Connect: today's totals + today's Watch workouts.
      supabase
        .from("health_daily")
        .select("local_date, steps, active_kcal, resting_hr, sleep_minutes, weight_kg, updated_at, source")
        .eq("user_id", user.id)
        .eq("local_date", today)
        .maybeSingle(),
      supabase
        .from("health_workouts")
        .select("kind, minutes, kcal, avg_hr")
        .eq("user_id", user.id)
        .gte("started_at", localDayStartISO(today, tz))
        .order("started_at", { ascending: false })
        .limit(1),
      loadInbox(supabase, user.id, tz, today),
      // Every user gets bell reminders: make sure a settings row exists (push
      // stays off until they allow it). Never overwrites saved settings.
      supabase
        .from("notification_prefs")
        .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
        .then(() => null),
    ]);

  const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
  const showW = (kg: number) => (unit === "lbs" ? kgToLbs(kg) : kg).toFixed(2);

  const calTarget = Number(profile?.daily_calorie_target) || 2200;
  const proTarget = Number(profile?.daily_protein_target) || 150;
  const goalLabel = isGoal(profile?.primary_goal) ? GOAL_LABEL[profile.primary_goal] : null;

  const foods = todayFoods ?? [];
  const kcalEaten = foods.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const proteinNow = foods.reduce((s, f) => s + (Number(f.protein_g) || 0), 0);
  const caloriesLeft = calTarget - kcalEaten;
  const eatenPct = Math.min(100, Math.max(0, Math.round((kcalEaten / calTarget) * 100)));

  // Weight tile
  const weights = (weightRows ?? []).map((w) => Number(w.kg)).filter((n) => Number.isFinite(n));
  const currentWeight = weights[0] ?? null;
  const fromScale = (weightRows ?? [])[0]?.source === "apple_health";
  const peakWeight = weights.length ? Math.max(...weights) : null;
  const deltaFromPeak =
    currentWeight != null && peakWeight != null ? currentWeight - peakWeight : null;
  const sparkPoints = [...weights].reverse();

  // Session for today + this week's squares
  const next = status?.nextDay ?? null;
  // Avg sleep over this local week (program week if there is one, else last 7
  // days). Fetched together with today's exercise count.
  const sleepFrom = status?.weekStartedOn ?? addDays(today, -6);
  // Exercise count = this week's list for the day ("This week only" edits
  // win over the plan); "At home today" is noted beside it.
  const [exerciseCount, atHomeToday, { data: sleepRows }] = await Promise.all([
    next && status
      ? getDayPlan(supabase, user.id, status.program.id, next.id, status.weekStartedOn).then((p) => p.items.length)
      : Promise.resolve(0),
    next
      ? supabase
          .from("at_home_days")
          .select("local_date")
          .eq("user_id", user.id)
          .eq("local_date", today)
          .maybeSingle()
          .then((r) => !!r.data)
      : Promise.resolve(false),
    supabase
      .from("sleep_logs")
      .select("duration_min")
      .eq("user_id", user.id)
      .gte("slept_on", sleepFrom)
      .lte("slept_on", today),
  ]);
  let sleepVals = (sleepRows ?? [])
    .map((s) => Number(s.duration_min))
    .filter((n) => Number.isFinite(n) && n > 0);
  // No sleep logged by hand → use what the Watch saved, if anything.
  if (!sleepVals.length) {
    const { data: hs } = await supabase
      .from("health_daily")
      .select("sleep_minutes")
      .eq("user_id", user.id)
      .gte("local_date", sleepFrom)
      .lte("local_date", today);
    sleepVals = (hs ?? []).map((r) => Number(r.sleep_minutes)).filter((n) => Number.isFinite(n) && n > 0);
  }
  const avgSleepMin = sleepVals.length
    ? Math.round(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length)
    : null;

  // Watch / phone data for today. Only real numbers: each tile hides without data.
  const health = healthRow ? toHealthDay(healthRow as Record<string, unknown>) : null;
  const burned = health?.active_kcal ?? null;
  const stepTarget = Number(profile?.daily_step_target) || 8000;
  const watch = (watchRows ?? [])[0] as
    | { kind: string; minutes: number | null; kcal: number | null; avg_hr: number | null }
    | undefined;
  const hasActivity =
    !!watch ||
    (health != null &&
      (health.steps != null || health.active_kcal != null || health.sleep_minutes != null || health.resting_hr != null));
  const syncedAt = health?.updated_at
    ? new Date(health.updated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
    : null;
  const healthSource = (healthRow as { source?: string } | null)?.source;
  const sourceLabel =
    healthSource === "apple_health" ? "Apple Watch" : healthSource === "health_connect" ? "Health Connect" : "Synced";
  // "Apple Watch · synced 9:30 AM" (or "Synced 9:30 AM" when the app is unknown).
  const syncLine = syncedAt ? (sourceLabel === "Synced" ? `Synced ${syncedAt}` : `${sourceLabel} · synced ${syncedAt}`) : null;
  const stepPct = health?.steps != null ? Math.min(1, health.steps / stepTarget) : 0;
  const RING = 2 * Math.PI * 31;

  const quickItems: QuickLogItem[] = (libRows ?? []).map((r) => ({
    id: r.id as string,
    label: `${r.name as string}${r.serving ? ` ${r.serving as string}` : ""}`,
    kcal: r.kcal != null ? Number(r.kcal) : null,
  }));

  const firstName = (profile?.display_name ?? "").split(" ")[0] || "there";
  const hour = localHour(tz);
  const greeting = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const dateLine = `${new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: tz,
  })} · resets 12 AM ${cityFromTz(tz)}`;

  // Group today's foods by meal for the list.
  const grouped = MEALS.map((m) => ({
    meal: m as string,
    items: foods.filter((f) => f.meal === m),
  })).filter((g) => g.items.length > 0);
  const ungrouped = foods.filter((f) => !f.meal || !MEALS.includes(f.meal as (typeof MEALS)[number]));
  const groups = [...grouped, ...(ungrouped.length ? [{ meal: "other", items: ungrouped }] : [])];

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-5">
      <header className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{dateLine}</p>
          <h1 className="mt-0.5 font-display text-[26px] font-bold tracking-[-0.01em] text-ink">
            {greeting}, {firstName}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? (
            <span className="mark mark-neutral">
              Week {status.week}
              {next ? ` · Day ${next.day_index}` : ""}
            </span>
          ) : null}
          <NotifyBell items={inbox} />
        </div>
      </header>

      {/* The one top band: calories left today */}
      <section aria-label="Calories today" className="band">
        <div className="band-edge px-[18px] pb-3.5 pt-[18px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-band-label">
              {caloriesLeft >= 0 ? "Calories left" : "Over target"}
            </span>
            {goalLabel ? (
              <span className="text-[11px] font-semibold text-band-secondary">Goal · {goalLabel}</span>
            ) : null}
          </div>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="tnum font-display text-[58px] font-bold leading-none tracking-[-0.02em]">
              {fmt(Math.abs(caloriesLeft))}
            </span>
            <span className="text-sm font-semibold text-band-secondary">kcal</span>
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-band-track"
            role="progressbar"
            aria-label="Calories eaten of target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={eatenPct}
          >
            <div className="h-full rounded-full bg-green-on-dark" style={{ width: `${eatenPct}%` }} />
          </div>
        </div>
        {/* Burned shows only when the Watch sent active calories today — never a
            made-up number. Calories left stays target − eaten (burn isn't eaten back). */}
        <dl className="grid grid-cols-3 border-t border-band-hairline">
          <div className="px-[18px] py-2.5">
            <dt className="text-[11px] text-band-label">Eaten</dt>
            <dd className="tnum font-display text-[19px] font-bold">{fmt(kcalEaten)}</dd>
          </div>
          {burned != null ? (
            <div className="border-l border-band-hairline px-3.5 py-2.5">
              <dt className="flex items-center gap-1 text-[11px] text-band-label">
                Burned
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} role="img" aria-label="from your Watch">
                  <rect x="6" y="5" width="12" height="14" rx="3" />
                  <path d="M9 5V2h6v3M9 19v3h6v-3" />
                </svg>
              </dt>
              <dd className="tnum font-display text-[19px] font-bold text-ember-on-dark">{fmt(burned)}</dd>
            </div>
          ) : null}
          <div className="border-l border-band-hairline px-3.5 py-2.5">
            <dt className="text-[11px] text-band-label">Protein</dt>
            <dd className="tnum font-display text-[19px] font-bold">
              {fmt(proteinNow)}
              <span className="text-xs text-band-secondary"> / {proTarget} g</span>
            </dd>
          </div>
          {burned == null ? (
            <div className="border-l border-band-hairline px-3.5 py-2.5">
              <dt className="text-[11px] text-band-label">Target</dt>
              <dd className="tnum font-display text-[19px] font-bold">{fmt(calTarget)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {hasActivity ? (
        <section aria-labelledby="activity-h" className="glass flex flex-col gap-2.5 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="activity-h" className="text-sm font-bold text-ink">
              Activity
            </h2>
            {syncLine ? <span className="text-[11px] text-muted">{syncLine}</span> : null}
          </div>
          {health ? (
            <div className={`grid items-center gap-3.5 ${health.steps != null ? "grid-cols-[auto_1fr]" : "grid-cols-1"}`}>
              {health.steps != null ? (
                <svg width="74" height="74" viewBox="0 0 74 74" role="img" aria-label={`Steps ${fmt(health.steps)} of ${fmt(stepTarget)}`}>
                  <circle cx="37" cy="37" r="31" fill="none" stroke="var(--hairline)" strokeWidth="8" />
                  <circle
                    cx="37"
                    cy="37"
                    r="31"
                    fill="none"
                    stroke="var(--green)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(stepPct * RING).toFixed(1)} ${RING.toFixed(1)}`}
                    transform="rotate(-90 37 37)"
                  />
                </svg>
              ) : null}
              <dl className="grid grid-cols-2 gap-x-2.5 gap-y-2">
                {health.steps != null ? (
                  <div>
                    <dt className="text-[11px] text-muted">Steps</dt>
                    <dd className="tnum font-display text-[17px] font-bold text-ink">
                      {fmt(health.steps)}
                      <span className={`text-[11px] ${health.steps >= stepTarget ? "text-green" : "text-muted"}`}>
                        {health.steps >= stepTarget ? " ✓ " : " / "}
                        {stepTarget % 1000 === 0 ? `${stepTarget / 1000}k` : fmt(stepTarget)}
                      </span>
                    </dd>
                  </div>
                ) : null}
                {health.active_kcal != null ? (
                  <div>
                    <dt className="text-[11px] text-muted">Active burn</dt>
                    <dd className="tnum font-display text-[17px] font-bold text-ink">
                      {fmt(health.active_kcal)}
                      <span className="text-[11px] text-muted"> kcal</span>
                    </dd>
                  </div>
                ) : null}
                {health.sleep_minutes != null ? (
                  <div>
                    <dt className="text-[11px] text-muted">Sleep</dt>
                    <dd className="tnum font-display text-[17px] font-bold text-ink">{fmtSleep(health.sleep_minutes)}</dd>
                  </div>
                ) : null}
                {health.resting_hr != null ? (
                  <div>
                    <dt className="text-[11px] text-muted">Resting HR</dt>
                    <dd className="tnum font-display text-[17px] font-bold text-ink">
                      {health.resting_hr}
                      <span className="text-[11px] text-muted"> bpm</span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
          {watch ? (
            <Link
              href="/workout/history"
              className={`flex min-h-11 items-center gap-2.5 text-ink ${health ? "border-t border-hairline pt-2.5" : ""}`}
            >
              <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control bg-green-soft text-green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="6" y="5" width="12" height="14" rx="3" />
                  <path d="M9 5V2h6v3M9 19v3h6v-3" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {watch.kind}
                  {watch.minutes != null ? ` · ${watch.minutes} min` : ""}
                </span>
                <span className="tnum block text-[11px] text-muted">
                  From your Watch
                  {watch.kcal != null ? ` · ${fmt(Number(watch.kcal))} kcal` : ""}
                  {watch.avg_hr != null ? ` · avg HR ${watch.avg_hr}` : ""}
                </span>
              </span>
              <span className="mark mark-green shrink-0">In Train</span>
            </Link>
          ) : null}
        </section>
      ) : null}

      {status && next ? (
        <Link href="/workout" className="glass flex items-center justify-between gap-3 px-4 py-3.5 text-ink">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">Today&apos;s session</p>
            <p className="mt-0.5 font-display text-[19px] font-bold">
              Day {next.day_index}
              {next.label ? ` · ${next.label}` : ""}
            </p>
            {exerciseCount > 0 ? (
              <p className="mt-0.5 text-xs text-muted">
                {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"}
                {atHomeToday ? " · at home" : ""}
              </p>
            ) : null}
          </div>
          <span className="btn-primary btn-primary-green min-h-[38px] shrink-0 text-[13px]">Start</span>
        </Link>
      ) : status && status.weekComplete ? (
        <Link href="/workout" className="glass flex items-center justify-between gap-3 px-4 py-3.5 text-ink">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">Week {status.week}</p>
            <p className="mt-0.5 font-display text-[19px] font-bold">
              {status.weekEnded ? "New week — repeat or fresh?" : "All sessions done"}
            </p>
          </div>
          <span className="btn-primary btn-primary-green min-h-[38px] shrink-0 text-[13px]">
            {status.weekEnded ? "Choose" : "Open"}
          </span>
        </Link>
      ) : null}

      <Link
        href="/workout?add=activity"
        className="flex min-h-[44px] items-center justify-center rounded-control border border-dashed border-muted text-[13px] font-bold text-ink"
      >
        + Add activity
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <section aria-labelledby="week-h" className="glass flex flex-col gap-2 px-4 py-3.5">
          <h2 id="week-h" className="text-xs font-semibold text-muted">
            This week
          </h2>
          {status ? (
            <>
              <p className="tnum font-display text-[26px] font-bold leading-none text-ink">
                {status.doneCount}
                <span className="text-[15px] text-muted"> / {status.plannedCount}</span>
              </p>
              <ul
                className="flex gap-[5px]"
                aria-label={`${status.doneCount} of ${status.plannedCount} sessions done`}
              >
                {status.days.filter((d) => d.inWeek).map((d) => {
                  const isNext = next?.id === d.id;
                  const cls = d.done
                    ? "bg-green"
                    : d.skipped
                      ? "bg-segment shadow-[inset_0_0_0_2px_var(--faint)]"
                      : isNext
                      ? "shadow-[inset_0_0_0_2px_var(--ember)]"
                      : "bg-line";
                  return <li key={d.id} aria-hidden className={`h-[13px] w-[13px] rounded ${cls}`} />;
                })}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-muted">No program yet.</p>
          )}
          <p className="tnum text-[11px] text-muted">
            Avg sleep{" "}
            {avgSleepMin != null ? `${Math.floor(avgSleepMin / 60)}h ${String(avgSleepMin % 60).padStart(2, "0")}m` : "—"}
          </p>
        </section>

        <section aria-labelledby="weight-h" className="glass flex flex-col gap-1.5 px-4 py-3.5">
          <h2 id="weight-h" className="text-xs font-semibold text-muted">
            {fromScale ? "Weight · smart scale" : "Weight"}
          </h2>
          {currentWeight != null ? (
            <>
              <p className="tnum font-display text-[26px] font-bold leading-none text-ink">
                {showW(currentWeight)}
                <span className="text-[13px] text-muted"> {unit}</span>
              </p>
              {sparkPoints.length >= 2 ? <WeightSparkline points={sparkPoints} height={28} /> : null}
              {deltaFromPeak != null && deltaFromPeak < 0 ? (
                <p className="tnum text-[11px] font-bold text-green">
                  −{(unit === "lbs" ? kgToLbs(-deltaFromPeak) : -deltaFromPeak).toFixed(2)} from peak
                </p>
              ) : (
                <p className="text-[11px] text-muted">The line matters, not single readings.</p>
              )}
            </>
          ) : weightError ? (
            <p className="text-[13px] text-muted">Couldn&apos;t load your weight right now.</p>
          ) : (
            <p className="text-[13px] text-muted">Tell your coach your weight to start the trend.</p>
          )}
        </section>
      </div>

      <QuickLog items={quickItems} />

      {/* Today's meals */}
      <section aria-labelledby="meals-h" className="flex flex-col gap-2">
        <h2 id="meals-h" className="px-1 pt-1 text-sm font-bold text-ink">
          Today&apos;s meals
        </h2>
        {foodsError ? (
          <p role="alert" className="glass p-4 text-sm font-medium text-muted">
            Couldn&apos;t load today&apos;s meals. Try again in a moment.
          </p>
        ) : foods.length === 0 ? (
          <p className="glass p-4 text-sm font-medium text-muted">
            {quickItems.length
              ? "Nothing logged yet. Tap a dish above, or tell your coach what you ate."
              : "Nothing logged yet. Tell your coach what you ate."}
          </p>
        ) : (
          <div className="glass px-3.5 py-0.5">
            {groups.map((g, gi) => (
              <div key={g.meal} className={`py-2.5 ${gi < groups.length - 1 ? "border-b border-hairline" : ""}`}>
                <p className="text-[11px] font-bold capitalize text-muted">{g.meal}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.items.map((f) => (
                    <li key={f.id as string} className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink">
                        {f.name as string}
                        {f.serving ? <span className="text-muted">, {f.serving as string}</span> : null}
                      </span>
                      <span className="tnum shrink-0 text-[13px] text-muted">
                        {f.kcal != null ? fmt(Number(f.kcal)) : "—"}
                        {f.protein_g != null ? ` · P${Math.round(Number(f.protein_g))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
