import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveProgram } from "@/lib/programs";
import { todaysDayIndex } from "@/lib/training";
import { LogSession, type LogExercise } from "@/components/app/log-session";
import type { LoadType } from "@/lib/program-schema";

export default async function WorkoutTodayPage({
  searchParams,
}: {
  searchParams: { day?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const program = await getActiveProgram(supabase, user.id);
  if (!program)
    return (
      <p className="rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
        No active program yet.
      </p>
    );

  const { data: progRow } = await supabase
    .from("programs")
    .select("week_start")
    .eq("id", program.id)
    .single();

  const { data: days } = await supabase
    .from("program_days")
    .select("id, day_index, label, type")
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .order("day_index", { ascending: true });
  const dayList = days ?? [];
  if (!dayList.length)
    return (
      <p className="rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
        Your program has no days.
      </p>
    );

  const defaultIdx = todaysDayIndex(
    (progRow?.week_start as string | null) ?? null,
    dayList.length
  );
  const selectedId =
    searchParams.day && dayList.some((d) => d.id === searchParams.day)
      ? searchParams.day
      : (dayList[defaultIdx]?.id as string);
  const day = dayList.find((d) => d.id === selectedId) ?? dayList[0];

  const { data: pe } = await supabase
    .from("program_exercises")
    .select(
      "id, exercise_id, position, prescribed_sets, rep_scheme, suggested_load_value, suggested_load_type, target_rpe_low, target_rpe_high, coach_note"
    )
    .eq("user_id", user.id)
    .eq("program_day_id", day.id)
    .order("position", { ascending: true });

  const { data: exRows } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);
  const nameById = new Map<string, string>();
  for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);

  const exercises: LogExercise[] = (pe ?? []).map((p) => ({
    programExerciseId: p.id as string,
    exerciseId: p.exercise_id as string,
    name: nameById.get(p.exercise_id as string) ?? "Exercise",
    prescribed_sets: p.prescribed_sets as number | null,
    rep_scheme: p.rep_scheme as string | null,
    suggested_load_value: p.suggested_load_value as number | null,
    suggested_load_type: p.suggested_load_type as LoadType | null,
    target_rpe_low: p.target_rpe_low as number | null,
    target_rpe_high: p.target_rpe_high as number | null,
    coach_note: p.coach_note as string | null,
  }));

  return (
    <div className="space-y-5">
      {/* Day selector */}
      <div className="flex flex-wrap gap-2">
        {dayList.map((d) => {
          const active = d.id === day.id;
          return (
            <Link
              key={d.id}
              href={`/workout?day=${d.id}`}
              className={`rounded-chip border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-green bg-green text-card"
                  : "border-line bg-card text-ink"
              }`}
            >
              Day {d.day_index as number} · {d.label as string}
            </Link>
          );
        })}
      </div>

      {day.type === "rest" || exercises.length === 0 ? (
        <p className="rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
          {day.type === "rest"
            ? "Rest day — recover well. This counts too."
            : "No exercises prescribed for this day."}
        </p>
      ) : (
        <LogSession
          userId={user.id}
          dayId={day.id as string}
          type={(day.type as string | null) ?? null}
          exercises={exercises}
        />
      )}
    </div>
  );
}
