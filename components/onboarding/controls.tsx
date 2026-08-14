"use client";

import type { ReactNode } from "react";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-sm font-semibold text-ink">{children}</span>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoFocus,
  suffix,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal";
  autoFocus?: boolean;
  suffix?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center rounded-chip border border-line bg-paper px-4 py-3 focus-within:border-green">
      <input
        className="tnum w-full bg-transparent text-lg font-medium text-ink outline-none placeholder:text-faint"
        value={value}
        type={type}
        inputMode={inputMode}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix ? (
        <span className="ml-2 shrink-0 text-sm font-semibold text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function OptionCard({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full rounded-tile border px-4 py-3.5 text-left transition-colors ${
        selected
          ? "border-green bg-green-soft"
          : "border-line bg-card hover:border-faint"
      }`}
    >
      <span className="block text-base font-semibold text-ink">{label}</span>
      {hint ? <span className="mt-0.5 block text-sm text-muted">{hint}</span> : null}
    </button>
  );
}

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-chip border px-4 py-2.5 text-sm font-semibold transition-colors ${
        selected
          ? "border-green bg-green text-card"
          : "border-line bg-card text-ink hover:border-faint"
      }`}
    >
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-chip border border-line bg-paper p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-tile px-3 py-2 text-sm font-semibold transition-colors ${
            value === o.value ? "bg-card text-ink shadow-card" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-chip border border-line bg-paper px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={label ? `Decrease ${label}` : "Decrease"}
        disabled={value <= min}
        className="h-11 w-11 rounded-chip border border-line bg-card text-xl font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-40"
      >
        −
      </button>
      <span className="text-center">
        <span className="tnum font-serif text-2xl font-medium text-ink">{value}</span>
        {suffix ? (
          <span className="ml-1 text-sm font-medium text-muted">{suffix}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={label ? `Increase ${label}` : "Increase"}
        disabled={value >= max}
        className="h-11 w-11 rounded-chip border border-line bg-card text-xl font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
