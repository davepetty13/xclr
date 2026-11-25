// Pure training math shared across the Workout tab.

// Epley estimated 1-rep-max — the progression payoff Sheets can't show (Spec §8).
export function epley1RM(loadValue: number | null, reps: number | null): number | null {
  if (loadValue == null || reps == null || loadValue <= 0 || reps <= 0) return null;
  return Math.round(loadValue * (1 + reps / 30) * 10) / 10;
}

// How many exercises set a new best estimated 1RM inside a window, compared
// with everything logged before it. Only load types where heavier = better
// count (assist, time and bodyweight are skipped); an exercise with no earlier
// history can't PR yet. Sets already flagged is_pr also count.
export type PrSet = {
  exercise_id: string;
  load_value: number | null;
  load_type: string | null;
  reps: number | null;
  at: string; // ISO timestamp
  is_pr?: boolean | null;
};
export function countPRs(sets: PrSet[], windowStartISO: string): number {
  const start = Date.parse(windowStartISO);
  const before = new Map<string, number>();
  const inside = new Map<string, number>();
  const flagged = new Set<string>();
  for (const s of sets) {
    const inWindow = Date.parse(s.at) >= start;
    if (inWindow && s.is_pr) flagged.add(s.exercise_id);
    if (s.load_type !== "total_kg" && s.load_type !== "per_side_kg") continue;
    const est = epley1RM(s.load_value, s.reps);
    if (est == null) continue;
    // Never compare total-kg sets with per-side sets (loads are never flattened).
    const key = `${s.exercise_id}|${s.load_type}`;
    const map = inWindow ? inside : before;
    map.set(key, Math.max(map.get(key) ?? 0, est));
  }
  const prs = new Set(flagged);
  for (const [key, best] of Array.from(inside.entries())) {
    const prior = before.get(key);
    if (prior != null && best > prior) prs.add(key.split("|")[0]);
  }
  return prs.size;
}

// A per-exercise progression point for the Progress chart.
export type ProgressPoint = { day: string; value: number };

// For assist-type exercises, LOWER assist = stronger, so we invert the series
// (peak assist minus value) to make the chart read upward-as-progress.
export function orientSeries(
  points: ProgressPoint[],
  loadType: string | null
): { points: ProgressPoint[]; inverted: boolean } {
  if (loadType === "assist_kg" && points.length) {
    const peak = Math.max(...points.map((p) => p.value));
    return {
      points: points.map((p) => ({ day: p.day, value: peak - p.value })),
      inverted: true,
    };
  }
  return { points, inverted: false };
}
