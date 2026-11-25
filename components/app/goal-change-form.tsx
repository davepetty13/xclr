"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GOALS, GOAL_LABEL, isGoal, previewTargets, type Goal } from "@/lib/goal-change";
import { PRIMARY_GOALS } from "@/lib/onboarding-options";
import { kgToLbs, lbsToKg } from "@/lib/units";
import { saveGoalChange } from "@/app/(app)/goals/actions";

const HINT: Record<string, string> = Object.fromEntries(PRIMARY_GOALS.map((g) => [g.value, g.hint]));

function fmtWeight(kg: number | null, unit: "kg" | "lbs"): string {
  if (kg == null) return "";
  return (unit === "lbs" ? kgToLbs(kg) : kg).toFixed(1);
}

export function GoalChangeForm(props: {
  currentGoal: string | null;
  currentKcal: number | null;
  currentProtein: number | null;
  goalWeightKg: number | null;
  latestWeightKg: number | null;
  unit: "kg" | "lbs";
  // Preselected goal (e.g. /goals/change?goal=build_muscle from a chat card).
  initialGoal?: string | null;
}) {
  const router = useRouter();
  const startGoal: Goal = isGoal(props.currentGoal) ? props.currentGoal : "general_health";
  const [goal, setGoal] = useState<Goal>(isGoal(props.initialGoal) ? props.initialGoal : startGoal);
  const [weight, setWeight] = useState(fmtWeight(props.goalWeightKg, props.unit));

  const preview = useMemo(
    () =>
      previewTargets({
        currentGoal: props.currentGoal,
        currentKcal: props.currentKcal,
        currentProtein: props.currentProtein,
        newGoal: goal,
        latestWeightKg: props.latestWeightKg,
      }),
    [goal, props.currentGoal, props.currentKcal, props.currentProtein, props.latestWeightKg]
  );
  const [kcal, setKcal] = useState(String(preview.to.kcal));
  const [protein, setProtein] = useState(String(preview.to.protein));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ programChanged: boolean; oldGoal: string } | null>(null);

  function pick(g: Goal) {
    setGoal(g);
    const p = previewTargets({
      currentGoal: props.currentGoal,
      currentKcal: props.currentKcal,
      currentProtein: props.currentProtein,
      newGoal: g,
      latestWeightKg: props.latestWeightKg,
    });
    setKcal(String(p.to.kcal));
    setProtein(String(p.to.protein));
    setError(null);
  }

  async function save() {
    if (busy) return;
    setError(null);
    let goalKg: number | null = null;
    if (weight.trim()) {
      const raw = Number(weight);
      if (!Number.isFinite(raw) || raw <= 0) {
        setError("Goal weight should be a number.");
        return;
      }
      goalKg = props.unit === "lbs" ? lbsToKg(raw) : raw;
    }
    setBusy(true);
    const r = await saveGoalChange({
      goal,
      kcal: Number(kcal),
      protein: Number(protein),
      goal_weight_kg: goalKg,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved({ programChanged: r.programChanged, oldGoal: r.oldGoal });
    router.refresh();
  }

  if (saved) {
    return (
      <section className="flex flex-col gap-3" aria-live="polite">
        <p className="font-display text-lg font-bold text-ink">Saved. {GOAL_LABEL[goal]} it is.</p>
        <p className="-mt-2 text-sm text-muted">Your history stays. Only targets from today change.</p>
        {saved.programChanged ? (
          <div className="flex flex-col gap-1 rounded-2xl bg-field px-3.5 py-3">
            <p className="text-sm font-bold text-ink">
              Your program was built for {saved.oldGoal}. Build a new one?
            </p>
            <p className="text-sm text-muted">
              You&apos;ll see a preview first. Nothing changes until you approve it.
            </p>
            <Link href="/program" className="btn-primary mt-2 text-sm">
              Build a new program
            </Link>
          </div>
        ) : null}
        <Link href="/goals" className="btn-secondary text-sm">
          Back to Goals
        </Link>
      </section>
    );
  }

  const programLine = preview.programChanges ? "New one proposed (you approve it)" : "Stays the same";
  const num = "field tnum w-[84px] bg-card !px-2 text-right font-display text-base font-bold outline-none focus:border-green";

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Goal" className="flex flex-col gap-2">
        {GOALS.map((g) => {
          const on = g === goal;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(g)}
              className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] bg-card px-3.5 py-2 text-left ${
                on ? "shadow-[inset_0_0_0_2px_var(--ink)]" : "shadow-[inset_0_0_0_1px_var(--control-border)]"
              }`}
            >
              <span>
                <span className="block text-[15px] font-bold text-ink">{GOAL_LABEL[g]}</span>
                <span className="block text-xs text-muted">
                  {g === startGoal ? "Current goal" : HINT[g] ?? ""}
                </span>
              </span>
              <span
                aria-hidden
                className={`h-[18px] w-[18px] shrink-0 rounded-full ${
                  on ? "border-[5px] border-green" : "border-2 border-control-border"
                }`}
              />
            </button>
          );
        })}
      </div>

      <label className="flex min-h-[48px] items-center justify-between gap-3 rounded-[14px] bg-field px-3.5">
        <span className="text-sm text-ink">Goal weight</span>
        <span className="flex items-center gap-1.5">
          <input
            className={num}
            inputMode="decimal"
            value={weight}
            placeholder="Optional"
            aria-label={`Goal weight in ${props.unit}`}
            onChange={(e) => setWeight(e.target.value)}
          />
          <span className="text-[13px] text-muted">{props.unit}</span>
        </span>
      </label>

      <section className="flex flex-col gap-1.5 rounded-2xl bg-field px-3.5 py-3">
        <h2 className="text-xs font-bold text-muted">What changes</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">
            Daily calories{" "}
            <span className="tnum text-muted">({preview.from.kcal.toLocaleString("en-US")} now)</span>
          </span>
          <span className="flex items-center gap-1">
            <input className={num} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} />
            <span className="w-7 text-[13px] text-muted">kcal</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">
            Protein <span className="tnum text-muted">({preview.from.protein} g now)</span>
          </span>
          <span className="flex items-center gap-1">
            <input className={num} inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
            <span className="w-7 text-[13px] text-muted">g</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink">Program</span>
          <strong className="text-right text-ink">{programLine}</strong>
        </div>
        <span className="text-[11px] text-muted">Estimates. Adjust them if you like.</span>
      </section>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-ember-text">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary min-h-12 w-full text-[15px]">
        {busy ? "Saving…" : "Save goal"}
      </button>
      <p className="-mt-1 text-center text-xs text-muted">Your history stays. Only targets from today change.</p>
    </div>
  );
}
