// Pure training math shared across the Workout tab.

// Epley estimated 1-rep-max — the progression payoff Sheets can't show (Spec §8).
export function epley1RM(loadValue: number | null, reps: number | null): number | null {
  if (loadValue == null || reps == null || loadValue <= 0 || reps <= 0) return null;
  return Math.round(loadValue * (1 + reps / 30) * 10) / 10;
}

// Which program day is "today's": rotate through the ordered days by how many
// days have passed since the program's week_start. Returns the array index.
export function todaysDayIndex(weekStart: string | null, dayCount: number): number {
  if (dayCount <= 0) return 0;
  if (!weekStart) return 0;
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  const days = Math.floor((Date.now() - start) / 86_400_000);
  return ((days % dayCount) + dayCount) % dayCount;
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
