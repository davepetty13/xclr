"use server";

import { createClient } from "@/lib/supabase/server";
import { anthropic, PROGRAM_MODEL } from "@/lib/anthropic";
import { generateJson } from "@/lib/ai-json";
import { PARSE_JSON_SCHEMA, normalizeParse, type ParsedFood } from "@/lib/parse-schema";
import {
  PARSE_SYSTEM_PROMPT,
  buildCoachSystemPrompt,
  type CoachContext,
  type CoachPersona,
} from "@/lib/chat-prompts";
import { resolveExerciseIds } from "@/lib/exercises";
import { getActiveProgram } from "@/lib/programs";

export type FoodCard = {
  id: string;
  name: string;
  serving: string | null;
  meal: string | null;
  kcal: number | null;
  protein_g: number | null;
  is_estimate: boolean;
};

export type ChatResult =
  | {
      ok: true;
      reply: string;
      cards: FoodCard[];
      kcal_today: number;
      protein_today: number;
    }
  | { ok: false; error: string };

// "Today" as a UTC day window. Good enough for v1; a timezone-aware window can
// come later without touching stored data (logged_at stays a full timestamp).
function todayStartISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
function todayDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function sendChatMessage(text: string): Promise<ChatResult> {
  const clean = (text ?? "").trim();
  if (!clean) return { ok: false, error: "Say something to log." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in again." };

  // ---- 1. Parse (separate call — the parser logs, the coach coaches). ----
  const parseResult = await generateJson({
    system: PARSE_SYSTEM_PROMPT,
    user: clean,
    schema: PARSE_JSON_SCHEMA,
    toolName: "log_entry",
    maxTokens: 2000,
    effort: "low",
  });
  if (!parseResult.ok) return { ok: false, error: parseResult.error };
  const parsed = normalizeParse(parseResult.data);

  const justLogged: string[] = [];
  const cards: FoodCard[] = [];

  // ---- 2. Anti-fabrication: vague input → write NOTHING (Spec §10). ----
  if (!parsed.needs_clarification) {
    // Foods — check the personal library first (their confirmed numbers win).
    if (parsed.foods.length) {
      const { data: lib } = await supabase
        .from("food_library")
        .select("id, name, serving, kcal, protein_g, carbs_g, fat_g, times_logged")
        .eq("user_id", user.id);
      const libByLower = new Map<string, Record<string, unknown>>();
      for (const row of lib ?? [])
        libByLower.set((row.name as string).toLowerCase(), row);

      const rows = parsed.foods.map((f: ParsedFood) => {
        const known = libByLower.get(f.name.toLowerCase());
        if (known) {
          return {
            user_id: user.id,
            logged_at: new Date().toISOString(),
            meal: f.meal,
            name: known.name as string,
            serving: (known.serving as string | null) ?? f.serving,
            kcal: known.kcal as number | null,
            protein_g: known.protein_g as number | null,
            carbs_g: known.carbs_g as number | null,
            fat_g: known.fat_g as number | null,
            source: "library",
            is_estimate: false,
          };
        }
        return {
          user_id: user.id,
          logged_at: new Date().toISOString(),
          meal: f.meal,
          name: f.name,
          serving: f.serving,
          kcal: f.kcal,
          protein_g: f.protein_g,
          carbs_g: f.carbs_g,
          fat_g: f.fat_g,
          source: "chat",
          is_estimate: f.is_estimate,
        };
      });

      const { data: inserted } = await supabase
        .from("food_logs")
        .insert(rows)
        .select("id, name, serving, meal, kcal, protein_g, is_estimate");
      for (const row of inserted ?? []) {
        cards.push({
          id: row.id as string,
          name: row.name as string,
          serving: (row.serving as string | null) ?? null,
          meal: (row.meal as string | null) ?? null,
          kcal: (row.kcal as number | null) ?? null,
          protein_g: (row.protein_g as number | null) ?? null,
          is_estimate: (row.is_estimate as boolean) ?? true,
        });
        justLogged.push(
          `${row.name}${row.kcal != null ? ` ~${Math.round(row.kcal as number)} kcal` : ""}`
        );
      }

      // Bump times_logged for any dish drawn from the library.
      for (const f of parsed.foods) {
        const known = libByLower.get(f.name.toLowerCase());
        if (known)
          await supabase
            .from("food_library")
            .update({ times_logged: ((known.times_logged as number) ?? 1) + 1 })
            .eq("id", known.id as string);
      }
    }

    // Weight → today's row (metric only).
    if (parsed.weight_kg != null) {
      await supabase
        .from("weights")
        .upsert(
          { user_id: user.id, measured_on: todayDateISO(), kg: parsed.weight_kg },
          { onConflict: "user_id,measured_on" }
        );
      justLogged.push(`weight ${parsed.weight_kg}kg`);
    }

    // Sleep → today's row.
    if (parsed.sleep) {
      await supabase.from("sleep_logs").upsert(
        {
          user_id: user.id,
          slept_on: todayDateISO(),
          duration_min: parsed.sleep.duration_min,
          quality: parsed.sleep.quality,
          source: "chat",
        },
        { onConflict: "user_id,slept_on" }
      );
      justLogged.push("sleep");
    }

    // Workout → session + set_logs (completes the §10 mapping).
    if (parsed.workout) {
      const { data: session } = await supabase
        .from("workout_sessions")
        .insert({ user_id: user.id, type: parsed.workout.type, performed_at: new Date().toISOString() })
        .select("id")
        .single();
      if (session) {
        const ids = await resolveExerciseIds(
          supabase,
          user.id,
          parsed.workout.sets.map((s) => ({ name: s.exercise }))
        );
        const perExercise = new Map<string, number>();
        const setRows = parsed.workout.sets
          .map((s) => {
            const exId = ids.get(s.exercise.toLowerCase());
            if (!exId) return null;
            const idx = (perExercise.get(exId) ?? 0) + 1;
            perExercise.set(exId, idx);
            return {
              user_id: user.id,
              session_id: session.id as string,
              exercise_id: exId,
              set_index: idx,
              actual_load_value: s.load_value,
              actual_load_type: s.load_type,
              actual_reps: s.reps,
              actual_rpe: s.rpe,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (setRows.length) await supabase.from("set_logs").insert(setRows);
        justLogged.push(`${parsed.workout.type ?? "workout"} logged`);
      }
    }
  }

  // ---- 3. Coach reply (separate call, §2c) with grounded context. ----
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, primary_goal, daily_calorie_target, daily_protein_target, coach_persona, health_data_consent_at"
    )
    .eq("id", user.id)
    .single();

  const { data: todayFoods } = await supabase
    .from("food_logs")
    .select("kcal, protein_g")
    .eq("user_id", user.id)
    .gte("logged_at", todayStartISO());
  const kcalToday = (todayFoods ?? []).reduce((s, r) => s + (Number(r.kcal) || 0), 0);
  const proteinToday = (todayFoods ?? []).reduce(
    (s, r) => s + (Number(r.protein_g) || 0),
    0
  );

  const { data: recentWeights } = await supabase
    .from("weights")
    .select("measured_on, kg")
    .eq("user_id", user.id)
    .order("measured_on", { ascending: false })
    .limit(7);
  const weightToday =
    (recentWeights ?? []).find((w) => w.measured_on === todayDateISO())?.kg ?? null;

  let medical: string[] = [];
  if (profile?.health_data_consent_at) {
    const { data: conds } = await supabase
      .from("medical_conditions")
      .select("condition")
      .eq("user_id", user.id)
      .eq("active", true);
    medical = (conds ?? []).map((c) => c.condition as string);
  }

  // Active program prescriptions so the coach can answer load-type / "is 40
  // total or per side?" questions from the user's own program data.
  let programName: string | null = null;
  let prescriptions: CoachContext["prescriptions"] = [];
  const activeProgram = await getActiveProgram(supabase, user.id);
  if (activeProgram) {
    programName = activeProgram.name;
    const { data: days } = await supabase
      .from("program_days")
      .select("id")
      .eq("user_id", user.id)
      .eq("program_id", activeProgram.id);
    const dayIds = (days ?? []).map((d) => d.id as string);
    if (dayIds.length) {
      const { data: pes } = await supabase
        .from("program_exercises")
        .select("exercise_id, suggested_load_value, suggested_load_type, rep_scheme")
        .eq("user_id", user.id)
        .in("program_day_id", dayIds);
      const { data: exRows } = await supabase
        .from("exercises")
        .select("id, name")
        .eq("user_id", user.id);
      const nameById = new Map<string, string>();
      for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);
      prescriptions = (pes ?? []).map((pe) => ({
        name: nameById.get(pe.exercise_id as string) ?? "Exercise",
        load_value: pe.suggested_load_value as number | null,
        load_type: pe.suggested_load_type as string | null,
        rep_scheme: pe.rep_scheme as string | null,
      }));
    }
  }

  const ctx: CoachContext = {
    persona: (profile?.coach_persona as CoachPersona) ?? {},
    display_name: profile?.display_name ?? "there",
    primary_goal: profile?.primary_goal ?? "general_health",
    calorie_target: Number(profile?.daily_calorie_target) || 2200,
    protein_target: Number(profile?.daily_protein_target) || 150,
    kcal_today: kcalToday,
    protein_today: proteinToday,
    weight_today_kg: weightToday != null ? Number(weightToday) : null,
    recent_weights: (recentWeights ?? []).map((w) => ({
      measured_on: w.measured_on as string,
      kg: Number(w.kg),
    })),
    medical,
    just_logged: justLogged,
    program_name: programName,
    prescriptions,
  };

  let reply = parsed.needs_clarification ?? "";
  if (!reply) {
    try {
      const coach = await anthropic().messages.create({
        model: PROGRAM_MODEL,
        // Headroom for adaptive thinking (on by default) + the short reply, so
        // the visible text isn't starved by the thinking budget.
        max_tokens: 1500,
        system: buildCoachSystemPrompt(ctx),
        output_config: { effort: "low" },
        messages: [{ role: "user", content: clean }],
      });
      const t = coach.content.find((b) => b.type === "text");
      reply = t && t.type === "text" ? t.text : "Logged. 💪";
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[coach reply] Anthropic error status=${status ?? "?"} message=${message}`);
      reply = "Logged it. (Coach is catching its breath — try again for a reply.)";
    }
  }

  // Persist the turn so bubbles survive a reload (text only — the live cards are
  // derived from food_logs). Coach row is +1ms so ordering is deterministic.
  const nowMs = Date.now();
  const { error: msgErr } = await supabase.from("messages").insert([
    { user_id: user.id, role: "user", content: clean, created_at: new Date(nowMs).toISOString() },
    { user_id: user.id, role: "coach", content: reply, created_at: new Date(nowMs + 1).toISOString() },
  ]);
  // Persistence is best-effort (the reply still returns) — but log, don't swallow.
  if (msgErr) console.error(`[messages persist] ${msgErr.message}`);

  return {
    ok: true,
    reply,
    cards,
    kcal_today: kcalToday,
    protein_today: proteinToday,
  };
}
