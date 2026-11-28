import type { createClient } from "@/lib/supabase/server";
import { addDays, localDate, localDayStartISO, todayLocal } from "@/lib/time";
import { parseDayEdits, type DayItem } from "@/lib/day-edits";
import { asCategory, guessCategory } from "@/lib/home-swaps";
import type { LoadType } from "@/lib/program-schema";

type Supa = ReturnType<typeof createClient>;

export type ProgramRow = {
  id: string;
  name: string | null;
  goal: string | null;
  active: boolean;
};

// The user's current active program, if any (newest wins). RLS scopes the query
// to the caller, and we also filter by user_id explicitly.
export async function getActiveProgram(
  supabase: Supa,
  userId: string
): Promise<ProgramRow | null> {
  const { data } = await supabase
    .from("programs")
    .select("id, name, goal, active")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ProgramRow | null) ?? null;
}

export async function hasActiveProgram(
  supabase: Supa,
  userId: string
): Promise<boolean> {
  return (await getActiveProgram(supabase, userId)) != null;
}

export type WeekDay = {
  id: string;
  day_index: number;
  label: string | null;
  type: string | null;
  done: boolean;
  inWeek: boolean; // planned for this (possibly short) calendar week
  skipped: boolean; // skipped this week (and not logged after all)
  skipId: string | null;
  skipNote: string | null;
};

export type WeekStatus = {
  program: ProgramRow;
  week: number;
  weekStartedOn: string; // local YYYY-MM-DD
  weekStartISO: string; // UTC instant the week started (local midnight)
  days: WeekDay[];
  doneCount: number;
  skippedCount: number;
  plannedCount: number; // training days planned this week (fits the days left)
  nextDay: WeekDay | null; // first planned training day not done yet this week
  weekComplete: boolean; // all planned days done, or the week (Sunday) has passed
  weekEndsOn: string; // local YYYY-MM-DD, the Sunday that ends this week
  weekEnded: boolean; // today is past weekEndsOn → time to choose Repeat / Fresh
  shortWeek: boolean; // started mid-week, so some training days were dropped
};

// Weeks run Monday–Sunday (Dave's choice, Nov 26 2026). The Sunday on or after
// a local date ends its week.
export function weekEndFor(dateISO: string): string {
  const dow = new Date(`${dateISO}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateISO, (7 - dow) % 7);
}

// Lower = keep first when a mid-week start leaves fewer days than the plan has.
// Main lifting days stay; cardio next; recovery / light days drop first.
function keepPriority(type: string | null): number {
  if (type === "strength") return 0;
  if (type === "cardio") return 1;
  if (type === "recovery") return 3;
  return 2;
}

// Pick which training days fit in `slots` days: days already done always stay,
// then by priority, ties by program order. Returned ids keep program order.
export function fitWeek(
  training: { id: string; type: string | null; done: boolean }[],
  slots: number
): Set<string> {
  if (training.length <= slots) return new Set(training.map((d) => d.id));
  const ranked = training
    .map((d, i) => ({ d, i }))
    .sort(
      (a, b) =>
        Number(b.d.done) - Number(a.d.done) ||
        keepPriority(a.d.type) - keepPriority(b.d.type) ||
        a.i - b.i
    );
  return new Set(ranked.slice(0, Math.max(slots, 0)).map((x) => x.d.id));
}

// Where the user is in their training week. A day is "done" once a session
// for it was logged on or after local midnight of week_started_on. Weeks only
// advance when the user taps Repeat / Fresh — never by the calendar.
export async function getWeekStatus(
  supabase: Supa,
  userId: string,
  tz: string
): Promise<WeekStatus | null> {
  // One query for the active program + its week fields (was two).
  const { data: prog } = await supabase
    .from("programs")
    .select("id, name, goal, active, current_week, week_started_on, week_start, created_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prog) return null;
  const program: ProgramRow = {
    id: prog.id as string,
    name: (prog.name as string | null) ?? null,
    goal: (prog.goal as string | null) ?? null,
    active: true,
  };

  const week = Number(prog.current_week) || 1;
  const weekStartedOn =
    (prog.week_started_on as string | null) ??
    (prog.week_start as string | null) ??
    (prog.created_at ? localDate(tz, new Date(prog.created_at as string)) : todayLocal(tz));
  const weekStartISO = localDayStartISO(weekStartedOn, tz);

  // Days, this week's sessions and skips at the same time.
  const [{ data: dayRows }, { data: sessions }, { data: skipRows }] = await Promise.all([
    supabase
      .from("program_days")
      .select("id, day_index, label, type")
      .eq("user_id", userId)
      .eq("program_id", program.id)
      .order("day_index", { ascending: true }),
    supabase
      .from("workout_sessions")
      .select("program_day_id")
      .eq("user_id", userId)
      .not("program_day_id", "is", null)
      .gte("performed_at", weekStartISO),
    supabase
      .from("day_skips")
      .select("id, program_day_id, note")
      .eq("user_id", userId)
      .eq("program_id", program.id)
      .eq("week_started_on", weekStartedOn),
  ]);
  const skipByDay = new Map<string, { id: string; note: string | null }>();
  for (const k of skipRows ?? [])
    skipByDay.set(k.program_day_id as string, { id: k.id as string, note: (k.note as string | null) ?? null });
  const rows = dayRows ?? [];
  const dayIds = new Set(rows.map((d) => d.id as string));
  const doneIds = new Set<string>();
  for (const x of sessions ?? []) {
    const id = x.program_day_id as string | null;
    if (id && dayIds.has(id)) doneIds.add(id);
  }

  const base = rows.map((d) => ({
    id: d.id as string,
    day_index: d.day_index as number,
    label: (d.label as string | null) ?? null,
    type: (d.type as string | null) ?? null,
    done: doneIds.has(d.id as string),
  }));

  // Fit the plan into the days left before Sunday (Thursday start → 4 days).
  const weekEndsOn = weekEndFor(weekStartedOn);
  const today = todayLocal(tz);
  const slots =
    Math.round((Date.parse(`${weekEndsOn}T00:00:00Z`) - Date.parse(`${weekStartedOn}T00:00:00Z`)) / 86_400_000) + 1;
  const trainingBase = base.filter((d) => d.type !== "rest");
  const keep = fitWeek(trainingBase, slots);
  const days: WeekDay[] = base.map((d) => {
    const skip = d.done ? undefined : skipByDay.get(d.id);
    return {
      ...d,
      inWeek: d.type !== "rest" && keep.has(d.id),
      skipped: !!skip,
      skipId: skip?.id ?? null,
      skipNote: skip?.note ?? null,
    };
  });

  const planned = days.filter((d) => d.inWeek);
  const doneCount = planned.filter((d) => d.done).length;
  const skippedCount = planned.filter((d) => d.skipped).length;
  const weekEnded = today > weekEndsOn;
  const nextDay = weekEnded ? null : planned.find((d) => !d.done && !d.skipped) ?? null;

  return {
    program,
    week,
    weekStartedOn,
    weekStartISO,
    days,
    doneCount,
    skippedCount,
    plannedCount: planned.length,
    nextDay,
    weekComplete: weekEnded || (planned.length > 0 && nextDay == null),
    weekEndsOn,
    weekEnded,
    shortWeek: planned.length < trainingBase.length,
  };
}

// ── One day's exercise list for this week ──────────────────────────────────
// The program's prescription, unless a "This week only" edit (day_edits) exists
// for this day + week — then that full replacement list wins. The Train page
// (and so logging) reads through here.

export type DayPlan = {
  items: DayItem[]; // what to do this week
  plan: DayItem[]; // the program's own list (no week edit applied)
  weekEdit: boolean; // items came from a "This week only" edit
};

export async function getDayPlan(
  supabase: Supa,
  userId: string,
  programId: string,
  dayId: string,
  weekStartedOn: string
): Promise<DayPlan> {
  const [{ data: pe }, { data: exRows }, { data: edit }] = await Promise.all([
    supabase
      .from("program_exercises")
      .select(
        "id, exercise_id, position, prescribed_sets, rep_scheme, suggested_load_value, suggested_load_type, target_rpe_low, target_rpe_high, coach_note"
      )
      .eq("user_id", userId)
      .eq("program_day_id", dayId)
      .order("position", { ascending: true }),
    supabase.from("exercises").select("id, name, category").eq("user_id", userId),
    supabase
      .from("day_edits")
      .select("edits")
      .eq("user_id", userId)
      .eq("program_id", programId)
      .eq("program_day_id", dayId)
      .eq("week_started_on", weekStartedOn)
      .maybeSingle(),
  ]);
  const exById = new Map<string, { name: string; category: string | null }>();
  for (const e of exRows ?? [])
    exById.set(e.id as string, { name: e.name as string, category: (e.category as string | null) ?? null });

  const plan: DayItem[] = (pe ?? []).map((p) => {
    const ex = exById.get(p.exercise_id as string);
    const name = ex?.name ?? "Exercise";
    return {
      key: p.id as string,
      source_id: p.id as string,
      exercise_id: p.exercise_id as string,
      name,
      category: asCategory(ex?.category) ?? guessCategory(name),
      activity: false,
      prescribed_sets: (p.prescribed_sets as number | null) ?? null,
      rep_scheme: (p.rep_scheme as string | null) ?? null,
      suggested_load_value: p.suggested_load_value == null ? null : Number(p.suggested_load_value),
      suggested_load_type: (p.suggested_load_type as LoadType | null) ?? null,
      target_rpe_low: p.target_rpe_low == null ? null : Number(p.target_rpe_low),
      target_rpe_high: p.target_rpe_high == null ? null : Number(p.target_rpe_high),
      coach_note: (p.coach_note as string | null) ?? null,
      swapped_from: null,
    };
  });

  if (!edit) return { items: plan, plan, weekEdit: false };
  // Prefer the exercise's current name (it may have been renamed since).
  const items = parseDayEdits(edit.edits).map((it) => {
    const ex = exById.get(it.exercise_id);
    return ex ? { ...it, name: ex.name } : it;
  });
  return { items, plan, weekEdit: true };
}
