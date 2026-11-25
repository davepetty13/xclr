"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNewWeek, generateWeeklyReview } from "./actions";

type Started = { week: number; hasProposal: boolean; reviewFrom: string };

// "Start a new week" — always available, open by default once the week is done.
// It ASKS: repeat this week, or move to a fresh week. Coach changes are never
// applied here; if some are waiting, we point to the Review tab.
export function NewWeek({
  week,
  weekComplete,
  defaultOpen = false,
}: {
  week: number;
  weekComplete: boolean;
  defaultOpen?: boolean; // e.g. right after saving review decisions
}) {
  const router = useRouter();
  const [open, setOpen] = useState(weekComplete || defaultOpen);
  const [busy, setBusy] = useState<null | "repeat" | "fresh" | "review">(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);

  async function start(mode: "repeat" | "fresh") {
    setBusy(mode);
    setError(null);
    try {
      const r = await startNewWeek(mode);
      if (r.ok) {
        setStarted({ week: r.week, hasProposal: r.hasProposal, reviewFrom: r.reviewFrom });
        router.refresh();
      } else setError(r.error);
    } catch {
      setError("The connection dropped. Try again.");
    }
    setBusy(null);
  }

  async function review(from: string) {
    setBusy("review");
    setError(null);
    try {
      const r = await generateWeeklyReview(from);
      if (r.ok) {
        router.push("/workout/review");
        return;
      }
      setError(r.error);
    } catch {
      setError("That took too long or the connection dropped. Try again.");
    }
    setBusy(null);
  }

  const errorBox = error ? (
    <p
      role="alert"
      className="pop !rounded-tile px-4 py-3 text-sm font-medium text-ink shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]"
    >
      {error}
    </p>
  ) : null;

  if (started) {
    return (
      <section
        aria-label="New week"
        aria-live="polite"
        className="glass flex flex-col gap-2 px-4 py-3.5"
      >
        <p className="text-sm font-bold text-ink">Week {started.week} started.</p>
        {started.hasProposal ? (
          <Link
            href="/workout/review"
            className="btn-primary btn-primary-green mt-1 w-full py-2 text-center text-sm"
          >
            Your coach has changes for week {started.week} — decide each one
          </Link>
        ) : (
          <>
            <p className="text-xs font-medium text-muted">
              Want your coach to look at last week and suggest small changes? You approve each one.
            </p>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void review(started.reviewFrom)}
              className="btn-primary btn-primary-green mt-1 w-full text-sm"
            >
              {busy === "review" ? "Reviewing your week…" : "Get my coach's review"}
            </button>
          </>
        )}
        {errorBox}
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="min-h-[44px] self-start px-1 text-sm font-semibold text-green underline-offset-4 hover:underline"
      >
        Start a new week
      </button>
    );
  }

  return (
    <section
      aria-label={weekComplete ? "Start the next week" : "Start a new week early"}
      className="glass flex flex-col gap-2 px-4 py-3.5"
    >
      <p className="text-sm font-bold text-ink">
        {weekComplete ? `Week ${week} done. What's next?` : "Start a new week early?"}
      </p>
      {!weekComplete ? (
        <p className="text-xs font-medium text-muted">
          Unfinished days go to history as skipped.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void start("repeat")}
          className="btn-secondary px-3 text-[13px] font-bold"
        >
          {busy === "repeat" ? "Starting…" : `Repeat week ${week}`}
        </button>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void start("fresh")}
          className="btn-primary px-3 text-[13px]"
        >
          {busy === "fresh" ? "Starting…" : `Fresh week ${week + 1}`}
        </button>
      </div>
      {!weekComplete ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] w-full text-sm font-semibold text-muted"
        >
          Not now
        </button>
      ) : null}
      {errorBox}
    </section>
  );
}
