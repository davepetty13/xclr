import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { getActiveProgram } from "@/lib/programs";
import { WeightSparkline } from "@/components/app/weight-sparkline";
import { MEALS } from "@/lib/parse-schema";

function startOfDayISO(daysAgo = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export default async function TodayPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, primary_goal, daily_calorie_target, daily_protein_target, weight_unit"
    )
    .eq("id", user.id)
    .single();

  const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
  const showKg = (kg: number) =>
    unit === "lbs" ? `${kgToLbs(kg).toFixed(1)} lbs` : `${kg.toFixed(2)} kg`;

  const calTarget = Number(profile?.daily_calorie_target) || 2200;
  const proTarget = Number(profile?.daily_protein_target) || 150;

  const { data: todayFoods } = await supabase
    .from("food_logs")
    .select("id, name, serving, meal, kcal, protein_g")
    .eq("user_id", user.id)
    .gte("logged_at", startOfDayISO(0))
    .order("logged_at", { ascending: true });

  const foods = todayFoods ?? [];
  const kcalEaten = foods.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const proteinNow = foods.reduce((s, f) => s + (Number(f.protein_g) || 0), 0);
  const caloriesLeft = Math.round(calTarget - kcalEaten);
  const proteinPct = Math.min(100, Math.round((proteinNow / proTarget) * 100));

  const { data: weightRows } = await supabase
    .from("weights")
    .select("measured_on, kg")
    .eq("user_id", user.id)
    .order("measured_on", { ascending: false })
    .limit(14);
  const weights = (weightRows ?? []).map((w) => Number(w.kg));
  const currentWeight = weights[0] ?? null;
  const peakWeight = weights.length ? Math.max(...weights) : null;
  const deltaFromPeak =
    currentWeight != null && peakWeight != null ? currentWeight - peakWeight : null;
  const sparkPoints = [...weights].reverse();

  // This-week strip (last 7 days).
  const weekStart = startOfDayISO(6);
  const { count: workoutsDone } = await supabase
    .from("workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("performed_at", weekStart);

  const activeProgram = await getActiveProgram(supabase, user.id);
  let planned = 0;
  if (activeProgram) {
    const { count } = await supabase
      .from("program_days")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("program_id", activeProgram.id)
      .neq("type", "rest");
    planned = count ?? 0;
  }

  const { data: sleepRows } = await supabase
    .from("sleep_logs")
    .select("duration_min")
    .eq("user_id", user.id)
    .gte("slept_on", startOfDayISO(6).slice(0, 10));
  const sleepVals = (sleepRows ?? [])
    .map((s) => Number(s.duration_min))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgSleepMin = sleepVals.length
    ? Math.round(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length)
    : null;

  const firstName = (profile?.display_name ?? "").split(" ")[0] || "there";

  // Group today's foods by meal for the list.
  const grouped = MEALS.map((m) => ({
    meal: m,
    items: foods.filter((f) => f.meal === m),
  })).filter((g) => g.items.length > 0);
  const ungrouped = foods.filter((f) => !f.meal || !MEALS.includes(f.meal as (typeof MEALS)[number]));

  return (
    <main className="px-5 py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
        {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
      </p>
      <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-ink">
        Hi {firstName} 👋
      </h1>

      {/* Hero: calories LEFT */}
      <section className="mt-5 rounded-card border border-line bg-card p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
          Calories left today
        </p>
        <p className="tnum mt-1 font-serif text-6xl font-medium text-green">
          {caloriesLeft}
        </p>
        <p className="tnum mt-1 text-sm font-medium text-muted">
          {Math.round(kcalEaten)} eaten · target {calTarget}
        </p>

        {/* Protein bar — the co-star */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-ink">Protein</span>
            <span className="tnum text-sm font-medium text-muted">
              {Math.round(proteinNow)} / {proTarget} g
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-chip bg-green-soft">
            <div
              className="h-full rounded-chip bg-green"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* This-week strip */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-tile border border-line bg-card p-3 text-center">
          <p className="tnum font-serif text-xl font-medium text-ink">
            {workoutsDone ?? 0}
            <span className="text-sm text-muted">/{planned || "–"}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-muted">workouts</p>
        </div>
        <div className="rounded-tile border border-line bg-card p-3 text-center">
          <p className="tnum font-serif text-xl font-medium text-ink">
            {avgSleepMin != null
              ? `${Math.floor(avgSleepMin / 60)}h${String(avgSleepMin % 60).padStart(2, "0")}`
              : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-muted">avg sleep</p>
        </div>
        <div className="rounded-tile border border-line bg-card p-3 text-center">
          <p className="tnum font-serif text-xl font-medium text-ink">—</p>
          <p className="mt-0.5 text-xs font-medium text-muted">kcal burned</p>
        </div>
      </section>

      {/* Weight trend */}
      <section className="mt-4 rounded-card border border-line bg-card p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink">Weight</span>
          {currentWeight != null ? (
            <span className="tnum text-sm font-medium text-muted">
              {showKg(currentWeight)}
              {deltaFromPeak != null && deltaFromPeak < 0 ? (
                <span className="text-green"> ({deltaFromPeak.toFixed(2)} from peak)</span>
              ) : null}
            </span>
          ) : null}
        </div>
        {sparkPoints.length >= 2 ? (
          <div className="mt-3">
            <WeightSparkline points={sparkPoints} />
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium text-muted">
            Log your weight in Chat to start the trend.
          </p>
        )}
        <p className="mt-2 text-xs font-medium text-faint">
          The line matters, not single readings.
        </p>
      </section>

      {/* Today's meals */}
      <section className="mt-4">
        <h2 className="text-sm font-semibold text-ink">Today&apos;s meals</h2>
        {foods.length === 0 ? (
          <p className="mt-2 rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
            Nothing logged yet. Head to Chat and tell Xclr what you ate.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {[...grouped, ...(ungrouped.length ? [{ meal: "other" as const, items: ungrouped }] : [])].map(
              (g) => (
                <div key={g.meal} className="rounded-tile border border-line bg-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                    {g.meal}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {g.items.map((f) => (
                      <li key={f.id as string} className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-ink">
                          {f.name as string}
                          {f.serving ? (
                            <span className="text-muted"> · {f.serving as string}</span>
                          ) : null}
                        </span>
                        <span className="tnum shrink-0 text-sm text-muted">
                          {f.protein_g != null ? `P${Math.round(Number(f.protein_g))} · ` : ""}
                          {f.kcal != null ? `${Math.round(Number(f.kcal))} kcal` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        )}
      </section>
    </main>
  );
}
