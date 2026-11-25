import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_TZ } from "@/lib/time";

type Supa = ReturnType<typeof createClient>;

export const GOALS = ["lose_fat", "build_muscle", "maintain", "endurance", "general_health"] as const;
export type Goal = (typeof GOALS)[number];

export const GOAL_LABEL: Record<Goal, string> = {
  lose_fat: "Lose fat",
  build_muscle: "Build muscle",
  maintain: "Maintain",
  endurance: "Endurance",
  general_health: "General health",
};

export function isGoal(v: unknown): v is Goal {
  return typeof v === "string" && (GOALS as readonly string[]).includes(v);
}

// Calorie offset from maintenance each goal implies (kcal/day).
const KCAL_OFFSET: Record<Goal, number> = {
  lose_fat: -400,
  build_muscle: 300,
  maintain: 0,
  endurance: 100,
  general_health: 0,
};
// Protein per kg bodyweight each goal implies.
const PROTEIN_PER_KG: Record<Goal, number> = {
  lose_fat: 2.2,
  build_muscle: 2.0,
  maintain: 1.8,
  endurance: 1.6,
  general_health: 1.6,
};

export type TargetPreview = {
  from: { goal: Goal; kcal: number; protein: number };
  to: { goal: Goal; kcal: number; protein: number };
  programChanges: boolean; // a goal switch means a new program gets proposed
};

// Deterministic preview of new targets (no AI). Maintenance is backed out of
// the user's CURRENT target + current goal, so their own tuned numbers carry
// over. Shown to the user as an estimate before anything is saved.
export function previewTargets(input: {
  currentGoal: string | null;
  currentKcal: number | null;
  currentProtein: number | null;
  newGoal: Goal;
  latestWeightKg: number | null;
}): TargetPreview {
  const curGoal: Goal = isGoal(input.currentGoal) ? input.currentGoal : "general_health";
  const curKcal = input.currentKcal && input.currentKcal > 0 ? input.currentKcal : 2200;
  const curProtein = input.currentProtein && input.currentProtein > 0 ? input.currentProtein : 150;
  const maintenance = curKcal - KCAL_OFFSET[curGoal];
  const kcal = Math.round((maintenance + KCAL_OFFSET[input.newGoal]) / 10) * 10;
  const protein =
    input.latestWeightKg && input.latestWeightKg > 0
      ? Math.round((input.latestWeightKg * PROTEIN_PER_KG[input.newGoal]) / 5) * 5
      : curProtein;
  return {
    from: { goal: curGoal, kcal: curKcal, protein: curProtein },
    to: { goal: input.newGoal, kcal, protein },
    programChanges: curGoal !== input.newGoal,
  };
}

export type GoalChange = {
  goal: Goal;
  kcal: number;
  protein: number;
  goal_weight_kg?: number | null;
};

// Validate a goal change before writing (also used for chat proposals).
export function validGoalChange(c: Partial<GoalChange> | null | undefined): c is GoalChange {
  if (!c || !isGoal(c.goal)) return false;
  if (typeof c.kcal !== "number" || c.kcal < 1000 || c.kcal > 6000) return false;
  if (typeof c.protein !== "number" || c.protein < 30 || c.protein > 400) return false;
  if (c.goal_weight_kg != null && (typeof c.goal_weight_kg !== "number" || c.goal_weight_kg < 30 || c.goal_weight_kg > 300))
    return false;
  return true;
}

// Apply an APPROVED goal change. History is untouched; only targets from now on.
export async function applyGoalChange(
  supabase: Supa,
  userId: string,
  c: GoalChange
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!validGoalChange(c)) return { ok: false, error: "Those numbers don't look right." };
  const update: Record<string, unknown> = {
    primary_goal: c.goal,
    daily_calorie_target: c.kcal,
    daily_protein_target: c.protein,
    updated_at: new Date().toISOString(),
  };
  if (c.goal_weight_kg !== undefined) update.goal_weight_kg = c.goal_weight_kg;
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) {
    console.error(`[applyGoalChange] ${error.message}`);
    return { ok: false, error: "Couldn't save your goal." };
  }
  return { ok: true };
}

// The user's timezone (falls back to Manila).
export async function getUserTz(supabase: Supa, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data?.timezone as string | null) ?? DEFAULT_TZ;
}
