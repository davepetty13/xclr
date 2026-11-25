"use client";

import { useState } from "react";
import { LineChart } from "./line-chart";
import { loadUnitLabel, type LoadType } from "@/lib/program-schema";

export type ProgressExercise = {
  id: string;
  name: string;
  inverted: boolean;
  loadType: LoadType;
  unitLabel: string;
  values: number[];
};

export function ProgressView({ exercises }: { exercises: ProgressExercise[] }) {
  const [sel, setSel] = useState(exercises[0]?.id ?? "");

  if (!exercises.length)
    return (
      <p className="glass p-4 text-sm font-medium text-muted">
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
    badge === "PR" || badge === "progressing" ? "mark-green" : "mark-neutral";
  // Assisted series are oriented as (highest assist − assist), so up = win.
  const unit = ex.inverted
    ? "kg less assist than your highest"
    : `${loadUnitLabel(ex.loadType)} latest`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Exercise">
        {exercises.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setSel(e.id)}
            aria-pressed={e.id === ex.id}
            className={`inline-flex min-h-[44px] items-center rounded-control px-3 text-xs font-semibold ${
              e.id === ex.id ? "bg-ink text-card" : "border border-hairline bg-card text-ink"
            }`}
          >
            {e.name}
          </button>
        ))}
      </div>

      <section aria-label={`${ex.name} progress`} className="glass px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-bold tracking-[-0.01em] text-ink">
            {ex.name}
          </h2>
          <span className={`mark ${badgeCls} capitalize`}>{badge}</span>
        </div>
        <p className="mt-1 text-xs font-medium text-muted">
          {ex.inverted
            ? "Assisted — less assist is stronger, so up is progress."
            : ex.unitLabel}
        </p>
        <p className="mt-2 tnum">
          <span className="font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-ink">
            {Math.round(last * 10) / 10}
          </span>{" "}
          <span className="text-[13px] font-medium text-muted">{unit}</span>
        </p>
        <div className="mt-3">
          <LineChart values={values} />
        </div>
      </section>
    </div>
  );
}
