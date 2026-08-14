"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  rationale: string;
};
export type PendingProposal = {
  id: string;
  summary: string;
  items: ReviewItem[];
} | null;

const FIELD_LABEL: Record<string, string> = {
  suggested_load_value: "Load",
  prescribed_sets: "Sets",
  rep_scheme: "Reps",
  coach_note: "Coach note",
};

export function WeekReview({ proposal }: { proposal: PendingProposal }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // itemId → approved; default true (approve).
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "Something went wrong.");
  }

  if (!proposal) {
    return (
      <div className="rounded-tile border border-line bg-card p-5">
        <p className="text-sm font-medium text-ink">
          No pending review. When you&apos;ve logged a week of training, Xclr can
          look at how it went and propose small adjustments — you approve each one.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(generateWeeklyReview)}
          className="mt-4 w-full rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Reviewing your week…" : "Generate this week's review"}
        </button>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-ink">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const approvedIds = proposal.items
    .filter((it) => decisions[it.id] !== false)
    .map((it) => it.id);

  return (
    <div>
      {proposal.summary ? (
        <p className="text-sm font-medium text-muted">{proposal.summary}</p>
      ) : null}

      {proposal.items.length === 0 ? (
        <div className="mt-4 rounded-tile border border-line bg-card p-5">
          <p className="text-sm font-medium text-ink">
            Nothing to change this week — keep doing what you&apos;re doing. 💪
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => applyProposal(proposal.id, []))}
            className="mt-4 w-full rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Got it"}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            {proposal.items.map((it) => {
              const approved = decisions[it.id] !== false;
              return (
                <div key={it.id} className="rounded-tile border border-line bg-card p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-ink">{it.exercise}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                      {FIELD_LABEL[it.field] ?? it.field}
                    </span>
                  </div>
                  <p className="tnum mt-1 text-sm text-ink">
                    <span className="text-muted line-through">{it.old_value || "—"}</span>
                    {"  →  "}
                    <span className="font-semibold text-green">{it.new_value}</span>
                  </p>
                  {it.rationale ? (
                    <p className="mt-1 text-sm font-medium text-muted">{it.rationale}</p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDecisions((d) => ({ ...d, [it.id]: true }))}
                      aria-pressed={approved}
                      className={`flex-1 rounded-chip px-3 py-2 text-sm font-semibold transition-colors ${
                        approved
                          ? "bg-green text-card"
                          : "border border-line bg-card text-ink"
                      }`}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisions((d) => ({ ...d, [it.id]: false }))}
                      aria-pressed={!approved}
                      className={`flex-1 rounded-chip px-3 py-2 text-sm font-semibold transition-colors ${
                        !approved
                          ? "bg-ink text-paper"
                          : "border border-line bg-card text-ink"
                      }`}
                    >
                      Keep as is
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
            >
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => applyProposal(proposal.id, approvedIds))}
            className="mt-4 w-full rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Applying…"
              : `Apply ${approvedIds.length} change${approvedIds.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </div>
  );
}
