import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { PRIMARY_GOALS, SPORTS } from "@/lib/onboarding-options";
import { UnitToggle } from "@/components/app/goals-panel";

export default async function GoalsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "primary_goal, sports, goal_weight_kg, daily_calorie_target, daily_protein_target, daily_step_target, weight_unit"
    )
    .eq("id", user.id)
    .single();

  const unit: "kg" | "lbs" = profile?.weight_unit === "lbs" ? "lbs" : "kg";
  const goalLabel =
    PRIMARY_GOALS.find((g) => g.value === profile?.primary_goal)?.label ??
    "General health";
  const sportValues: string[] = Array.isArray(profile?.sports)
    ? (profile?.sports as string[])
    : [];
  const sportLabels = sportValues.map(
    (v) => SPORTS.find((s) => s.value === v)?.label ?? v
  );
  const goalWeight =
    profile?.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null;
  const goalWeightDisplay =
    goalWeight == null
      ? "—"
      : unit === "lbs"
        ? `${kgToLbs(goalWeight).toFixed(1)} lbs`
        : `${goalWeight.toFixed(1)} kg`;

  const targets: { label: string; value: string }[] = [
    { label: "Daily calories", value: `${Number(profile?.daily_calorie_target) || 2200} kcal` },
    { label: "Daily protein", value: `${Number(profile?.daily_protein_target) || 150} g` },
    { label: "Goal weight", value: goalWeightDisplay },
    { label: "Daily steps", value: `${Number(profile?.daily_step_target) || 8000}` },
  ];

  return (
    <main className="px-5 py-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-ink">
        Goals
      </h1>

      <section className="mt-5 rounded-card border border-line bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Primary goal
        </p>
        <p className="mt-1 font-serif text-xl font-medium text-ink">{goalLabel}</p>
        <p className="mt-1 text-sm font-medium text-muted">
          This drives your dashboard. Change it and Xclr proposes a fresh program.
        </p>
      </section>

      <section className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Sports
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sportLabels.length ? (
            sportLabels.map((s) => (
              <span
                key={s}
                className="rounded-chip border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink"
              >
                {s}
              </span>
            ))
          ) : (
            <span className="text-sm font-medium text-muted">None yet</span>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Targets
        </p>
        <dl className="mt-2 divide-y divide-line">
          {targets.map((t) => (
            <div key={t.label} className="flex items-baseline justify-between py-2.5">
              <dt className="text-sm font-medium text-ink">{t.label}</dt>
              <dd className="tnum text-sm font-semibold text-muted">{t.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-card border border-line bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Units
        </p>
        <p className="mb-2 mt-1 text-sm font-medium text-muted">
          Display only — Xclr always stores kilograms.
        </p>
        <UnitToggle unit={unit} />
      </section>

      <form action="/auth/signout" method="post" className="mt-6">
        <button
          type="submit"
          className="w-full rounded-chip border border-line bg-card px-4 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
