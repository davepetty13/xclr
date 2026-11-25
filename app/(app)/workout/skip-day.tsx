"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { skipDay, undoSkip } from "./actions";

// "Skip this day" with an optional reason. The weekly review reads skips and
// reasons; nothing in the program changes here. Undo puts the day back.
export function SkipDay({
  dayId,
  dayName,
  skipId,
  skipNote,
}: {
  dayId: string;
  dayName: string;
  skipId: string | null;
  skipNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        setOpen(false);
        setNote("");
        router.refresh();
      } else setError(r.error ?? "Something went wrong.");
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? (
    <p role="alert" className="text-xs font-semibold text-ember-text">
      {error}
    </p>
  ) : null;

  if (skipId) {
    return (
      <section aria-label={`${dayName} skipped`} className="glass flex flex-col gap-2 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">Skipped this week</p>
            <p className="text-xs text-muted">
              {skipNote ? `“${skipNote}”` : "No reason added."} Your coach sees this in the weekly review.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => undoSkip(skipId))}
            className="btn-secondary shrink-0 px-3 text-[13px]"
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        </div>
        {errorLine}
      </section>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-1 px-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary self-start px-4 text-[13px]"
        >
          Skip this day…
        </button>
      </div>
    );
  }

  return (
    <section aria-label={`Skip ${dayName}`} className="glass flex flex-col gap-2 px-4 py-3.5">
      <p className="text-sm font-bold text-ink">Skip {dayName} this week?</p>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        Why? (optional — helps your coach plan next week)
        <input
          type="text"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. sick, work ran late, knee sore"
          className="field text-sm font-normal"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="btn-secondary px-3 text-[13px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => skipDay(dayId, note))}
          className="btn-primary px-3 text-[13px]"
        >
          {busy ? "Skipping…" : "Skip day"}
        </button>
      </div>
      {errorLine}
    </section>
  );
}
