"use client";

// One switch for the whole app (At home today, notification settings).
// A 44 px tall hit area wraps the 32 px track. Off uses --switch-off (≥3:1
// against the card), on uses green. While a save is running, pass `busy`: the
// switch stays usable and announces aria-busy instead of greying out.
export function Switch({
  on,
  label,
  onChange,
  disabled = false,
  busy = false,
  className = "",
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean; // only for "can't be changed here at all"
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`group flex min-h-[44px] w-[60px] shrink-0 items-center justify-center disabled:cursor-not-allowed ${className}`}
    >
      <span
        aria-hidden
        className={`relative h-8 w-[52px] rounded-full transition-colors group-disabled:opacity-55 ${
          on ? "bg-green" : "bg-switch-off"
        }`}
      >
        <span
          className={`absolute top-[3px] h-[26px] w-[26px] rounded-full bg-card shadow-card transition-[left] ${
            on ? "left-[23px]" : "left-[3px]"
          }`}
        />
      </span>
    </button>
  );
}
