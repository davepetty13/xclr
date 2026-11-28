import { prettyDate, todayLocal } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import { getDayPlan, getWeekStatus } from "@/lib/programs";
import { getUserTz } from "@/lib/goal-change";
import { LogSession, type LogExercise } from "@/components/app/log-session";
import { homeSwapFor, normalizeEquipment } from "@/lib/home-swaps";
import { SkipDay } from "./skip-day";
import { DayPicker } from "./day-picker";
import { UnsavedDrafts } from "./unsaved-drafts";
import { NewWeek } from "./new-week";
import { EditDay } from "./edit-day";
import { AtHome } from "./at-home";
import { AddActivity } from "./add-activity";
import { getCurrentUser } from "@/lib/session";

// "Get my coach's review" (generateWeeklyReview) can be invoked from this page
// after starting a new week; route-segment maxDuration governs the Server
// Actions it calls. Must match AI_BUDGET_SECONDS.review.
export const maxDuration = 300;

export default async function WorkoutTodayPage({
  searchParams,
}: {
  searchParams: { day?: string; add?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  if (!status)
    return (
      <div className="space-y-3">
        <p className="glass p-4 text-sm font-medium text-muted">
          No active program yet.
        </p>
        <AddActivity today={todayLocal(tz)} startOpen={searchParams.add === "activity"} />
      </div>
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

  // This week's list for the day ("This week only" edits win over the plan),
  // plus At home today + home equipment.
  const today = todayLocal(tz);
  const [dayPlan, { data: homeRow }, { data: profileRow }] = await Promise.all([
    getDayPlan(supabase, user.id, status.program.id, day.id, status.weekStartedOn),
    supabase
      .from("at_home_days")
      .select("local_date")
      .eq("user_id", user.id)
      .eq("local_date", today)
      .maybeSingle(),
    supabase.from("profiles").select("home_equipment").eq("id", user.id).maybeSingle(),
  ]);
  const atHome = !!homeRow;
  const equipmentSet = profileRow?.home_equipment != null;
  const equipment = normalizeEquipment(profileRow?.home_equipment);

  let swappedCount = 0;
  const exercises: LogExercise[] = dayPlan.items.map((it) => {
    const gym: LogExercise = {
      rowKey: it.key,
      exerciseId: it.exercise_id,
      name: it.name,
      category: it.category,
      activity: it.activity,
      prescribed_sets: it.prescribed_sets,
      rep_scheme: it.rep_scheme,
      suggested_load_value: it.suggested_load_value,
      suggested_load_type: it.suggested_load_type,
      target_rpe_low: it.target_rpe_low,
      target_rpe_high: it.target_rpe_high,
      coach_note: it.coach_note,
      subline: it.activity
        ? "Extra activity"
        : it.swapped_from
          ? `This week instead of ${it.swapped_from}`
          : dayPlan.weekEdit && !it.source_id
            ? "Added this week"
            : null,
    };
    if (!atHome || it.activity) return gym;
    const h = homeSwapFor(
      { name: it.name, category: it.category, load_value: it.suggested_load_value, load_type: it.suggested_load_type },
      equipment
    );
    if (h.same)
      return {
        ...gym,
        suggested_load_value: h.load_value,
        subline: `Same as gym${h.tip ? ` · ${h.tip}` : ""}`,
      };
    swappedCount++;
    return {
      ...gym,
      rowKey: `home:${it.key}`,
      exerciseId: "", // found / added by name when the session is saved
      name: h.name,
      category: h.category,
      suggested_load_value: h.load_value,
      suggested_load_type: h.load_type,
      coach_note: null, // the gym exercise's note doesn't apply
      homeFor: it.name,
      homeTip: h.tip,
      subline: null,
    };
  });
  const dayName = `Day ${day.day_index}${day.label ? ` · ${day.label}` : ""}`;

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
              {status.skippedCount ? ` · ${status.skippedCount} skipped` : ""}
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
      {status.weekEnded ? (
        <p className="px-1 text-sm font-medium text-muted">
          Week {status.week} ended on {prettyDate(status.weekEndsOn)}. Pick how the new week starts.
        </p>
      ) : status.weekComplete ? (
        <p className="px-1 text-sm font-medium text-muted">
          Every training day is done. Nice week.
        </p>
      ) : status.shortWeek ? (
        <p className="px-1 text-sm font-medium text-muted">
          Short week: {status.plannedCount} training days fit before Sunday, so some days sit this one out.
        </p>
      ) : !status.nextDay ? (
        <p className="px-1 text-sm font-medium text-muted">
          No training days in this program.
        </p>
      ) : null}

      <NewWeek week={status.week} weekComplete={status.weekComplete} weekEnded={status.weekEnded} />

      <UnsavedDrafts
        userId={user.id}
        currentDayId={day.id}
        days={dayList.map((d) => ({ id: d.id, name: `Day ${d.day_index}${d.label ? ` · ${d.label}` : ""}` }))}
      />

      {/* Day selector: compact dropdown + status beside it */}
      <DayPicker
        selectedId={day.id}
        days={dayList.map((d) => ({
          id: d.id,
          name: `Day ${d.day_index}${d.label ? ` · ${d.label}` : ""}`,
          status: d.done
            ? "done"
            : d.skipped
              ? "skipped"
              : d.type === "rest"
                ? "rest"
                : !d.inWeek
                  ? "off"
                  : null,
        }))}
        aside={
          day.type !== "rest" ? (
            <EditDay
              dayId={day.id}
              dayName={dayName}
              items={dayPlan.items}
              weekEdit={dayPlan.weekEdit}
              weekEnded={status.weekEnded}
            />
          ) : null
        }
      />

      {day.type !== "rest" && dayPlan.items.some((it) => !it.activity) ? (
        <AtHome
          on={atHome}
          equipment={equipment}
          equipmentSet={equipmentSet}
          swappedCount={swappedCount}
          dayName={dayName}
          items={dayPlan.items}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <h2 className="px-1 font-display text-lg font-bold tracking-[-0.01em] text-ink">
          {dayName}
          {dayPlan.weekEdit ? <span className="mark mark-amber ml-2 align-middle font-sans">Changed this week</span> : null}
        </h2>
        <AddActivity today={today} startOpen={searchParams.add === "activity"} />
      </div>

      {day.type !== "rest" && day.inWeek && !day.done && !status.weekEnded ? (
        <SkipDay
          dayId={day.id}
          dayName={`Day ${day.day_index}`}
          skipId={day.skipId}
          skipNote={day.skipNote}
        />
      ) : null}

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
          home={atHome}
        />
      )}
    </div>
  );
}
