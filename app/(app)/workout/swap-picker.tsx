"use client";

import { useId, useMemo, useState } from "react";
import { formatLoad, loadUnitLabel, type LoadType } from "@/lib/program-schema";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  altLoadType,
  asCategory,
  catalog,
  guessCategory,
  needsLabel,
  pickerOptions,
  type Category,
} from "@/lib/home-swaps";
import type { LibraryExercise } from "./edit-actions";
import { LOAD_TYPE_OPTIONS } from "@/lib/day-edits";

type Tab = "gym" | "home" | "bodyweight";

export type Picked = {
  name: string;
  category: Category | null;
  sets: string;
  reps: string;
  load: string;
  load_type: LoadType | null;
};

type Candidate = {
  name: string;
  category: Category | null;
  sub: string;
  loadType: LoadType | null;
  last: LibraryExercise["last"];
};

// Swap / add picker: search (type anything), Gym | Home | Bodyweight tabs and
// "Same muscles" suggestions from the user's own exercise list + the built-in
// home map. No AI.
export function SwapPicker({
  base,
  library,
  exclude,
  defaultCategory,
  onPick,
}: {
  base: { name: string; category: Category | null; sets: string; reps: string; load: string; load_type: LoadType | null } | null;
  library: LibraryExercise[] | null; // null while loading
  exclude: Set<string>; // lowercased names already in the day
  defaultCategory: Category | null;
  onPick: (p: Picked) => void;
}) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("gym");
  const [cat, setCat] = useState<Category | null>(base?.category ?? defaultCategory);
  const [sel, setSel] = useState<Candidate | null>(null);
  const [sets, setSets] = useState(base?.sets || "3");
  const [reps, setReps] = useState(base?.reps || "10");
  const [load, setLoad] = useState("");
  const [loadType, setLoadType] = useState<LoadType | null>(base?.load_type ?? "total_kg");

  const lastByLower = useMemo(() => {
    const m = new Map<string, LibraryExercise["last"]>();
    for (const e of library ?? []) m.set(e.name.toLowerCase(), e.last);
    return m;
  }, [library]);

  const lastLine = (last: LibraryExercise["last"]) =>
    last ? `You've done this before · last ${formatLoad(last.value, last.type) || `${last.value} kg`}` : null;

  const list: Candidate[] = useMemo(() => {
    const baseLower = base?.name.toLowerCase() ?? "";
    const skip = (n: string) => n.toLowerCase() === baseLower || exclude.has(n.toLowerCase());
    const query = q.trim().toLowerCase();
    if (query) {
      const out = new Map<string, Candidate>();
      for (const e of library ?? []) {
        if (!e.name.toLowerCase().includes(query) || skip(e.name)) continue;
        out.set(e.name.toLowerCase(), {
          name: e.name,
          category: asCategory(e.category) ?? guessCategory(e.name),
          sub: lastLine(e.last) ?? "From your exercise list",
          loadType: e.last?.type ?? null,
          last: e.last,
        });
      }
      for (const a of catalog()) {
        if (!a.name.toLowerCase().includes(query) || skip(a.name) || out.has(a.name.toLowerCase())) continue;
        out.set(a.name.toLowerCase(), { name: a.name, category: a.category, sub: a.tip ?? needsLabel(a), loadType: altLoadType(a), last: null });
      }
      return Array.from(out.values()).slice(0, 12);
    }
    if (tab === "gym") {
      return (library ?? [])
        .filter((e) => (asCategory(e.category) ?? guessCategory(e.name)) === cat && !skip(e.name))
        .sort((a, b) => Number(!!b.last) - Number(!!a.last) || a.name.localeCompare(b.name))
        .slice(0, 12)
        .map((e) => ({
          name: e.name,
          category: cat,
          sub: lastLine(e.last) ?? "From your exercise list",
          loadType: e.last?.type ?? null,
          last: e.last,
        }));
    }
    return pickerOptions(base?.name ?? "", cat, tab)
      .filter((a) => !skip(a.name))
      .map((a) => {
        const last = lastByLower.get(a.name.toLowerCase()) ?? null;
        return {
          name: a.name,
          category: a.category,
          sub: [a.tip, needsLabel(a)].filter(Boolean).join(" · ") + (last ? ` · last ${formatLoad(last.value, last.type)}` : ""),
          loadType: altLoadType(a),
          last,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, cat, library, exclude, base?.name, lastByLower]);

  const typed = q.trim();
  const showTyped =
    typed.length > 1 &&
    !list.some((c) => c.name.toLowerCase() === typed.toLowerCase()) &&
    typed.toLowerCase() !== (base?.name.toLowerCase() ?? "");

  function choose(c: Candidate) {
    setSel(c);
    const t = c.loadType ?? base?.load_type ?? "total_kg";
    setLoadType(t);
    if (c.last && (c.last.type === t || c.last.type == null)) setLoad(String(c.last.value));
    else if (t === "bodyweight" || t === "none") setLoad("");
    else if (base && base.load_type === t) setLoad(base.load);
    else setLoad("");
  }

  const option = (c: Candidate, i: number, n: number) => {
    const on = sel?.name === c.name;
    return (
      <li key={c.name} className={i < n - 1 ? "border-b border-hairline" : ""}>
        <button
          type="button"
          aria-pressed={on}
          onClick={() => choose(c)}
          className={`flex min-h-[56px] w-full items-center justify-between gap-3 px-3 py-2 text-left ${on ? "bg-green-soft" : ""}`}
        >
          <span className="min-w-0">
            <span className={`block text-sm text-ink ${on ? "font-bold" : "font-semibold"}`}>{c.name}</span>
            <span className="block text-xs text-muted">{c.sub}</span>
          </span>
          {on ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-green">
              <path d="M5 12l5 5 9-10" />
            </svg>
          ) : null}
        </button>
      </li>
    );
  };

  const all = showTyped
    ? [{ name: typed, category: cat ?? guessCategory(typed), sub: "Use the name you typed", loadType: null, last: lastByLower.get(typed.toLowerCase()) ?? null }, ...list]
    : list;
  const fieldCls = "field tnum w-full bg-card px-2.5 text-[15px] font-bold outline-none focus:border-green";

  return (
    <div className="flex flex-col gap-2.5">
      <label className="field flex items-center gap-2 text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="sr-only">Search or type an exercise</span>
        <input
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search or type any exercise"
          className="min-h-[42px] min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </label>

      {!typed ? (
        <>
          <div role="tablist" aria-label="Where" className="flex gap-5 border-b border-hairline">
            {(["gym", "home", "bodyweight"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls={listId}
                onClick={() => setTab(t)}
                className="tab"
              >
                {t === "gym" ? "Gym" : t === "home" ? "Home" : "Bodyweight"}
              </button>
            ))}
          </div>
          {!base ? (
            <label className="flex items-center gap-2 text-xs font-bold text-muted">
              Muscles
              <select
                value={cat ?? ""}
                onChange={(e) => setCat(asCategory(e.target.value))}
                className="field min-w-0 flex-1 bg-card text-sm font-semibold text-ink"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="text-xs font-bold text-muted">Same muscles</span>
        </>
      ) : (
        <span className="text-xs font-bold text-muted">Matches</span>
      )}

      {tab === "gym" && !typed && library === null ? (
        <p id={listId} className="text-sm text-muted">
          Loading your exercises…
        </p>
      ) : all.length ? (
        <ul id={listId} className="overflow-hidden rounded-[16px] border border-control-border">
          {all.map((c, i) => option(c, i, all.length))}
        </ul>
      ) : (
        <p id={listId} className="text-sm text-muted">
          {typed ? "Nothing matches. Keep typing to use your own name." : "No suggestions here yet. Try another tab or type a name."}
        </p>
      )}

      {sel ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
              Sets
              <input value={sets} inputMode="numeric" onChange={(e) => setSets(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
              Reps
              <input value={reps} maxLength={20} onChange={(e) => setReps(e.target.value)} className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
              Load ({loadUnitLabel(loadType)})
              <input
                value={load}
                inputMode="decimal"
                disabled={loadType === "none"}
                onChange={(e) => setLoad(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                className={fieldCls}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-muted">
            Load type
            <select
              value={loadType ?? "none"}
              onChange={(e) => setLoadType(e.target.value as LoadType)}
              className="field min-h-[40px] min-w-0 flex-1 bg-card text-[13px] font-semibold text-ink"
            >
              {LOAD_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onPick({ name: sel.name, category: sel.category, sets, reps, load, load_type: loadType })}
            className="btn-primary btn-primary-green w-full text-sm"
          >
            Use {sel.name}
          </button>
        </>
      ) : null}
      <p className="text-center text-[11px] text-muted">Suggestions come from your exercise list. No AI, no cost.</p>
    </div>
  );
}
