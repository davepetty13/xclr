import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { PRIMARY_GOALS, SPORTS } from "@/lib/onboarding-options";
import Link from "next/link";
import { UnitToggle } from "@/components/app/goals-panel";
import { AiUsageCard } from "@/components/app/ai-usage-card";
import { getCurrentUser } from "@/lib/session";

export default async function GoalsPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
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

  const { data: latest } = await supabase
    .from("weights")
    .select("kg")
    .eq("user_id", user.id)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nowKg = latest?.kg != null ? Number(latest.kg) : null;
  const show = (kg: number | null) =>
    kg == null ? "—" : (unit === "lbs" ? kgToLbs(kg) : kg).toFixed(2);
  const toGo = nowKg != null && goalWeight != null ? Math.abs(nowKg - goalWeight) : null;

  const targets: { label: string; value: string }[] = [
    { label: "Primary goal", value: goalLabel },
    { label: "Daily calories", value: `${(Number(profile?.daily_calorie_target) || 2200).toLocaleString("en-US")} kcal` },
    { label: "Protein", value: `${Number(profile?.daily_protein_target) || 150} g` },
    { label: "Goal weight", value: goalWeightDisplay },
    { label: "Daily steps", value: (Number(profile?.daily_step_target) || 8000).toLocaleString("en-US") },
  ];

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-5">
      <header className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">Goals</h1>
          <p className="mt-0.5 text-xs text-muted">
            {[goalLabel, sportLabels.join(", ")].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/profile" className="btn-secondary px-3 text-[13px]">
            Profile
          </Link>
          <Link href="/goals/change" className="btn-primary px-3 text-[13px]">
            Change goal
          </Link>
        </div>
      </header>

      {/* The one top band: where your weight is vs the goal */}
      <section aria-label="Weight goal" className="band grid grid-cols-3">
        <div className="band-edge px-3.5 py-3">
          <p className="text-[11px] text-band-label">Now</p>
          <p className="tnum font-display text-[19px] font-bold">
            {show(nowKg)}
            {nowKg != null ? <span className="text-xs text-band-secondary"> {unit}</span> : null}
          </p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">Goal</p>
          <p className="tnum font-display text-[19px] font-bold">
            {show(goalWeight)}
            {goalWeight != null ? <span className="text-xs text-band-secondary"> {unit}</span> : null}
          </p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">To go</p>
          <p className="tnum font-display text-[19px] font-bold text-green-on-dark">
            {show(toGo)}
            {toGo != null ? <span className="text-xs text-band-secondary"> {unit}</span> : null}
          </p>
        </div>
      </section>

      <section aria-label="Targets" className="glass px-3.5 py-0.5">
        <dl>
          {targets.map((t) => (
            <div
              key={t.label}
              className="flex min-h-[46px] items-center justify-between gap-3 border-b border-hairline"
            >
              <dt className="text-sm text-ink">{t.label}</dt>
              <dd className="tnum font-display text-sm font-bold text-ink">{t.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex min-h-[52px] items-center justify-between gap-3">
          <span className="text-sm text-ink">
            Units
            <span className="block text-[11px] text-muted">Display only. Xclr stores kg.</span>
          </span>
          <UnitToggle unit={unit} />
        </div>
      </section>

      <AiUsageCard supabase={supabase} userId={user.id} />

      <form action="/auth/signout" method="post" className="mt-1">
        <button type="submit" className="btn-secondary w-full text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
