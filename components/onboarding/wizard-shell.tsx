"use client";

import type { ReactNode } from "react";

// The chrome around every onboarding step: progress bar, title block, error
// surface, and Back / Continue / Skip footer. Mobile-first (max-w-md, ~390pt).
export function WizardShell({
  step,
  total,
  eyebrow,
  title,
  subtitle,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  onSkip,
  busy,
  error,
}: {
  step: number;
  total: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onSkip?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-6">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-chip ${i <= step ? "bg-green" : "bg-line"}`}
          />
        ))}
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-faint">
        {eyebrow ?? `Step ${step + 1} of ${total}`}
      </p>

      <div className="mt-2 flex-1">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm font-medium text-muted">{subtitle}</p>
        ) : null}
        <div className="mt-6 space-y-4">{children}</div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="rounded-chip border border-line bg-card px-5 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || busy}
          className="flex-1 rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : nextLabel}
        </button>
      </div>
      {onSkip ? (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="mt-3 py-3 text-center text-sm font-semibold text-muted transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Skip for now
        </button>
      ) : null}
    </main>
  );
}
