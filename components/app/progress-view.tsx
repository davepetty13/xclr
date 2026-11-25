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
      {/* Compact exercise picker (dropdown instead of a wall of pills). */}
      <label className="flex flex-col gap-1">
        <span className="sr-only">Exercise</span>
        <select
          value={ex.id}
          onChange={(e) => setSel(e.target.value)}
          className="field w-full bg-card text-sm font-semibold"
        >
          {exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

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
