"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Solid bottom sheet used by Edit day, Add activity and Home equipment.
// Scrim tap / Escape / the X close it; focus moves in on open and back to the
// opener (returnFocus) on close.
export function Sheet({
  title,
  subtitle,
  onClose,
  onBack,
  returnFocus,
  children,
}: {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  onBack?: () => void; // shows a back arrow instead of the X
  returnFocus?: React.RefObject<HTMLElement>;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const headingId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setMounted(true);
    const back = returnFocus?.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      back?.focus();
    };
  }, [returnFocus]);

  // Re-focus the top button when the sheet switches between its list and a
  // sub-view (back arrow appears / goes) — not on every render.
  const hasBack = !!onBack;
  useEffect(() => {
    if (mounted) firstRef.current?.focus();
  }, [mounted, hasBack, title]);

  if (!mounted) return null;
  return createPortal(
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-scrim" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto !rounded-b-none px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-2.5"
      >
        <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-sm bg-line" />
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              ref={firstRef}
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-segment text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
          </div>
          {!onBack ? (
            <button
              ref={firstRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-segment text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
        {children}
      </section>
    </>,
    document.body
  );
}

// Labelled field wrapper used inside sheets.
export function SheetField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-muted">
      <span>
        {label} {hint ? <span className="font-medium">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export const sheetInput = "field w-full bg-card text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-muted focus:border-green";

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm font-semibold text-ember-text">
      {error}
    </p>
  );
}

// A stable-enough id for new rows (crypto.randomUUID where available).
export function newKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
