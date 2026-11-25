import type { createClient } from "@/lib/supabase/server";
import { localDate, localDayStartISO, todayLocal } from "@/lib/time";

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
};

export type WeekStatus = {
  program: ProgramRow;
  week: number;
  weekStartedOn: string; // local YYYY-MM-DD
  weekStartISO: string; // UTC instant the week started (local midnight)
  days: WeekDay[];
  doneCount: number;
  plannedCount: number; // non-rest days
  nextDay: WeekDay | null; // first non-rest day not done yet this week
  weekComplete: boolean;
};

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

  // Days and this week's sessions at the same time (was one after the other).
  const [{ data: dayRows }, { data: sessions }] = await Promise.all([
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
  ]);
  const rows = dayRows ?? [];
  const dayIds = new Set(rows.map((d) => d.id as string));
  const doneIds = new Set<string>();
  for (const x of sessions ?? []) {
    const id = x.program_day_id as string | null;
    if (id && dayIds.has(id)) doneIds.add(id);
  }

  const days: WeekDay[] = rows.map((d) => ({
    id: d.id as string,
    day_index: d.day_index as number,
    label: (d.label as string | null) ?? null,
    type: (d.type as string | null) ?? null,
    done: doneIds.has(d.id as string),
  }));
  const training = days.filter((d) => d.type !== "rest");
  const doneCount = training.filter((d) => d.done).length;
  const nextDay = training.find((d) => !d.done) ?? null;

  return {
    program,
    week,
    weekStartedOn,
    weekStartISO,
    days,
    doneCount,
    plannedCount: training.length,
    nextDay,
    weekComplete: training.length > 0 && nextDay == null,
  };
}
