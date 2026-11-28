import { createClient } from "@/lib/supabase/server";
import { localDate, prettyDate } from "@/lib/time";

// Read-only list of Watch / phone workouts from the last 14 days, shown in
// Train → History as extra activity. Hidden when there are none.
export async function WatchWorkouts({ userId, tz }: { userId: string; tz: string }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("health_workouts")
    .select("id, started_at, kind, minutes, kcal, avg_hr")
    .eq("user_id", userId)
    .gte("started_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(10);
  if (!data?.length) return null;

  return (
    <section aria-labelledby="watch-h" className="glass px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="watch-h" className="text-sm font-bold text-ink">
          Extra activity
        </h2>
        <span className="text-[11px] text-muted">From your Watch · last 2 weeks</span>
      </div>
      <ul className="mt-1">
        {data.map((w) => (
          <li
            key={w.id as string}
            className="flex min-h-[44px] items-center justify-between gap-3 border-b border-hairline py-1.5 last:border-b-0"
          >
            <span className="text-sm font-semibold text-ink">
              {w.kind as string}
              <span className="font-normal text-muted"> · {prettyDate(localDate(tz, new Date(w.started_at as string)))}</span>
            </span>
            <span className="tnum shrink-0 text-xs text-muted">
              {[
                w.minutes != null ? `${w.minutes} min` : null,
                w.kcal != null ? `${w.kcal} kcal` : null,
                w.avg_hr != null ? `HR ${w.avg_hr}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
