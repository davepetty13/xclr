import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { getWeekStatus } from "@/lib/programs";
import { GOAL_LABEL, getUserTz, isGoal } from "@/lib/goal-change";
import { addDays, localDayStartISO, todayLocal } from "@/lib/time";
import { WeightSparkline } from "@/components/app/weight-sparkline";
import { QuickLog, type QuickLogItem } from "@/components/app/quick-log";
import { MEALS } from "@/lib/parse-schema";
import { getCurrentUser } from "@/lib/session";

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
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, primary_goal, daily_calorie_target, daily_protein_target, weight_unit")
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
        .select("measured_on, kg")
        .eq("user_id", user.id)
        .order("measured_on", { ascending: false })
        .limit(14),
      supabase
        .from("food_library")
        .select("id, name, serving, kcal")
        .eq("user_id", user.id)
        .order("times_logged", { ascending: false })
        .limit(3),
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
  const peakWeight = weights.length ? Math.max(...weights) : null;
  const deltaFromPeak =
    currentWeight != null && peakWeight != null ? currentWeight - peakWeight : null;
  const sparkPoints = [...weights].reverse();

  // Session for today + this week's squares
  const next = status?.nextDay ?? null;
  // Avg sleep over this local week (program week if there is one, else last 7
  // days). Fetched together with today's exercise count.
  const sleepFrom = status?.weekStartedOn ?? addDays(today, -6);
  const [exerciseCount, { data: sleepRows }] = await Promise.all([
    next
      ? supabase
          .from("program_exercises")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("program_day_id", next.id)
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
    supabase
      .from("sleep_logs")
      .select("duration_min")
      .eq("user_id", user.id)
      .gte("slept_on", sleepFrom)
      .lte("slept_on", today),
  ]);
  const sleepVals = (sleepRows ?? [])
    .map((s) => Number(s.duration_min))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgSleepMin = sleepVals.length
    ? Math.round(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length)
    : null;

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
        {status ? (
          <span className="mark mark-neutral mt-1 shrink-0">
            Week {status.week}
            {next ? ` · Day ${next.day_index}` : ""}
          </span>
        ) : null}
      </header>

      {/* The one dark band: calories left today */}
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
        {/* No real burn source yet, so no Burned tile — never a made-up number. */}
        <dl className="grid grid-cols-3 border-t border-band-hairline">
          <div className="px-[18px] py-2.5">
            <dt className="text-[11px] text-band-label">Eaten</dt>
            <dd className="tnum font-display text-[19px] font-bold">{fmt(kcalEaten)}</dd>
          </div>
          <div className="border-l border-band-hairline px-3.5 py-2.5">
            <dt className="text-[11px] text-band-label">Protein</dt>
            <dd className="tnum font-display text-[19px] font-bold">
              {fmt(proteinNow)}
              <span className="text-xs text-band-secondary"> / {proTarget} g</span>
            </dd>
          </div>
          <div className="border-l border-band-hairline px-3.5 py-2.5">
            <dt className="text-[11px] text-band-label">Target</dt>
            <dd className="tnum font-display text-[19px] font-bold">{fmt(calTarget)}</dd>
          </div>
        </dl>
      </section>

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
            Weight
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
            Nothing logged yet. Tap a dish above, or tell your coach what you ate.
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
