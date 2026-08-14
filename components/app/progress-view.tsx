"use client";

import { useState } from "react";
import { LineChart } from "./line-chart";

export type ProgressExercise = {
  id: string;
  name: string;
  inverted: boolean;
  unitLabel: string;
  values: number[];
};

export function ProgressView({ exercises }: { exercises: ProgressExercise[] }) {
  const [sel, setSel] = useState(exercises[0]?.id ?? "");

  if (!exercises.length)
    return (
      <p className="rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
        No logged exercises yet. Log a session in Today and your progress charts
        appear here.
      </p>
    );

  const ex = exercises.find((e) => e.id === sel) ?? exercises[0];
  const values = ex.values;
  const last = values[values.length - 1];
  const prev = values.length >= 2 ? values[values.length - 2] : null;
  const badge =
    values.length < 2
      ? "new"
      : last >= Math.max(...values)
        ? "PR"
        : prev != null && last > prev
          ? "progressing"
          : "holding";
  const badgeCls =
    badge === "PR" || badge === "progressing"
      ? "bg-green-soft text-green"
      : "bg-paper text-muted";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {exercises.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setSel(e.id)}
            aria-pressed={e.id === ex.id}
            className={`rounded-chip border px-3 py-1.5 text-xs font-semibold transition-colors ${
              e.id === ex.id
                ? "border-green bg-green text-card"
                : "border-line bg-card text-ink"
            }`}
          >
            {e.name}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-tile border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-serif text-lg font-medium text-ink">{ex.name}</span>
          <span
            className={`rounded-chip px-2.5 py-1 text-xs font-semibold capitalize ${badgeCls}`}
          >
            {badge}
          </span>
        </div>
        <p className="mt-0.5 text-xs font-medium text-muted">
          {ex.inverted
            ? "Assisted — less assist is stronger, so up is progress."
            : ex.unitLabel}
        </p>
        <div className="mt-3">
          <LineChart values={values} />
        </div>
      </div>
    </div>
  );
}
