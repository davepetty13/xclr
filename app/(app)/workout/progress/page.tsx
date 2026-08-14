import { createClient } from "@/lib/supabase/server";
import { epley1RM, orientSeries, type ProgressPoint } from "@/lib/training";
import {
  ProgressView,
  type ProgressExercise,
} from "@/components/app/progress-view";

export default async function WorkoutProgressPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: setLogs } = await supabase
    .from("set_logs")
    .select("exercise_id, actual_load_value, actual_reps, actual_load_type, session_id")
    .eq("user_id", user.id);
  const { data: sessions } = await supabase
    .from("workout_sessions")
    .select("id, performed_at")
    .eq("user_id", user.id);
  const { data: exRows } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);

  const dateBySession = new Map<string, string>();
  for (const s of sessions ?? [])
    dateBySession.set(s.id as string, (s.performed_at as string).slice(0, 10));
  const nameById = new Map<string, string>();
  for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);

  // Group set logs by exercise.
  type Group = {
    typeCounts: Record<string, number>;
    sets: { day: string; load: number | null; reps: number | null; type: string | null }[];
  };
  const groups = new Map<string, Group>();
  for (const s of setLogs ?? []) {
    const exId = s.exercise_id as string;
    const day = dateBySession.get(s.session_id as string);
    if (!day) continue;
    const g = groups.get(exId) ?? { typeCounts: {}, sets: [] };
    const type = (s.actual_load_type as string | null) ?? "none";
    g.typeCounts[type] = (g.typeCounts[type] ?? 0) + 1;
    g.sets.push({
      day,
      load: s.actual_load_value as number | null,
      reps: s.actual_reps as number | null,
      type: s.actual_load_type as string | null,
    });
    groups.set(exId, g);
  }

  const exercises: ProgressExercise[] = [];
  for (const [exId, g] of Array.from(groups.entries())) {
    const predominant =
      Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    const inverted = predominant === "assist_kg";

    // Best value per day: assist → lowest assist load; else → highest est 1RM.
    const byDay = new Map<string, number[]>();
    for (const s of g.sets) {
      const v = inverted ? s.load : epley1RM(s.load, s.reps);
      if (v == null) continue;
      const list = byDay.get(s.day) ?? [];
      list.push(v);
      byDay.set(s.day, list);
    }
    const rawPoints: ProgressPoint[] = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, vals]) => ({
        day,
        value: inverted ? Math.min(...vals) : Math.max(...vals),
      }));
    if (!rawPoints.length) continue;

    const oriented = orientSeries(rawPoints, inverted ? "assist_kg" : predominant);
    exercises.push({
      id: exId,
      name: nameById.get(exId) ?? "Exercise",
      inverted: oriented.inverted,
      unitLabel: inverted ? "Assist load (kg)" : "Estimated 1RM (kg)",
      values: oriented.points.map((p) => p.value),
    });
  }

  exercises.sort((a, b) => a.name.localeCompare(b.name));

  return <ProgressView exercises={exercises} />;
}
