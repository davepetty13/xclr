import { createClient } from "@/lib/supabase/server";
import { epley1RM } from "@/lib/training";
import { formatLoad, type LoadType } from "@/lib/program-schema";

export default async function WorkoutHistoryPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sessions } = await supabase
    .from("workout_sessions")
    .select("id, performed_at, type, my_note")
    .eq("user_id", user.id)
    .order("performed_at", { ascending: false })
    .limit(20);
  const sessionList = sessions ?? [];

  const { data: allSets } = await supabase
    .from("set_logs")
    .select("session_id, exercise_id, actual_load_value, actual_load_type, actual_reps, actual_rpe")
    .eq("user_id", user.id);
  const { data: exRows } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);
  const nameById = new Map<string, string>();
  for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);

  // All-time best est-1RM per exercise → which session holds it (PR).
  const bestByEx = new Map<string, { est: number; sessionId: string }>();
  for (const s of allSets ?? []) {
    const est = epley1RM(s.actual_load_value as number | null, s.actual_reps as number | null);
    if (est == null) continue;
    const exId = s.exercise_id as string;
    const cur = bestByEx.get(exId);
    if (!cur || est > cur.est)
      bestByEx.set(exId, { est, sessionId: s.session_id as string });
  }
  const prPair = new Set<string>();
  for (const [exId, best] of Array.from(bestByEx.entries()))
    prPair.add(`${best.sessionId}:${exId}`);

  // Group sets by session → exercise.
  type SetRow = {
    exId: string;
    load: number | null;
    type: string | null;
    reps: number | null;
    rpe: number | null;
  };
  const bySession = new Map<string, SetRow[]>();
  for (const s of allSets ?? []) {
    const list = bySession.get(s.session_id as string) ?? [];
    list.push({
      exId: s.exercise_id as string,
      load: s.actual_load_value as number | null,
      type: s.actual_load_type as string | null,
      reps: s.actual_reps as number | null,
      rpe: s.actual_rpe as number | null,
    });
    bySession.set(s.session_id as string, list);
  }

  if (!sessionList.length)
    return (
      <p className="rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
        No sessions yet. Log one from Today and it shows up here.
      </p>
    );

  return (
    <div className="space-y-3">
      {sessionList.map((sess) => {
        const sets = bySession.get(sess.id as string) ?? [];
        const volume = sets.reduce(
          (sum, r) => sum + (r.load != null && r.reps != null ? r.load * r.reps : 0),
          0
        );
        // Group by exercise for a compact summary.
        const byEx = new Map<string, SetRow[]>();
        for (const r of sets) {
          const list = byEx.get(r.exId) ?? [];
          list.push(r);
          byEx.set(r.exId, list);
        }
        const date = new Date(sess.performed_at as string).toLocaleDateString(
          undefined,
          { weekday: "short", month: "short", day: "numeric" }
        );
        return (
          <div key={sess.id as string} className="rounded-tile border border-line bg-card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold capitalize text-ink">
                {(sess.type as string | null) ?? "Session"} · {date}
              </span>
              {volume > 0 ? (
                <span className="tnum text-xs font-medium text-muted">
                  {Math.round(volume)} kg vol
                </span>
              ) : null}
            </div>
            <ul className="mt-2 space-y-1.5">
              {Array.from(byEx.entries()).map(([exId, rows]) => {
                const isPr = prPair.has(`${sess.id as string}:${exId}`);
                const summary = rows
                  .map((r) => {
                    const load = formatLoad(r.load, r.type as LoadType | null);
                    return `${load}${r.reps != null ? ` × ${r.reps}` : ""}`;
                  })
                  .filter((x) => x.trim())
                  .join(", ");
                return (
                  <li key={exId} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-ink">
                      {nameById.get(exId) ?? "Exercise"}
                      {isPr ? (
                        <span className="ml-1 rounded-chip bg-green-soft px-1.5 py-0.5 text-[10px] font-semibold text-green">
                          PR
                        </span>
                      ) : null}
                    </span>
                    <span className="tnum shrink-0 text-sm text-muted">{summary}</span>
                  </li>
                );
              })}
            </ul>
            {sess.my_note ? (
              <p className="mt-2 text-sm font-medium text-muted">
                &ldquo;{sess.my_note as string}&rdquo;
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
