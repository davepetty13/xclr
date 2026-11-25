"use client";

import { useRouter } from "next/navigation";

export type DayOption = {
  id: string;
  name: string; // "Day 4 · Push"
  status: "done" | "skipped" | "rest" | "off" | null; // off = not this week
};

const STATUS_TEXT: Record<NonNullable<DayOption["status"]>, string> = {
  done: "done",
  skipped: "skipped",
  rest: "rest day",
  off: "not this week",
};

// Compact day selector: a dropdown instead of a row of chips, with the chosen
// day's status beside it (Done / Skipped; nothing when not done yet).
export function DayPicker({ days, selectedId }: { days: DayOption[]; selectedId: string }) {
  const router = useRouter();
  const selected = days.find((d) => d.id === selectedId) ?? days[0];
  return (
    <div className="flex items-center gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Program day</span>
        <select
          value={selected?.id}
          onChange={(e) => router.push(`/workout?day=${e.target.value}`)}
          className="field w-full bg-card text-sm font-semibold"
        >
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.status ? ` — ${STATUS_TEXT[d.status]}` : ""}
            </option>
          ))}
        </select>
      </label>
      {selected?.status === "done" ? (
        <span className="mark mark-green shrink-0">Done</span>
      ) : selected?.status === "skipped" ? (
        <span className="mark mark-neutral shrink-0">Skipped</span>
      ) : null}
    </div>
  );
}
