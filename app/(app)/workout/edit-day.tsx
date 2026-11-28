"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEditLibrary, resetDayEdits, saveDayEdits, type LibraryExercise } from "./edit-actions";
import { LOAD_TYPE_OPTIONS, MAX_DAY_ITEMS, type DayItem, type DayItemInput } from "@/lib/day-edits";
import { formatLoad, loadUnitLabel, type LoadType } from "@/lib/program-schema";
import { CATEGORY_LABEL, guessCategory, type Category } from "@/lib/home-swaps";
import { ErrorLine, Sheet, newKey } from "./sheet";
import { SwapPicker, type Picked } from "./swap-picker";
import { radioKeys } from "@/components/app/a11y";

type Row = {
  key: string;
  source_id: string | null;
  name: string;
  category: Category | null;
  activity: boolean;
  sets: string;
  reps: string;
  load: string;
  load_type: LoadType | null;
  target_rpe_low: number | null;
  target_rpe_high: number | null;
  swapped_from: string | null;
};

type View = { kind: "list" } | { kind: "swap"; key: string } | { kind: "add" };
type Mode = "week" | "forward";
const MODES: readonly Mode[] = ["week", "forward"];

const toRow = (it: DayItem): Row => ({
  key: it.key,
  source_id: it.source_id,
  name: it.name,
  category: it.category,
  activity: it.activity,
  sets: it.prescribed_sets != null ? String(it.prescribed_sets) : "",
  reps: it.rep_scheme ?? "",
  load: it.suggested_load_value != null ? String(it.suggested_load_value) : "",
  load_type: it.suggested_load_type,
  target_rpe_low: it.target_rpe_low,
  target_rpe_high: it.target_rpe_high,
  swapped_from: it.swapped_from,
});

const numOrNull = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const toInput = (r: Row): DayItemInput => ({
  key: r.key,
  source_id: r.source_id,
  name: r.name,
  category: r.category,
  activity: r.activity,
  prescribed_sets: r.activity ? 1 : numOrNull(r.sets),
  rep_scheme: r.activity ? null : r.reps.trim() || null,
  suggested_load_value: numOrNull(r.load),
  suggested_load_type: r.activity ? "time_min" : r.load_type,
  target_rpe_low: r.target_rpe_low,
  target_rpe_high: r.target_rpe_high,
  coach_note: null, // the server keeps the program's own note
  swapped_from: r.swapped_from,
});

const rx = (r: Row) =>
  [r.sets && r.reps ? `${r.sets} × ${r.reps}` : r.reps, formatLoad(numOrNull(r.load), r.load_type)].filter(Boolean).join(" · ");

const iconBtn =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-control-border bg-card";

// "Edit day…" beside the day dropdown → a solid sheet to swap / edit / remove /
// add exercises and activities, for this week only or from now on. No AI.
export function EditDay({
  dayId,
  dayName,
  items,
  weekEdit,
  weekEnded,
}: {
  dayId: string;
  dayName: string;
  items: DayItem[];
  weekEdit: boolean;
  weekEnded: boolean;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [mode, setMode] = useState<Mode>("week");
  const applyId = useId();
  const [activity, setActivity] = useState<{ name: string; minutes: string } | null>(null);
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setRows(items.map(toRow));
    setEditing(null);
    setView({ kind: "list" });
    setMode(weekEnded ? "forward" : "week");
    setActivity(null);
    setError(null);
    setOpen(true);
    if (library === null)
      getEditLibrary()
        .then((r) => setLibrary(r.ok ? r.exercises : []))
        .catch(() => setLibrary([]));
  }

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function pick(p: Picked) {
    if (view.kind === "swap") {
      setRows((rs) =>
        rs.map((r) => {
          if (r.key !== view.key) return r;
          const original = r.swapped_from ?? (r.source_id ? r.name : null);
          return {
            ...r,
            // New row key so sets typed for the old exercise don't carry over.
            key: newKey(),
            name: p.name,
            category: p.category ?? guessCategory(p.name),
            sets: p.sets,
            reps: p.reps,
            load: p.load,
            load_type: p.load_type,
            swapped_from: original && original.toLowerCase() !== p.name.toLowerCase() ? original : null,
          };
        })
      );
    } else if (view.kind === "add") {
      setRows((rs) => [
        ...rs,
        {
          key: newKey(),
          source_id: null,
          name: p.name,
          category: p.category ?? guessCategory(p.name),
          activity: false,
          sets: p.sets,
          reps: p.reps,
          load: p.load,
          load_type: p.load_type,
          target_rpe_low: null,
          target_rpe_high: null,
          swapped_from: null,
        },
      ]);
    }
    setView({ kind: "list" });
  }

  function addActivity() {
    if (!activity) return;
    const name = activity.name.trim();
    const minutes = Number(activity.minutes);
    if (!name) return setError("Type the activity's name.");
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return setError("Minutes should be between 1 and 600.");
    setError(null);
    setRows((rs) => [
      ...rs,
      {
        key: newKey(),
        source_id: null,
        name,
        category: guessCategory(name) ?? "cardio",
        activity: true,
        sets: "1",
        reps: "",
        load: String(Math.round(minutes)),
        load_type: "time_min",
        target_rpe_low: null,
        target_rpe_high: null,
        swapped_from: null,
      },
    ]);
    setActivity(null);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error ?? "Something went wrong.");
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!rows.length) return setError("Keep at least one exercise, or skip the day instead.");
    if (rows.length > MAX_DAY_ITEMS) return setError(`Up to ${MAX_DAY_ITEMS} exercises a day.`);
    void run(() => saveDayEdits(dayId, mode, rows.map(toInput)));
  }

  const swapRow = view.kind === "swap" ? rows.find((r) => r.key === view.key) ?? null : null;
  const exclude = new Set(rows.map((r) => r.name.toLowerCase()));
  const commonCat = (() => {
    const counts = new Map<Category, number>();
    for (const r of rows) if (r.category && !r.activity) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "push";
  })();

  const title =
    view.kind === "swap" && swapRow ? `Swap ${swapRow.name}` : view.kind === "add" ? "Add an exercise" : `Edit ${dayName}`;
  const subtitle =
    view.kind === "swap" && swapRow?.category ? CATEGORY_LABEL[swapRow.category] : null;
  const smallField = "field tnum w-full bg-card px-2.5 text-[15px] font-bold outline-none focus:border-green";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        onClick={openSheet}
        className="btn-secondary shrink-0 px-3.5 text-[13px]"
      >
        Edit day…
      </button>
      {open ? (
        <Sheet
          title={title}
          subtitle={subtitle}
          onClose={() => setOpen(false)}
          onBack={view.kind !== "list" ? () => setView({ kind: "list" }) : undefined}
          returnFocus={btnRef}
        >
          {view.kind !== "list" ? (
            <SwapPicker
              key={view.kind === "swap" ? view.key : "add"}
              base={swapRow}
              library={library}
              exclude={exclude}
              defaultCategory={commonCat}
              onPick={pick}
            />
          ) : (
            <>
              {weekEdit ? (
                <p className="rounded-[14px] bg-field px-3 py-2.5 text-xs text-muted">
                  This day already has changes for this week.{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => resetDayEdits(dayId))}
                    className="min-h-[40px] font-semibold text-ink underline"
                  >
                    Reset to the plan
                  </button>
                </p>
              ) : null}
              {rows.length ? (
                <ul className="overflow-hidden rounded-[16px] border border-control-border">
                  {rows.map((r, i) => {
                    const last = i === rows.length - 1;
                    if (editing === r.key && !r.activity) {
                      return (
                        <li key={r.key} className={`flex flex-col gap-2 bg-field px-3 py-2.5 ${last ? "" : "border-b border-hairline"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-ink">{r.name}</span>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="min-h-[40px] px-1 text-[11px] font-bold text-green"
                            >
                              Done editing
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
                              Sets
                              <input
                                value={r.sets}
                                inputMode="numeric"
                                onChange={(e) => patch(r.key, { sets: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                                className={smallField}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
                              Reps
                              <input
                                value={r.reps}
                                maxLength={20}
                                onChange={(e) => patch(r.key, { reps: e.target.value })}
                                className={smallField}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
                              Load ({loadUnitLabel(r.load_type)})
                              <input
                                value={r.load}
                                inputMode="decimal"
                                disabled={r.load_type === "none"}
                                onChange={(e) => patch(r.key, { load: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) })}
                                className={smallField}
                              />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] font-semibold text-muted">
                            Load type
                            <select
                              value={r.load_type ?? "none"}
                              onChange={(e) => patch(r.key, { load_type: e.target.value as LoadType })}
                              className="field min-h-[40px] min-w-0 flex-1 bg-card text-[13px] font-semibold text-ink"
                            >
                              {LOAD_TYPE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={r.key}
                        className={`flex items-center gap-1.5 py-1.5 pl-3 pr-1.5 ${last ? "" : "border-b border-hairline"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                            {r.name}
                            {!r.source_id ? <span className="mark mark-green">Added</span> : null}
                          </p>
                          <p className="text-xs text-muted">
                            {r.activity ? `Extra activity · ${r.load} min` : rx(r) || "No sets set yet"}
                            {r.swapped_from ? ` · instead of ${r.swapped_from}` : ""}
                          </p>
                        </div>
                        {!r.activity ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Swap ${r.name}`}
                              onClick={() => setView({ kind: "swap", key: r.key })}
                              className="flex min-h-[40px] items-center rounded-control border border-control-border bg-card px-2.5 text-xs font-bold text-ink"
                            >
                              Swap
                            </button>
                            <button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.key)} className={`${iconBtn} text-ink`}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 20h4L19 9l-4-4L4 16z" />
                              </svg>
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Remove ${r.name}`}
                          onClick={() => {
                            setRows((rs) => rs.filter((x) => x.key !== r.key));
                            if (editing === r.key) setEditing(null);
                          }}
                          className={`${iconBtn} text-ember-text`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-[14px] bg-field px-3 py-2.5 text-sm text-muted">No exercises left. Add one below.</p>
              )}

              {activity ? (
                <div className="flex flex-col gap-2 rounded-[16px] border border-control-border p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
                      Activity
                      <input
                        value={activity.name}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => setActivity({ ...activity, name: e.target.value })}
                        placeholder="e.g. Badminton"
                        className="field w-full bg-card text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-muted focus:border-green"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
                      Minutes
                      <input
                        value={activity.minutes}
                        inputMode="numeric"
                        onChange={(e) => setActivity({ ...activity, minutes: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                        className={smallField}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setActivity(null)} className="btn-secondary text-[13px]">
                      Cancel
                    </button>
                    <button type="button" onClick={addActivity} className="btn-primary btn-primary-green text-[13px]">
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setView({ kind: "add" })}
                    className="min-h-[44px] rounded-control border border-dashed border-muted text-[13px] font-bold text-ink"
                  >
                    + Add exercise
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivity({ name: "", minutes: "60" })}
                    className="min-h-[44px] rounded-control border border-dashed border-muted text-[13px] font-bold text-ink"
                  >
                    + Add activity
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span id={applyId} className="text-xs font-bold text-muted">
                  Apply to
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={applyId}
                  onKeyDown={radioKeys(MODES, mode, setMode, (m) => m === "week" && weekEnded)}
                  className="grid grid-cols-2 rounded-[12px] bg-segment p-[3px]"
                >
                  {(
                    [
                      ["week", "This week only"],
                      ["forward", "From now on"],
                    ] as [Mode, string][]
                  ).map(([m, label]) => {
                    const on = mode === m;
                    const off = m === "week" && weekEnded;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on ? 0 : -1}
                        disabled={off}
                        onClick={() => setMode(m)}
                        className={`min-h-[40px] rounded-control text-[13px] disabled:opacity-55 ${
                          on ? "bg-ink font-bold text-card" : "font-semibold text-muted"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted">
                  {weekEnded
                    ? "This week has ended, so changes go into your plan."
                    : mode === "week"
                      ? "Only this week changes. Next week goes back to your plan."
                      : weekEdit
                        ? "Your plan changes for every week after this, and this week's separate changes are cleared."
                        : "Your plan changes for every week after this."}
                </p>
              </div>

              <ErrorLine error={error} />
              <button type="button" disabled={busy} onClick={save} className="btn-primary btn-primary-green w-full text-[15px]">
                {busy ? "Saving…" : "Save changes"}
              </button>
              <p className="text-center text-[11px] text-muted">
                Your changes save straight away. Your coach sees them in the weekly review.
              </p>
            </>
          )}
        </Sheet>
      ) : null}
    </>
  );
}
