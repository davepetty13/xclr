"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveFoodEdit,
  removeFoodLog,
  quickAddFromLibrary,
} from "@/app/(app)/food/actions";

type FoodRow = {
  id: string;
  name: string;
  serving: string | null;
  meal: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_estimate: boolean;
};
type LibRow = {
  id: string;
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
};

const SELECT_MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function FoodTab({
  foods,
  library,
  dateLabel,
  calTarget,
  proteinTarget,
  loadError = false,
}: {
  foods: FoodRow[];
  library: LibRow[];
  dateLabel: string;
  calTarget: number;
  proteinTarget: number;
  loadError?: boolean;
}) {
  const router = useRouter();
  const [meal, setMeal] = useState<string>("lunch");
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FoodRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const kcalEaten = foods.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const proteinNow = foods.reduce((s, f) => s + (Number(f.protein_g) || 0), 0);
  const left = calTarget - kcalEaten;

  const q = query.trim().toLowerCase();
  const shown = q ? library.filter((l) => l.name.toLowerCase().includes(q)) : library;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(r.error ?? "Something went wrong.");
      }
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-5">
      <header className="px-1">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">Food</h1>
        <p className="mt-0.5 text-xs text-muted">{dateLabel}</p>
      </header>

      {/* The one dark band: today's totals */}
      <section aria-label="Today's food totals" className="band grid grid-cols-3">
        <div className="band-edge px-3.5 py-3">
          <p className="text-[11px] text-band-label">{left >= 0 ? "Left" : "Over"}</p>
          <p className="tnum font-display text-[19px] font-bold">{fmt(Math.abs(left))}</p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">Eaten</p>
          <p className="tnum font-display text-[19px] font-bold">{fmt(kcalEaten)}</p>
        </div>
        <div className="border-l border-band-hairline px-3.5 py-3">
          <p className="text-[11px] text-band-label">Protein</p>
          <p className="tnum font-display text-[19px] font-bold">
            {fmt(proteinNow)}
            <span className="text-xs text-band-secondary"> / {proteinTarget} g</span>
          </p>
        </div>
      </section>

      {error ? (
        <p role="alert" className="pop px-4 py-3 text-sm font-medium text-ink">
          {error}
        </p>
      ) : null}

      {library.length ? (
        <label className="glass flex min-h-[44px] items-center gap-2 !rounded-[14px] px-3 text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="sr-only">Search your foods</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your foods"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </label>
      ) : null}

      {/* Meal for quick-add */}
      <div role="tablist" aria-label="Meal" className="flex gap-5 border-b border-hairline px-1">
        {SELECT_MEALS.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={meal === m}
            onClick={() => setMeal(m)}
            className="tab capitalize"
          >
            {m}
          </button>
        ))}
      </div>

      {/* Quick-add from personal library */}
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-bold text-ink">Your library</h2>
        {library.length ? <span className="text-[11px] text-muted">Tap a dish to add · no AI</span> : null}
      </div>
      {added ? (
        <p role="status" className="mark mark-green self-start px-3 py-2 text-xs">
          {added}
        </p>
      ) : null}
      {library.length === 0 ? (
        <div className="glass flex flex-col gap-3 p-4">
          <p className="text-sm font-medium text-muted">
            No saved dishes yet. When you log food in Coach, tap <strong className="text-ink">Save to library</strong>{" "}
            on it (or fix an estimate in Logged today) and it shows up here for one-tap adding.
          </p>
          <a href="/chat" className="btn-primary btn-primary-green self-start px-4 text-[13px]">
            Log a dish in Coach
          </a>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-1 text-sm text-muted">No dish in your library matches “{query}”.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {shown.map((l) => (
            <button
              key={l.id}
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setAdded(null);
                  const r = await quickAddFromLibrary(l.id, meal);
                  if (r.ok) setAdded(`Added ${l.name} to ${meal}.`);
                  return r;
                })
              }
              aria-label={`Add ${l.name} to ${meal}`}
              className="glass flex flex-col gap-0.5 !rounded-tile px-3.5 py-3 text-left text-ink transition-opacity disabled:opacity-50"
            >
              <span className="text-sm font-bold">{l.name}</span>
              <span className="tnum text-xs text-muted">
                {[l.serving, l.protein_g != null ? `P${Math.round(l.protein_g)}` : null]
                  .filter(Boolean)
                  .join(" · ") || "\u00a0"}
              </span>
              <span className="flex items-end justify-between gap-2">
                <span className="tnum font-display text-[19px] font-bold">
                  {l.kcal != null ? fmt(l.kcal) : "—"}{" "}
                  <span className="font-sans text-xs font-medium text-muted">kcal</span>
                </span>
                <span aria-hidden className="btn-primary btn-primary-green min-h-[32px] px-2.5 text-xs">
                  + Add
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Logged today */}
      <h2 className="mt-1 px-1 text-sm font-bold text-ink">Logged today</h2>
      {loadError ? (
        <p role="alert" className="glass p-4 text-sm font-medium text-muted">
          Couldn&apos;t load today&apos;s food. Try again in a moment.
        </p>
      ) : foods.length === 0 ? (
        <p className="glass p-4 text-sm font-medium text-muted">
          {library.length
            ? "Nothing yet. Tap a dish above, or tell your coach in Chat."
            : "Nothing yet. Tell your coach what you ate in Chat."}
        </p>
      ) : (
        <ul aria-label="Logged today" className="glass px-3.5 py-0.5">
          {foods.map((f, i) => (
            <li
              key={f.id}
              className={`py-2.5 ${i < foods.length - 1 ? "border-b border-hairline" : ""}`}
            >
              {editing?.id === f.id ? (
                <EditForm
                  food={editing}
                  busy={busy}
                  onChange={setEditing}
                  onCancel={() => setEditing(null)}
                  onSave={() =>
                    void run(() =>
                      saveFoodEdit(f.id, {
                        name: editing.name,
                        serving: editing.serving,
                        meal: editing.meal,
                        kcal: editing.kcal,
                        protein_g: editing.protein_g,
                        carbs_g: editing.carbs_g,
                        fat_g: editing.fat_g,
                      })
                    )
                  }
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(f)}
                    className="min-h-[44px] flex-1 text-left"
                    aria-label={`Edit ${f.name}`}
                  >
                    {f.meal ? (
                      <span className="block text-[11px] font-bold capitalize text-muted">{f.meal}</span>
                    ) : null}
                    <span className="text-sm text-ink">
                      {f.name}
                      {f.serving ? <span className="text-muted">, {f.serving}</span> : null}
                      {f.is_estimate ? <span className="mark mark-amber ml-1.5">estimate</span> : null}
                    </span>
                  </button>
                  <span className="tnum shrink-0 text-[13px] text-muted">
                    {[
                      f.kcal != null ? fmt(f.kcal) : null,
                      f.protein_g != null ? `P${Math.round(f.protein_g)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => removeFoodLog(f.id))}
                    aria-label={`Remove ${f.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-muted disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {foods.some((f) => f.is_estimate) ? (
        <p className="px-1 text-xs text-muted">Tap an estimate to fix it. Xclr remembers the fix.</p>
      ) : null}
    </main>
  );
}

function EditForm({
  food,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  food: FoodRow;
  busy: boolean;
  onChange: (f: FoodRow) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v) || null);
  const cell = "field tnum w-full text-sm font-medium outline-none placeholder:text-muted focus:border-green";
  return (
    <div className="space-y-2">
      <input
        className={cell}
        value={food.name}
        onChange={(e) => onChange({ ...food, name: e.target.value })}
        placeholder="Name"
        aria-label="Food name"
      />
      <input
        className={cell}
        value={food.serving ?? ""}
        onChange={(e) => onChange({ ...food, serving: e.target.value || null })}
        placeholder="Serving (e.g. 1 cup)"
        aria-label="Serving"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={cell}
          inputMode="decimal"
          value={food.kcal != null ? String(food.kcal) : ""}
          onChange={(e) => onChange({ ...food, kcal: numOrNull(e.target.value) })}
          placeholder="kcal"
          aria-label="Calories"
        />
        <input
          className={cell}
          inputMode="decimal"
          value={food.protein_g != null ? String(food.protein_g) : ""}
          onChange={(e) => onChange({ ...food, protein_g: numOrNull(e.target.value) })}
          placeholder="protein g"
          aria-label="Protein grams"
        />
        <input
          className={cell}
          inputMode="decimal"
          value={food.carbs_g != null ? String(food.carbs_g) : ""}
          onChange={(e) => onChange({ ...food, carbs_g: numOrNull(e.target.value) })}
          placeholder="carbs g"
          aria-label="Carbs grams"
        />
        <input
          className={cell}
          inputMode="decimal"
          value={food.fat_g != null ? String(food.fat_g) : ""}
          onChange={(e) => onChange({ ...food, fat_g: numOrNull(e.target.value) })}
          placeholder="fat g"
          aria-label="Fat grams"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="btn-primary btn-primary-green flex-1 text-sm"
        >
          {busy ? "Saving…" : "Save & remember"}
        </button>
      </div>
    </div>
  );
}
