import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWeekStatus } from "@/lib/programs";
import { getUserTz } from "@/lib/goal-change";
import { LogSession, type LogExercise } from "@/components/app/log-session";
import type { LoadType } from "@/lib/program-schema";
import { NewWeek } from "./new-week";

// "Get my coach's review" (generateWeeklyReview) can be invoked from this page
// after starting a new week; route-segment maxDuration governs the Server
// Actions it calls. Must match AI_BUDGET_SECONDS.review.
export const maxDuration = 300;

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

  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  if (!status)
    return (
      <p className="glass p-4 text-sm font-medium text-muted">
        No active program yet.
      </p>
    );

  const dayList = status.days;
  if (!dayList.length)
    return (
      <p className="glass p-4 text-sm font-medium text-muted">
        Your program has no days.
      </p>
    );

  // Default day = the next unfinished training day this week.
  const selectedId =
    searchParams.day && dayList.some((d) => d.id === searchParams.day)
      ? searchParams.day
      : (status.nextDay ?? dayList[0]).id;
  const day = dayList.find((d) => d.id === selectedId) ?? dayList[0];

  // Average RPE across this week's logged sets.
  const { data: weekSessions } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", user.id)
    .gte("performed_at", status.weekStartISO);
  let avgRpe: number | null = null;
  const weekSessionIds = (weekSessions ?? []).map((w) => w.id as string);
  if (weekSessionIds.length) {
    const { data: rpeRows } = await supabase
      .from("set_logs")
      .select("actual_rpe")
      .eq("user_id", user.id)
      .in("session_id", weekSessionIds)
      .not("actual_rpe", "is", null);
    const vals = (rpeRows ?? []).map((r) => Number(r.actual_rpe)).filter((n) => Number.isFinite(n) && n > 0);
    if (vals.length) avgRpe = Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10;
  }

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

  const nextLabel = status.nextDay
    ? `Day ${status.nextDay.day_index}`
    : status.weekComplete
      ? "Done"
      : "—";

  return (
    <div className="space-y-3">
      {/* Week status — the one dark band on this screen */}
      <section aria-label="This week" className="band grid grid-cols-3">
        <div className="band-edge px-3.5 py-3">
          <p className="text-[11px] text-band-label">Week {status.week}</p>
          <p className="tnum font-display text-[19px] font-bold">
            {status.doneCount}
            <span className="text-xs font-normal text-band-secondary">
              {" "}
              / {status.plannedCount} done
            </span>
          </p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">Next</p>
          <p className="tnum font-display text-[19px] font-bold">{nextLabel}</p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">Avg RPE</p>
          <p className="tnum font-display text-[19px] font-bold">{avgRpe ?? "—"}</p>
        </div>
      </section>
      {status.weekComplete ? (
        <p className="px-1 text-sm font-medium text-muted">
          Every training day is done. Nice week.
        </p>
      ) : !status.nextDay ? (
        <p className="px-1 text-sm font-medium text-muted">
          No training days in this program.
        </p>
      ) : null}

      <NewWeek week={status.week} weekComplete={status.weekComplete} />

      {/* Day selector */}
      <nav aria-label="Program days" className="flex flex-wrap gap-2">
        {dayList.map((d) => {
          const active = d.id === day.id;
          return (
            <Link
              key={d.id}
              href={`/workout?day=${d.id}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-control px-3 text-xs font-semibold ${
                active
                  ? "bg-ink text-card"
                  : "border border-hairline bg-card text-ink"
              }`}
            >
              Day {d.day_index}
              {d.label ? ` · ${d.label}` : ""}
              {d.done ? (
                <span className={`ml-1 ${active ? "text-green-on-dark" : "text-green"}`}>
                  · done
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-baseline justify-between px-1 pt-1">
        <h2 className="font-display text-lg font-bold tracking-[-0.01em] text-ink">
          Day {day.day_index}
          {day.label ? ` · ${day.label}` : ""}
        </h2>
        {day.done ? <span className="mark mark-green">Done</span> : null}
      </div>

      {day.type === "rest" || exercises.length === 0 ? (
        <p className="glass p-4 text-sm font-medium text-muted">
          {day.type === "rest"
            ? "Rest day — recover well. This counts too."
            : "No exercises prescribed for this day."}
        </p>
      ) : (
        <LogSession
          userId={user.id}
          dayId={day.id}
          type={day.type}
          exercises={exercises}
        />
      )}
    </div>
  );
}
