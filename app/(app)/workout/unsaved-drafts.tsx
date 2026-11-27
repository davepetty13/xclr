"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Day = { id: string; name: string };

// Sets typed on another day but not saved yet live in this browser (see
// LogSession's draft). If you come back to Train on a different day, this card
// points you back to them so nothing feels lost.
export function UnsavedDrafts({ userId, currentDayId, days }: { userId: string; currentDayId: string; days: Day[] }) {
  const [pending, setPending] = useState<Day[]>([]);

  useEffect(() => {
    const found: Day[] = [];
    for (const d of days) {
      if (d.id === currentDayId) continue;
      try {
        const raw = localStorage.getItem(`xclr-draft-workout-${userId}-${d.id}`);
        if (!raw) continue;
        const draft = JSON.parse(raw) as { cells?: Record<string, { load?: string; reps?: string; rpe?: string }>; note?: string };
        const hasSets = Object.values(draft.cells ?? {}).some(
          (c) => (c.reps ?? "").trim() !== "" || (c.rpe ?? "").trim() !== ""
        );
        if (hasSets || (draft.note ?? "").trim()) found.push(d);
      } catch {
        // unreadable draft — ignore
      }
    }
    setPending(found);
  }, [userId, currentDayId, days]);

  function discard(id: string) {
    try {
      localStorage.removeItem(`xclr-draft-workout-${userId}-${id}`);
    } catch {
      // non-fatal
    }
    setPending((p) => p.filter((d) => d.id !== id));
  }

  if (!pending.length) return null;
  return (
    <section aria-label="Unsaved workouts" className="glass flex flex-col gap-2 px-4 py-3.5">
      {pending.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-ink">
            <span className="font-bold">Unsaved sets</span> on {d.name}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => discard(d.id)} className="btn-secondary px-3 text-[13px]">
              Discard
            </button>
            <Link href={`/workout?day=${d.id}`} className="btn-primary btn-primary-green px-3 text-[13px]">
              Continue
            </Link>
          </div>
        </div>
      ))}
    </section>
  );
}
