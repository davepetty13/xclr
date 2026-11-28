"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveHomeEquipment, setAtHomeToday } from "./edit-actions";
import { describeEquipment, homeSwapFor, type HomeEquipment } from "@/lib/home-swaps";
import type { DayItem } from "@/lib/day-edits";
import { ErrorLine, Sheet } from "./sheet";
import { Switch } from "@/components/app/switch";

const DB_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 24, 30, 40];
const KB_OPTIONS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32];

function HouseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-green">
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

// "At home today": one switch swaps today's exercises for home versions. The
// gym plan never changes; it's for today only.
export function AtHome({
  on,
  equipment,
  equipmentSet,
  swappedCount,
  dayName,
  items,
}: {
  on: boolean;
  equipment: HomeEquipment;
  equipmentSet: boolean; // false = never set up (treated as bodyweight only)
  swappedCount: number;
  dayName: string;
  items: DayItem[];
}) {
  const router = useRouter();
  const changeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Optimistic switch position while the server catches up.
  const [pending, setPending] = useState<boolean | null>(null);
  const isOn = pending ?? on;

  async function toggle() {
    if (busy) return; // a save is running (aria-busy on the switch)
    const next = !isOn;
    setPending(next);
    setBusy(true);
    setError(null);
    try {
      const r = await setAtHomeToday(next);
      if (!r.ok) {
        setError(r.error);
        setPending(null);
      } else {
        router.refresh();
        if (next && !equipmentSet) setSetupOpen(true);
      }
    } catch {
      setError("That didn't go through. Check your connection and try again.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="At home today"
      className={`flex flex-col gap-1.5 px-3.5 py-3 ${isOn ? "rounded-tile bg-green-soft" : "glass"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HouseIcon />
          <span className="text-[15px] font-bold text-ink">At home today</span>
        </div>
        <Switch on={isOn} label="At home today" busy={busy} onChange={() => void toggle()} />
      </div>
      <p className="text-xs text-ink">
        Using: {describeEquipment(equipment)} ·{" "}
        <button
          ref={changeRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSetupOpen(true)}
          className="min-h-[40px] font-semibold underline"
        >
          change
        </button>
      </p>
      <p className="text-xs text-muted">
        {isOn
          ? on
            ? `${swappedCount} exercise${swappedCount === 1 ? "" : "s"} swapped for home versions. Your gym plan stays the same.`
            : "Switching to home versions…"
          : "Swap today's exercises for home versions. Your gym plan stays the same."}
      </p>
      <ErrorLine error={error} />
      {setupOpen ? (
        <HomeSetup
          initial={equipment}
          dayName={dayName}
          items={items}
          returnFocus={changeRef}
          onClose={() => setSetupOpen(false)}
          onSaved={() => {
            setSetupOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function HomeSetup({
  initial,
  dayName,
  items,
  returnFocus,
  onClose,
  onSaved,
}: {
  initial: HomeEquipment;
  dayName: string;
  items: DayItem[];
  returnFocus: React.RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [eq, setEq] = useState<HomeEquipment>(initial);
  const [dbKg, setDbKg] = useState(initial.dumbbells_max_kg || 10);
  const [kbKg, setKbKg] = useState(initial.kettlebell_kg || 12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDb = eq.dumbbells_max_kg > 0;
  const hasKb = eq.kettlebell_kg > 0;
  const preview = items
    .filter((it) => !it.activity)
    .map((it) => homeSwapFor({ name: it.name, category: it.category, load_value: it.suggested_load_value, load_type: it.suggested_load_type }, eq).name);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveHomeEquipment(eq);
      if (r.ok) onSaved();
      else setError(r.error);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, checked: boolean, onChange: (v: boolean) => void, extra?: React.ReactNode, last = false) => (
    <div className={`flex min-h-[54px] items-center gap-2.5 ${last ? "" : "border-b border-hairline"}`}>
      <label className="flex min-h-[44px] flex-1 items-center gap-2.5 text-[15px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-[22px] w-[22px] accent-green"
        />
        {label}
      </label>
      {extra}
    </div>
  );
  const smallSelect = "field min-h-[40px] bg-card px-2 text-[13px] font-semibold disabled:opacity-55";

  return (
    <Sheet title="What do you have at home?" onClose={onClose} returnFocus={returnFocus}>
      <p className="text-[13px] text-muted">Xclr picks home versions of your exercises from this. Change it any time.</p>
      <div className="rounded-[16px] border border-control-border px-3">
        {row(
          "Dumbbells",
          hasDb,
          (v) => setEq({ ...eq, dumbbells_max_kg: v ? dbKg : 0 }),
          <select
            aria-label="Heaviest dumbbell"
            value={dbKg}
            disabled={!hasDb}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDbKg(v);
              setEq({ ...eq, dumbbells_max_kg: v });
            }}
            className={smallSelect}
          >
            {DB_OPTIONS.map((kg) => (
              <option key={kg} value={kg}>
                up to {kg} kg
              </option>
            ))}
          </select>
        )}
        {row("Mat", eq.mat, (v) => setEq({ ...eq, mat: v }))}
        {row("Resistance bands", eq.bands, (v) => setEq({ ...eq, bands: v }))}
        {row("Pull-up bar", eq.pullup_bar, (v) => setEq({ ...eq, pullup_bar: v }))}
        {row("Bench or sturdy chair", eq.bench, (v) => setEq({ ...eq, bench: v }))}
        {row(
          "Kettlebell",
          hasKb,
          (v) => setEq({ ...eq, kettlebell_kg: v ? kbKg : 0 }),
          <select
            aria-label="Kettlebell weight"
            value={kbKg}
            disabled={!hasKb}
            onChange={(e) => {
              const v = Number(e.target.value);
              setKbKg(v);
              setEq({ ...eq, kettlebell_kg: v });
            }}
            className={smallSelect}
          >
            {KB_OPTIONS.map((kg) => (
              <option key={kg} value={kg}>
                {kg} kg
              </option>
            ))}
          </select>,
          true
        )}
      </div>
      {preview.length ? (
        <p className="rounded-[14px] bg-green-soft px-3 py-2.5 text-xs leading-snug text-ink">
          With this setup, {dayName} becomes: {preview.join(", ")}. Light weights get slower reps to make them count.
        </p>
      ) : null}
      <ErrorLine error={error} />
      <button type="button" disabled={busy} onClick={() => void save()} className="btn-primary btn-primary-green w-full text-[15px]">
        {busy ? "Saving…" : "Save"}
      </button>
    </Sheet>
  );
}
