"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NewWeek } from "@/app/(app)/workout/new-week";
import {
  generateWeeklyReview,
  applyProposal,
} from "@/app/(app)/workout/actions";

export type ReviewItem = {
  id: string;
  exercise: string;
  field: string;
  old_value: string;
  new_value: string;
  old_display: string; // with unit, e.g. "62.5 kg" / "20 kg assist"
  new_display: string;
  progress: boolean; // load goes up (or assist goes down)
  rationale: string;
};
export type PendingProposal = {
  id: string;
  summary: string;
  items: ReviewItem[];
  currentWeek: boolean; // reviewed week is still the one in progress
  preparedOn: string | null;
} | null;
export type ReviewSummary = {
  sessions: number;
  prs: number;
  avgRpe: number | null;
};

// The one dark band on this screen: Sessions / PRs / Avg RPE.
function SummaryBand({ summary }: { summary: ReviewSummary | null }) {
  if (!summary) return null;
  return (
    <dl aria-label="Week summary" className="band grid grid-cols-3">
      <div className="band-edge px-3.5 py-3">
        <dt className="text-[11px] text-band-label">Sessions</dt>
        <dd className="tnum font-display text-[19px] font-bold">
          {summary.sessions}
        </dd>
      </div>
      <div className="border-l border-band-hairline px-3.5 py-3">
        <dt className="text-[11px] text-band-label">PRs</dt>
        <dd
          className={`tnum font-display text-[19px] font-bold ${
            summary.prs > 0 ? "text-ember-on-dark" : ""
          }`}
        >
          {summary.prs}
        </dd>
      </div>
      <div className="border-l border-band-hairline px-3.5 py-3">
        <dt className="text-[11px] text-band-label">Avg RPE</dt>
        <dd className="tnum font-display text-[19px] font-bold">
          {summary.avgRpe ?? "—"}
        </dd>
      </div>
    </dl>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

const errorCls =
  "pop !rounded-tile px-4 py-3 text-sm font-medium text-ink shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]";

const FIELD_LABEL: Record<string, string> = {
  suggested_load_value: "Load",
  prescribed_sets: "Sets",
  rep_scheme: "Reps",
  coach_note: "Coach note",
};

export function WeekReview({
  proposal,
  week,
  weekComplete = false,
  summary,
  loadError = false,
}: {
  proposal: PendingProposal;
  week: number;
  weekComplete?: boolean;
  summary: ReviewSummary | null;
  loadError?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // itemId → true (approve) / false (keep). Missing = not decided yet: every
  // card needs an explicit tap, and a decided card settles.
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  // Set once decisions are saved; outlives the refresh that clears `proposal`.
  const [saved, setSaved] = useState<{
    approved: number;
    currentWeek: boolean;
  } | null>(null);

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
  ) {
    setBusy(true);
    setError(null);
    let r: { ok: boolean; error?: string };
    try {
      r = await fn();
    } catch (err) {
      // Server action failed outright (function timeout / 5xx / dropped
      // connection) — show it instead of leaving the button stuck.
      console.error("[week review] action failed", err);
      r = {
        ok: false,
        error: "That took too long or the connection dropped. Try again.",
      };
    }
    setBusy(false);
    if (r.ok) {
      onOk?.();
      router.refresh();
    } else setError(r.error ?? "Something went wrong.");
  }

  // ---- decisions saved → offer the same new-week choice as Train/Today ----
  if (saved) {
    const n = saved.approved;
    return (
      <div className="flex flex-col gap-3">
        <section
          aria-live="polite"
          className="flex flex-col gap-1 rounded-card bg-green-soft px-4 py-3.5 shadow-card"
        >
          <p className="inline-flex items-center gap-1.5 text-[15px] font-bold text-ink">
            <span className="text-green">
              <CheckIcon />
            </span>
            Decisions saved
          </p>
          <p className="text-[13px] text-ink">
            {n > 0
              ? `${n} change${n === 1 ? "" : "s"} approved. ${
                  saved.currentWeek
                    ? "They're in your program now."
                    : `They're in week ${week} now.`
                }`
              : "Nothing changes. Your program stays as it is."}
          </p>
        </section>
        {saved.currentWeek ? (
          <NewWeek week={week} weekComplete={weekComplete} defaultOpen />
        ) : (
          <Link href="/workout" className="btn-secondary w-full text-sm">
            Back to Train
          </Link>
        )}
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="px-1 font-display text-lg font-bold tracking-[-0.01em] text-ink">
          Week {week} review
        </h2>
        <SummaryBand summary={summary} />
        {loadError ? (
          <p
            role="alert"
            className="glass px-4 py-3.5 text-sm font-medium text-muted"
          >
            Couldn&apos;t load your review. Try again in a moment.
          </p>
        ) : (
          <section className="glass flex flex-col gap-3 px-4 py-3.5">
            <p className="text-sm font-medium text-ink">
              No pending review. When you&apos;ve logged a week of training,
              Xclr can look at how it went and propose small adjustments — you
              approve each one.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => generateWeeklyReview())}
              className="btn-primary w-full text-sm"
            >
              {busy ? "Reviewing your week…" : "Get my coach's review"}
            </button>
            {error ? (
              <p role="alert" className={errorCls}>
                {error}
              </p>
            ) : null}
          </section>
        )}
      </div>
    );
  }

  // Only explicitly approved items are sent; undecided ones block saving.
  const approvedIds = proposal.items
    .filter((it) => decisions[it.id] === true)
    .map((it) => it.id);
  const left = proposal.items.filter(
    (it) => decisions[it.id] === undefined,
  ).length;
  const currentWeek = proposal.currentWeek;
  // Saving never starts a week (startNextWeek=false); the Repeat / Fresh choice
  // is offered afterwards.
  const save = (ids: string[]) =>
    void run(
      () => applyProposal(proposal.id, ids, false),
      () => setSaved({ approved: ids.length, currentWeek }),
    );

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1">
        <h2 className="font-display text-lg font-bold tracking-[-0.01em] text-ink">
          {proposal.currentWeek ? `Week ${week} review` : "Last week's review"}
        </h2>
        {proposal.preparedOn ? (
          <p className="mt-0.5 text-xs font-medium text-muted">
            Prepared {proposal.preparedOn} by your coach
          </p>
        ) : null}
      </header>
      <SummaryBand summary={summary} />
      {proposal.summary ? (
        <p className="px-1 text-sm font-medium text-muted">
          {proposal.summary}
        </p>
      ) : null}

      {proposal.items.length === 0 ? (
        <section className="glass flex flex-col gap-3 px-4 py-3.5">
          <p className="text-sm font-medium text-ink">
            Nothing to change this week. Keep doing what you&apos;re doing.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => save([])}
            className="btn-primary w-full text-sm"
          >
            {busy ? "Saving…" : "Got it"}
          </button>
          {error ? (
            <p role="alert" className={errorCls}>
              {error}
            </p>
          ) : null}
        </section>
      ) : (
        <>
          {proposal.items.map((it) => {
            const decision = decisions[it.id]; // undefined = not decided yet
            const hold =
              it.old_value.trim() !== "" &&
              it.old_value.trim() === it.new_value.trim();
            const label = FIELD_LABEL[it.field] ?? it.field;
            const keepLabel = it.old_value
              ? `Keep ${it.old_display}`
              : "Keep as is";
            const change = (
              <button
                type="button"
                onClick={() =>
                  setDecisions((d) => {
                    const next = { ...d };
                    delete next[it.id];
                    return next;
                  })
                }
                className="min-h-[44px] self-start text-xs font-semibold text-muted underline-offset-4 hover:underline"
              >
                Change
              </button>
            );

            if (decision === true) {
              return (
                <section
                  key={it.id}
                  aria-label={`${it.exercise}, approved`}
                  className="flex flex-col gap-1 rounded-card bg-green-soft px-4 pt-3 shadow-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-ink">
                      {it.exercise}
                    </span>
                    <span className="mark mark-green gap-1">
                      <CheckIcon />
                      Approved
                    </span>
                  </div>
                  <p className="text-[13px] text-ink">
                    <strong className="tnum font-display">
                      {it.old_value ? `${it.old_display} → ` : ""}
                      {it.new_display}
                    </strong>
                    {it.rationale ? (
                      <span className="text-muted"> · {it.rationale}</span>
                    ) : null}
                  </p>
                  {change}
                </section>
              );
            }

            if (decision === false) {
              return (
                <section
                  key={it.id}
                  aria-label={`${it.exercise}, kept`}
                  className="glass flex flex-col gap-1 px-4 pt-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-ink">
                      {it.exercise}
                    </span>
                    <span className="mark mark-neutral">Kept</span>
                  </div>
                  <p className="text-[13px] text-muted">
                    {label} stays at{" "}
                    <strong className="tnum font-display text-ink">
                      {it.old_display || "the current value"}
                    </strong>
                    .
                  </p>
                  {change}
                </section>
              );
            }

            return (
              <section
                key={it.id}
                aria-label={`${it.exercise} proposal`}
                className="glass flex flex-col gap-2.5 px-4 py-3.5"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-bold text-ink">
                    {it.exercise}
                  </span>
                  <span
                    className={`mark ${hold ? "mark-amber" : it.progress ? "mark-green" : "mark-neutral"}`}
                  >
                    {hold ? "Hold" : it.progress ? "Progress" : label}
                  </span>
                </div>
                {hold ? (
                  <p className="text-[13px] text-ink">
                    <strong>Stay at {it.new_display}.</strong>
                  </p>
                ) : (
                  <p className="tnum flex flex-wrap items-baseline gap-2.5">
                    {it.old_value ? (
                      <>
                        <span className="font-display text-xl font-semibold text-muted line-through">
                          <span className="sr-only">From </span>
                          {it.old_display}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-[15px] text-muted"
                        >
                          →
                        </span>
                      </>
                    ) : null}
                    <span className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
                      <span className="sr-only">to </span>
                      {it.new_display}
                    </span>
                  </p>
                )}
                {it.rationale ? (
                  <p className="text-[13px] leading-snug text-ink">
                    {it.rationale}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDecisions((d) => ({ ...d, [it.id]: true }))
                    }
                    className="btn-primary btn-primary-green px-3 text-[13px]"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDecisions((d) => ({ ...d, [it.id]: false }))
                    }
                    className="btn-secondary px-3 text-[13px]"
                  >
                    {keepLabel}
                  </button>
                </div>
              </section>
            );
          })}

          {error ? (
            <p role="alert" className={errorCls}>
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy || left > 0}
              onClick={() => save(approvedIds)}
              className="btn-primary tnum w-full text-sm"
            >
              {busy
                ? "Saving…"
                : left > 0
                  ? `Decide each card first · ${left} left`
                  : "Save my decisions"}
            </button>
            <p className="text-center text-xs font-medium text-muted">
              Nothing changes until you decide each card.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
