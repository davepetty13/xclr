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

export function FoodTab({
  foods,
  library,
}: {
  foods: FoodRow[];
  library: LibRow[];
}) {
  const router = useRouter();
  const [meal, setMeal] = useState<string>("lunch");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FoodRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setEditing(null);
      router.refresh();
    } else {
      setError(r.error ?? "Something went wrong.");
    }
  }

  return (
    <main className="px-5 py-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-ink">
        Food
      </h1>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
        >
          {error}
        </p>
      ) : null}

      {/* Meal selector (for quick-add) */}
      <div className="mt-4 flex gap-1 rounded-chip border border-line bg-paper p-1">
        {SELECT_MEALS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMeal(m)}
            aria-pressed={meal === m}
            className={`flex-1 rounded-tile px-2 py-2 text-xs font-semibold capitalize transition-colors ${
              meal === m ? "bg-card text-ink shadow-card" : "text-muted"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Quick-add from personal library */}
      {library.length ? (
        <section className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
            Quick add — your dishes
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {library.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={busy}
                onClick={() => void run(() => quickAddFromLibrary(l.id, meal))}
                className="rounded-chip border border-line bg-card px-3 py-2 text-left text-xs font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {l.name}
                {l.kcal != null ? (
                  <span className="tnum ml-1 font-medium text-muted">
                    {Math.round(l.kcal)} kcal
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Logged today */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Logged today</h2>
        {foods.length === 0 ? (
          <p className="mt-2 rounded-tile border border-line bg-card p-4 text-sm font-medium text-muted">
            Nothing yet. Quick-add above, or log it in Chat.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {foods.map((f) => (
              <li key={f.id} className="rounded-tile border border-line bg-card p-3">
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
                  <div className="flex items-baseline justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setEditing(f)}
                      className="flex-1 text-left"
                    >
                      <span className="text-sm font-medium text-ink">
                        {f.name}
                        {f.serving ? (
                          <span className="text-muted"> · {f.serving}</span>
                        ) : null}
                        {f.is_estimate ? (
                          <span className="ml-1 rounded-chip bg-green-soft px-1.5 py-0.5 text-[10px] font-semibold text-green">
                            est · tap to fix
                          </span>
                        ) : null}
                      </span>
                      <span className="tnum mt-0.5 block text-xs text-muted">
                        {[
                          f.meal,
                          f.protein_g != null ? `P${Math.round(f.protein_g)}` : null,
                          f.kcal != null ? `${Math.round(f.kcal)} kcal` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => removeFoodLog(f.id))}
                      className="shrink-0 py-1 text-xs font-semibold text-muted transition-opacity hover:opacity-80 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const cell =
    "tnum w-full rounded-chip border border-line bg-paper px-3 py-2 text-sm font-medium text-ink outline-none placeholder:text-faint focus:border-green";
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
          className="rounded-chip border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="flex-1 rounded-chip bg-green px-4 py-2 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & remember"}
        </button>
      </div>
    </div>
  );
}
