"use server";

// "Edit day" and "At home today" — the user's own changes, saved straight
// away. No AI is called from this file ($0).

import { createClient } from "@/lib/supabase/server";
import { getWeekStatus } from "@/lib/programs";
import { getUserTz } from "@/lib/goal-change";
import { todayLocal } from "@/lib/time";
import { resolveExerciseIds } from "@/lib/exercises";
import { LOAD_TYPES, type LoadType } from "@/lib/program-schema";
import { MAX_DAY_ITEMS, cleanItem, cleanName, describeDayEdit, parseRepRange, type DayItem, type DayItemInput } from "@/lib/day-edits";
import { asCategory, guessCategory, normalizeEquipment, type HomeEquipment } from "@/lib/home-swaps";

export type EditResult = { ok: true } | { ok: false; error: string };

export type LibraryExercise = {
  id: string;
  name: string;
  category: string | null;
  last: { value: number; type: LoadType | null } | null; // most recent logged load
};

// The user's exercise list + the last load they logged for each, for the swap
// picker. Loaded when the sheet opens so the Train page stays quick.
export async function getEditLibrary(): Promise<{ ok: true; exercises: LibraryExercise[] } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const [{ data: exRows }, { data: setRows }] = await Promise.all([
    supabase.from("exercises").select("id, name, category").eq("user_id", user.id).limit(500),
    supabase
      .from("set_logs")
      .select("exercise_id, actual_load_value, actual_load_type, created_at")
      .eq("user_id", user.id)
      .not("actual_load_value", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const last = new Map<string, { value: number; type: LoadType | null }>();
  for (const s of setRows ?? []) {
    const id = s.exercise_id as string;
    const v = Number(s.actual_load_value);
    if (last.has(id) || !Number.isFinite(v) || v <= 0) continue;
    const t = s.actual_load_type as string | null;
    last.set(id, { value: v, type: t && (LOAD_TYPES as readonly string[]).includes(t) ? (t as LoadType) : null });
  }
  return {
    ok: true,
    exercises: (exRows ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      category: (e.category as string | null) ?? guessCategory(e.name as string),
      last: last.get(e.id as string) ?? null,
    })),
  };
}

// Save a day's edited list.
//  week    → day_edits row for (day, this week): the full replacement list.
//  forward → program_exercises for the day are updated / added / removed to
//            match, and any "this week" edit for the day is cleared.
export async function saveDayEdits(
  programDayId: string,
  mode: "week" | "forward",
  rawItems: DayItemInput[]
): Promise<EditResult> {
  if (mode !== "week" && mode !== "forward") return { ok: false, error: "Pick this week or from now on." };
  if (typeof programDayId !== "string" || !programDayId) return { ok: false, error: "Pick a day first." };
  if (!Array.isArray(rawItems)) return { ok: false, error: "Nothing to save." };
  if (rawItems.length > MAX_DAY_ITEMS) return { ok: false, error: `Up to ${MAX_DAY_ITEMS} exercises a day.` };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  if (!status) return { ok: false, error: "No active program yet." };
  const day = status.days.find((d) => d.id === programDayId);
  if (!day) return { ok: false, error: "That day isn't in your current program. Refresh and try again." };
  if (day.type === "rest") return { ok: false, error: "Rest days don't have exercises to edit." };
  if (mode === "week" && status.weekEnded)
    return { ok: false, error: "This week has ended. Pick “From now on”, or start a new week first." };

  // The day's current plan rows (the only rows a source_id may point at).
  const { data: planRows } = await supabase
    .from("program_exercises")
    .select("id, exercise_id, coach_note, prescribed_sets, rep_scheme, suggested_load_value, suggested_load_type")
    .eq("user_id", user.id)
    .eq("program_day_id", programDayId);
  const planById = new Map((planRows ?? []).map((p) => [p.id as string, p]));

  // Names → the user's exercise ids (new names are added, matched by lower(name)).
  const wanted: { name: string; category: string | null }[] = [];
  for (const r of rawItems) {
    const name = cleanName(r?.name);
    if (!name) continue;
    wanted.push({ name, category: asCategory(r.category) ?? (r.activity === true ? "cardio" : guessCategory(name)) });
  }
  if (!wanted.length) return { ok: false, error: "Keep at least one exercise, or skip the day instead." };
  const idByLower = await resolveExerciseIds(supabase, user.id, wanted);

  const items: DayItem[] = [];
  const keys = new Set<string>();
  for (const r of rawItems) {
    const name = cleanName(r?.name);
    const id = name ? idByLower.get(name.toLowerCase()) : undefined;
    if (!id) continue;
    const it = cleanItem(r, id);
    if (!it || keys.has(it.key)) continue;
    keys.add(it.key);
    const src = it.source_id ? planById.get(it.source_id) : undefined;
    if (!src) it.source_id = null;
    // Coach notes come from the program, never from the browser; a swapped
    // exercise drops the old one's note.
    it.coach_note = src && (src.exercise_id as string) === it.exercise_id ? ((src.coach_note as string | null) ?? null) : null;
    if (mode === "forward") it.swapped_from = null;
    items.push(it);
  }
  if (!items.length) return { ok: false, error: "Those exercises couldn't be saved. Check the names and try again." };

  if (mode === "week") {
    const { error } = await supabase.from("day_edits").upsert(
      {
        user_id: user.id,
        program_id: status.program.id,
        program_day_id: programDayId,
        week_started_on: status.weekStartedOn,
        edits: items,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,program_day_id,week_started_on" }
    );
    if (error) {
      console.error(`[saveDayEdits week] ${error.message}`);
      return { ok: false, error: "Couldn't save your changes. Try again." };
    }
    return { ok: true };
  }

  // From now on. First, any coach proposal still waiting for an OK that
  // targets a row being swapped to another exercise or removed is dropped, so
  // approving it later can never write old numbers onto a different exercise.
  const kept0 = new Set<string>();
  const swappedIds: string[] = [];
  for (const it of items) {
    if (!it.source_id || kept0.has(it.source_id)) continue;
    kept0.add(it.source_id);
    const src = planById.get(it.source_id);
    if (src && (src.exercise_id as string) !== it.exercise_id) swappedIds.push(it.source_id);
  }
  const removedIds = Array.from(planById.keys()).filter((id) => !kept0.has(id));
  const staleIds = [...swappedIds, ...removedIds];
  if (staleIds.length) {
    const { data: pending } = await supabase
      .from("progression_proposals")
      .select("id")
      .eq("user_id", user.id)
      .eq("program_id", status.program.id)
      .eq("status", "pending");
    const pendingIds = (pending ?? []).map((p) => p.id as string);
    if (pendingIds.length) {
      const { error } = await supabase
        .from("proposal_items")
        .delete()
        .eq("user_id", user.id)
        .in("proposal_id", pendingIds)
        .in("program_exercise_id", staleIds);
      if (error) {
        console.error(`[saveDayEdits stale proposals] ${error.message}`);
        return { ok: false, error: "Couldn't save your changes. Try again." };
      }
    }
  }

  // What changed, in plain words, for the coach's log (before the plan moves).
  const nameIds = Array.from(new Set([...items.map((i) => i.exercise_id), ...(planRows ?? []).map((p) => p.exercise_id as string)]));
  const { data: nameRows } = await supabase.from("exercises").select("id, name").eq("user_id", user.id).in("id", nameIds);
  const nameOf = new Map((nameRows ?? []).map((e) => [e.id as string, e.name as string]));
  const changeLines = describeDayEdit(
    items,
    (planRows ?? []).map((p) => ({
      id: p.id as string,
      exercise_id: p.exercise_id as string,
      name: nameOf.get(p.exercise_id as string) ?? "Exercise",
      prescribed_sets: (p.prescribed_sets as number | null) ?? null,
      rep_scheme: (p.rep_scheme as string | null) ?? null,
      suggested_load_value: p.suggested_load_value == null ? null : Number(p.suggested_load_value),
      suggested_load_type: (p.suggested_load_type as LoadType | null) ?? null,
    }))
  );

  // Then: update kept rows, add new ones, then remove the rest.
  const row = (it: DayItem, position: number) => {
    const reps = parseRepRange(it.rep_scheme);
    return {
      exercise_id: it.exercise_id,
      position,
      prescribed_sets: it.prescribed_sets,
      rep_scheme: it.rep_scheme,
      rep_low: reps.low,
      rep_high: reps.high,
      suggested_load_value: it.suggested_load_value,
      suggested_load_type: it.suggested_load_type,
      target_rpe_low: it.target_rpe_low,
      target_rpe_high: it.target_rpe_high,
      coach_note: it.coach_note,
    };
  };
  let failed = 0;
  const kept = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.source_id && !kept.has(it.source_id)) {
      kept.add(it.source_id);
      const { error } = await supabase
        .from("program_exercises")
        .update(row(it, i + 1))
        .eq("id", it.source_id)
        .eq("user_id", user.id)
        .eq("program_day_id", programDayId);
      if (error) {
        console.error(`[saveDayEdits update] ${error.message}`);
        failed++;
      }
    } else {
      const { error } = await supabase
        .from("program_exercises")
        .insert({ user_id: user.id, program_day_id: programDayId, ...row(it, i + 1) });
      if (error) {
        console.error(`[saveDayEdits insert] ${error.message}`);
        failed++;
      }
    }
  }
  if (failed) return { ok: false, error: "Some changes didn't save. Nothing was removed — try again." };

  const removeIds = Array.from(planById.keys()).filter((id) => !kept.has(id));
  if (removeIds.length) {
    const { error } = await supabase
      .from("program_exercises")
      .delete()
      .eq("user_id", user.id)
      .eq("program_day_id", programDayId)
      .in("id", removeIds);
    if (error) {
      console.error(`[saveDayEdits delete] ${error.message}`);
      return { ok: false, error: "Saved, but couldn't remove the exercises you took out. Try again." };
    }
  }
  // The plan now matches what you edited; a separate "this week" list would hide it.
  await supabase
    .from("day_edits")
    .delete()
    .eq("user_id", user.id)
    .eq("program_day_id", programDayId)
    .eq("week_started_on", status.weekStartedOn);

  // Log it for the weekly review ("Dave changed the plan himself: …").
  if (changeLines.length) {
    const dayLabel = `Day ${day.day_index}${day.label ? ` (${day.label})` : ""}`;
    const summary = `${dayLabel}: ${changeLines.join("; ")}`.replace(/[\r\n\t]+/g, " ");
    const { error: logErr } = await supabase.from("program_edit_log").insert({
      user_id: user.id,
      program_id: status.program.id,
      program_day_id: programDayId,
      summary: summary.length > 300 ? `${summary.slice(0, 299).trimEnd()}…` : summary,
    });
    if (logErr) console.error(`[saveDayEdits log] ${logErr.message}`);
  }
  return { ok: true };
}

// Drop this week's changes for a day: back to the plan.
export async function resetDayEdits(programDayId: string): Promise<EditResult> {
  if (typeof programDayId !== "string" || !programDayId) return { ok: false, error: "Pick a day first." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  if (!status) return { ok: false, error: "No active program yet." };
  const { error } = await supabase
    .from("day_edits")
    .delete()
    .eq("user_id", user.id)
    .eq("program_id", status.program.id)
    .eq("program_day_id", programDayId)
    .eq("week_started_on", status.weekStartedOn);
  if (error) {
    console.error(`[resetDayEdits] ${error.message}`);
    return { ok: false, error: "Couldn't reset this week. Try again." };
  }
  return { ok: true };
}

// "At home today" on / off for the user's local today.
export async function setAtHomeToday(on: boolean): Promise<EditResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const tz = await getUserTz(supabase, user.id);
  const today = todayLocal(tz);
  if (on === true) {
    const { error } = await supabase
      .from("at_home_days")
      .upsert({ user_id: user.id, local_date: today }, { onConflict: "user_id,local_date", ignoreDuplicates: true });
    if (error) {
      console.error(`[setAtHomeToday on] ${error.message}`);
      return { ok: false, error: "Couldn't switch to home. Try again." };
    }
    return { ok: true };
  }
  const { error } = await supabase.from("at_home_days").delete().eq("user_id", user.id).eq("local_date", today);
  if (error) {
    console.error(`[setAtHomeToday off] ${error.message}`);
    return { ok: false, error: "Couldn't switch back to the gym plan. Try again." };
  }
  return { ok: true };
}

// What the user has at home (profiles.home_equipment).
export async function saveHomeEquipment(raw: HomeEquipment): Promise<EditResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const eq = normalizeEquipment(raw);
  const { error } = await supabase.from("profiles").update({ home_equipment: eq }).eq("id", user.id);
  if (error) {
    console.error(`[saveHomeEquipment] ${error.message}`);
    return { ok: false, error: "Couldn't save your equipment. Try again." };
  }
  return { ok: true };
}
