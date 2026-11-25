"use server";

import { createClient } from "@/lib/supabase/server";
import {
  GOAL_LABEL,
  applyGoalChange,
  isGoal,
  validGoalChange,
  type Goal,
  type GoalChange,
} from "@/lib/goal-change";

export type SimpleResult = { ok: true } | { ok: false; error: string };

// Units preference is display-only (Spec §6) — stored weights stay in kg.
export async function setWeightUnit(unit: "kg" | "lbs"): Promise<SimpleResult> {
  if (unit !== "kg" && unit !== "lbs")
    return { ok: false, error: "Unknown unit." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const { error } = await supabase
    .from("profiles")
    .update({ weight_unit: unit, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't update your preference." };
  return { ok: true };
}

export type GoalSaveResult =
  | { ok: true; programChanged: boolean; oldGoal: string }
  | { ok: false; error: string };

// Save a goal change the user picked on /goals/change. Validated server-side,
// then applied via the shared applyGoalChange (history untouched; only targets
// from today change). The program is NEVER replaced here — the page offers a
// link to the builder, which previews before anything is approved.
export async function saveGoalChange(input: {
  goal: string;
  kcal: number;
  protein: number;
  goal_weight_kg: number | null;
}): Promise<GoalSaveResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  if (!isGoal(input?.goal)) return { ok: false, error: "Pick a goal." };
  const change: GoalChange = {
    goal: input.goal,
    kcal: Math.round(Number(input?.kcal)),
    protein: Math.round(Number(input?.protein)),
    goal_weight_kg:
      input?.goal_weight_kg == null || !Number.isFinite(Number(input.goal_weight_kg))
        ? null
        : Math.round(Number(input.goal_weight_kg) * 100) / 100,
  };
  if (!validGoalChange(change))
    return {
      ok: false,
      error: "Check the numbers: calories 1,000–6,000, protein 30–400 g, goal weight 30–300 kg.",
    };

  const { data: before } = await supabase
    .from("profiles")
    .select("primary_goal")
    .eq("id", user.id)
    .maybeSingle();
  const oldGoal: Goal = isGoal(before?.primary_goal) ? before.primary_goal : "general_health";

  const r = await applyGoalChange(supabase, user.id, change);
  if (!r.ok) return r;
  return { ok: true, programChanged: oldGoal !== change.goal, oldGoal: GOAL_LABEL[oldGoal] };
}
