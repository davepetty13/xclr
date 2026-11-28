import { createClient } from "@/lib/supabase/server";
import { getUserTz } from "@/lib/goal-change";
import { epley1RM } from "@/lib/training";
import { formatLoad, type LoadType } from "@/lib/program-schema";
import { getCurrentUser } from "@/lib/session";
import { loadShareContext, sessionShare } from "@/lib/share-data";
import { ShareButton } from "@/components/app/share-sheet";

export default async function WorkoutHistoryPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;
  const tz = await getUserTz(supabase, user.id);

  const { data: sessions } = await supabase
    .from("workout_sessions")
    .select("id, performed_at, type, my_note")
    .eq("user_id", user.id)
    .order("performed_at", { ascending: false })
    .limit(20);
  const sessionList = sessions ?? [];
  // Share-card numbers for each listed session (plain data to the client).
  const shareCtx = sessionList.length ? await loadShareContext(supabase, user.id) : null;

  const { data: allSets } = await supabase
    .from("set_logs")
    .select("session_id, exercise_id, actual_load_value, actual_load_type, actual_reps, actual_rpe")
    .eq("user_id", user.id);
  const { data: exRows } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);
  // Extra activities (+ Add activity): minutes / effort / kcal live on the
  // session. Fetched apart so History still loads if migration 007 is missing.
  const activityIds = sessionList.filter((s) => s.type === "activity").map((s) => s.id as string);
  const activityInfo = new Map<string, { minutes: number | null; effort: string | null; kcal: number | null }>();
  if (activityIds.length) {
    const { data: actRows } = await supabase
      .from("workout_sessions")
      .select("id, duration_min, effort, kcal")
      .eq("user_id", user.id)
      .in("id", activityIds);
    for (const a of actRows ?? [])
      activityInfo.set(a.id as string, {
        minutes: (a.duration_min as number | null) ?? null,
        effort: (a.effort as string | null) ?? null,
        kcal: (a.kcal as number | null) ?? null,
      });
  }
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
      <p className="glass p-4 text-sm font-medium text-muted">
        No sessions yet. Log one from Today and it shows up here.
      </p>
    );

  return (
    <div className="space-y-3">
      {sessionList.map((sess) => {
        const sets = bySession.get(sess.id as string) ?? [];
        // Volume counts real external load only: total kg, and per-side kg × 2.
        const volume = sets.reduce((sum, r) => {
          if (r.load == null || r.reps == null) return sum;
          if (r.type === "total_kg") return sum + r.load * r.reps;
          if (r.type === "per_side_kg") return sum + r.load * 2 * r.reps;
          return sum;
        }, 0);
        // Group by exercise for a compact summary.
        const byEx = new Map<string, SetRow[]>();
        for (const r of sets) {
          const list = byEx.get(r.exId) ?? [];
          list.push(r);
          byEx.set(r.exId, list);
        }
        const date = new Date(sess.performed_at as string).toLocaleDateString(
          undefined,
          { weekday: "short", month: "short", day: "numeric", timeZone: tz }
        );
        const share = shareCtx ? sessionShare(shareCtx, sess.id as string) : null;
        return (
          <section key={sess.id as string} className="glass px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-bold capitalize text-ink">
                {(sess.type as string | null) ?? "Session"} · {date}
              </h2>
              {volume > 0 ? (
                <span className="shrink-0 text-xs font-medium text-muted">
                  <span className="tnum font-display text-sm font-bold text-ink">
                    {Math.round(volume)}
                  </span>{" "}
                  kg vol
                </span>
              ) : null}
            </div>
            {activityInfo.has(sess.id as string) ? (
              <p className="tnum text-xs text-muted">
                Extra activity
                {activityInfo.get(sess.id as string)?.effort
                  ? ` · ${(activityInfo.get(sess.id as string)?.effort ?? "").replace(/^./, (c) => c.toUpperCase())}`
                  : ""}
                {" · "}
                {activityInfo.get(sess.id as string)?.kcal != null
                  ? `${activityInfo.get(sess.id as string)?.kcal} kcal`
                  : "— kcal"}
              </p>
            ) : null}
            <ul className="mt-1">
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
                  <li
                    key={exId}
                    className="flex min-h-[40px] items-center justify-between gap-3 border-b border-hairline py-1.5 last:border-b-0"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      {nameById.get(exId) ?? "Exercise"}
                      {isPr ? <span className="mark mark-green">PR</span> : null}
                    </span>
                    <span className="tnum shrink-0 text-right font-display text-[13px] font-semibold text-ink">
                      {summary}
                    </span>
                  </li>
                );
              })}
            </ul>
            {sess.my_note ? (
              <p className="mt-2 text-[13px] font-medium text-muted">
                &ldquo;{sess.my_note as string}&rdquo;
              </p>
            ) : null}
            {share ? (
              <div className="mt-2 flex justify-end">
                <ShareButton
                  bundle={share}
                  initialTab="session"
                  label="Share"
                  ariaLabel={`Share ${(sess.type as string | null) ?? "session"} on ${date}`}
                  className="btn-secondary min-h-[44px] px-3 text-[13px]"
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
