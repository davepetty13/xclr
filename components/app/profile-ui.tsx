"use client";

import type { ReactNode } from "react";

// Small shared building blocks for the /profile forms. Token classes only.

// Small muted heading above a frosted card. `accent="violet"` marks health.
export function ProfileSection({
  title,
  id,
  children,
  badge,
  accent,
}: {
  title: string;
  id: string;
  children: ReactNode;
  badge?: ReactNode;
  accent?: "violet";
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1 pt-1">
        <h2 id={id} className="text-xs font-bold text-muted">
          {title}
        </h2>
        {badge}
      </div>
      <div
        className={`glass space-y-4 px-4 py-4 ${
          accent === "violet" ? "shadow-[inset_3px_0_0_var(--violet),var(--shadow-card)]" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function FieldTitle({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-sm font-semibold text-ink">{children}</span>;
}

export const inputClass =
  "field tnum w-full text-base font-medium outline-none placeholder:text-muted focus:border-green";

export function Chip({
  on,
  onClick,
  children,
  role = "checkbox",
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  role?: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={`min-h-[44px] rounded-control border px-3.5 text-sm transition-colors ${
        on
          ? "border-ink bg-ink font-bold text-card"
          : "border-control-border bg-card font-semibold text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-semibold text-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function SaveRow({
  busy,
  error,
  saved,
  onSave,
  label = "Save",
}: {
  busy: boolean;
  error: string | null;
  saved: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div>
      {error ? (
        <p role="alert" className="mb-2 text-sm font-semibold text-ember-text">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="btn-primary btn-primary-green px-5 text-sm"
        >
          {busy ? "Saving…" : label}
        </button>
        {saved && !error ? (
          <span aria-live="polite" className="text-sm font-semibold text-green">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
