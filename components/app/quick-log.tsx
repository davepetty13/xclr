"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logFromLibrary } from "@/app/(app)/chat/actions";

export type QuickLogItem = { id: string; label: string; kcal: number | null };

// Today's "Quick log": the user's most-logged dishes. One tap logs from the
// personal library (no AI), then the page refreshes its totals.
export function QuickLog({ items }: { items: QuickLogItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function log(item: QuickLogItem) {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    setDone(null);
    try {
      const r = await logFromLibrary(item.id, null);
      if (r.ok) {
        setDone(`Logged ${item.label}.`);
        router.refresh();
      } else setError(r.error);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="quick-log-h" className="glass flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="quick-log-h" className="text-sm font-bold text-ink">
          Quick log
        </h2>
        <span className="text-[11px] text-muted">From your library · no AI</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">
          Dishes you log in Chat land here, ready to log again with one tap.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={busyId != null}
            onClick={() => void log(item)}
            aria-label={`Log ${item.label}${item.kcal != null ? `, ${Math.round(item.kcal)} kcal` : ""}`}
            className="btn-secondary tnum min-h-11 px-3 text-[13px]"
          >
            {busyId === item.id ? "Logging…" : item.label}
            {busyId !== item.id && item.kcal != null ? (
              <span className="text-muted"> · {Math.round(item.kcal)}</span>
            ) : null}
          </button>
        ))}
        <Link href="/chat" className="btn-primary btn-primary-green min-h-11 px-3 text-[13px]">
          Something else
        </Link>
      </div>
      <p aria-live="polite" className="text-xs empty:hidden">
        {error ? <span className="font-semibold text-ember-text">{error}</span> : null}
        {!error && done ? <span className="font-semibold text-green">{done}</span> : null}
      </p>
    </section>
  );
}
