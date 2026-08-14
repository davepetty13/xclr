"use server";

import { createClient } from "@/lib/supabase/server";
import { anthropic, PROGRAM_MODEL } from "@/lib/anthropic";
import {
  PROGRAM_JSON_SCHEMA,
  validateProgram,
  type GeneratedProgram,
} from "@/lib/program-schema";
import {
  PROGRAM_SYSTEM_PROMPT,
  buildProgramUserMessage,
  type ProgramInputs,
} from "@/lib/program-prompt";

export type GenerateResult =
  | { ok: true; program: GeneratedProgram }
  | { ok: false; error: string };

export type ApproveResult = { ok: true } | { ok: false; error: string };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Generate a first program via Claude. Returns the validated JSON for PREVIEW —
// nothing is written to the DB until the user approves (Doc 02 §1: signup ends
// with an approved program, not an imposed one).
export async function generateProgram(): Promise<GenerateResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in again." };

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, primary_goal, sports, training_days_per_week, session_minutes, preferred_days, preferred_time, training_experience, equipment_access, height_cm, goal_weight_kg, health_data_consent_at"
    )
    .eq("id", user.id)
    .single();
  if (!profile || profile.height_cm == null)
    return { ok: false, error: "Finish onboarding first." };

  const { data: latestWeight } = await supabase
    .from("weights")
    .select("kg")
    .eq("user_id", user.id)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Medical is sent to the AI ONLY when consent is set (Spec §11 hard rule).
  let medical: { condition: string; notes: string | null }[] = [];
  if (profile.health_data_consent_at) {
    const { data: conds } = await supabase
      .from("medical_conditions")
      .select("condition, notes")
      .eq("user_id", user.id)
      .eq("active", true);
    medical = (conds ?? []).map((c) => ({
      condition: c.condition as string,
      notes: (c.notes as string | null) ?? null,
    }));
  }

  const inputs: ProgramInputs = {
    display_name: profile.display_name ?? null,
    primary_goal: profile.primary_goal ?? "general_health",
    sports: Array.isArray(profile.sports) ? (profile.sports as string[]) : [],
    training_days_per_week: Number(profile.training_days_per_week) || 4,
    session_minutes: Number(profile.session_minutes) || 60,
    preferred_days: Array.isArray(profile.preferred_days)
      ? (profile.preferred_days as string[])
      : [],
    preferred_time: (profile.preferred_time as string | null) ?? null,
    training_experience: profile.training_experience ?? "intermediate",
    equipment_access: profile.equipment_access ?? "commercial_gym",
    height_cm: Number(profile.height_cm) || null,
    current_weight_kg: latestWeight ? Number(latestWeight.kg) : null,
    goal_weight_kg:
      profile.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null,
    medical,
  };

  try {
    const message = await anthropic().messages.create({
      model: PROGRAM_MODEL,
      max_tokens: 16000,
      system: PROGRAM_SYSTEM_PROMPT,
      // Structured outputs guarantee the response matches the §3c contract;
      // medium effort bounds thinking spend (thinking counts against max_tokens).
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PROGRAM_JSON_SCHEMA },
      },
      messages: [{ role: "user", content: buildProgramUserMessage(inputs) }],
    });

    if (message.stop_reason === "refusal")
      return { ok: false, error: "The coach couldn't build that. Try again." };
    if (message.stop_reason === "max_tokens")
      return { ok: false, error: "That program ran long — tap Regenerate to try again." };

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text")
      return { ok: false, error: "The coach didn't return a program. Try again." };

    const parsed = JSON.parse(textBlock.text);
    const result = validateProgram(parsed);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, program: result.program };
  } catch {
    return { ok: false, error: "Couldn't reach the coach — try again in a moment." };
  }
}

// Approve (and optionally edited) program → write the plan-layer rows and make
// it active. Any prior active program is deactivated first (goal/sport-change
// regeneration reuses this path). All writes are RLS-scoped to the caller.
export async function approveProgram(
  program: GeneratedProgram
): Promise<ApproveResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in again." };

  const check = validateProgram(program);
  if (!check.ok) return { ok: false, error: check.error };
  const prog = check.program;

  // 1. Deactivate existing active program(s).
  const { error: deactErr } = await supabase
    .from("programs")
    .update({ active: false })
    .eq("user_id", user.id)
    .eq("active", true);
  if (deactErr) return { ok: false, error: "Couldn't update your programs." };

  // 2. Resolve exercise names → ids (unique per user, case-insensitive).
  const byLower = new Map<string, { name: string; category: string | null }>();
  for (const d of prog.days) {
    for (const e of d.exercises) {
      const lo = e.exercise.toLowerCase();
      if (!byLower.has(lo)) byLower.set(lo, { name: e.exercise, category: e.category });
    }
  }
  const idByLower = new Map<string, string>();
  const { data: existing } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);
  for (const row of existing ?? [])
    idByLower.set((row.name as string).toLowerCase(), row.id as string);

  const missing = Array.from(byLower.entries()).filter(([lo]) => !idByLower.has(lo));
  if (missing.length) {
    const { data: inserted, error: exErr } = await supabase
      .from("exercises")
      .insert(
        missing.map(([, v]) => ({
          user_id: user.id,
          name: v.name,
          category: v.category,
        }))
      )
      .select("id, name");
    if (exErr) return { ok: false, error: "Couldn't save exercises." };
    for (const row of inserted ?? [])
      idByLower.set((row.name as string).toLowerCase(), row.id as string);
  }

  // 3. Insert the program.
  const { data: programRow, error: pErr } = await supabase
    .from("programs")
    .insert({
      user_id: user.id,
      name: prog.program.name,
      goal: prog.program.goal,
      active: true,
      week_start: todayISO(),
    })
    .select("id")
    .single();
  if (pErr || !programRow)
    return { ok: false, error: "Couldn't save your program." };
  const programId = programRow.id as string;

  // 4. Insert days.
  const { data: dayRows, error: dErr } = await supabase
    .from("program_days")
    .insert(
      prog.days.map((d) => ({
        user_id: user.id,
        program_id: programId,
        day_index: d.day_index,
        label: d.label,
        type: d.type,
      }))
    )
    .select("id, day_index");
  if (dErr || !dayRows)
    return { ok: false, error: "Couldn't save your program days." };
  const dayIdByIndex = new Map<number, string>();
  for (const row of dayRows)
    dayIdByIndex.set(row.day_index as number, row.id as string);

  // 5. Insert program_exercises.
  const peRows: Record<string, unknown>[] = [];
  for (const d of prog.days) {
    const dayId = dayIdByIndex.get(d.day_index);
    if (!dayId) continue;
    d.exercises.forEach((e, i) => {
      const exId = idByLower.get(e.exercise.toLowerCase());
      if (!exId) return;
      peRows.push({
        user_id: user.id,
        program_day_id: dayId,
        exercise_id: exId,
        position: e.position ?? i + 1,
        prescribed_sets: e.prescribed_sets,
        rep_scheme: e.rep_scheme,
        rep_low: e.rep_low,
        rep_high: e.rep_high,
        suggested_load_value: e.suggested_load_value,
        suggested_load_type: e.suggested_load_type,
        target_rpe_low: e.target_rpe_low,
        target_rpe_high: e.target_rpe_high,
        coach_note: e.coach_note,
      });
    });
  }
  if (peRows.length) {
    const { error: peErr } = await supabase
      .from("program_exercises")
      .insert(peRows);
    if (peErr) return { ok: false, error: "Couldn't save your exercises." };
  }

  return { ok: true };
}
