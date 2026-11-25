"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logSession, type SetInput } from "@/app/(app)/workout/actions";
import { formatLoad, loadUnitLabel, type LoadType } from "@/lib/program-schema";

export type LogExercise = {
  programExerciseId: string;
  exerciseId: string;
  name: string;
  prescribed_sets: number | null;
  rep_scheme: string | null;
  suggested_load_value: number | null;
  suggested_load_type: LoadType | null;
  target_rpe_low: number | null;
  target_rpe_high: number | null;
  coach_note: string | null;
};

type Cell = { load: string; reps: string; rpe: string };

export function LogSession({
  userId,
  dayId,
  type,
  exercises,
}: {
  userId: string;
  dayId: string;
  type: string | null;
  exercises: LogExercise[];
}) {
  const router = useRouter();
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft survives a mobile reload / tab switch until the session is submitted.
  const draftKey = `xclr-draft-workout-${userId}-${dayId}`;
  const persistReady = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { cells?: Record<string, Cell>; note?: string };
        if (d.cells) setCells(d.cells);
        if (typeof d.note === "string") setNote(d.note);
      }
    } catch {
      // ignore a malformed draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    // Skip the first run so the empty initial state doesn't clobber the draft
    // we just hydrated above.
    if (!persistReady.current) {
      persistReady.current = true;
      return;
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify({ cells, note }));
    } catch {
      // storage unavailable/full — non-fatal
    }
  }, [draftKey, cells, note]);

  const key = (peId: string, i: number) => `${peId}:${i}`;
  const get = (peId: string, i: number, suggested: number | null): Cell =>
    cells[key(peId, i)] ?? {
      load: suggested != null ? String(suggested) : "",
      reps: "",
      rpe: "",
    };
  const set = (peId: string, i: number, patch: Partial<Cell>, suggested: number | null) =>
    setCells((c) => ({
      ...c,
      [key(peId, i)]: { ...get(peId, i, suggested), ...patch },
    }));

  async function finish() {
    setBusy(true);
    setError(null);
    const sets: SetInput[] = [];
    for (const ex of exercises) {
      const count = Math.max(1, ex.prescribed_sets ?? 1);
      for (let i = 0; i < count; i++) {
        const c = cells[key(ex.programExerciseId, i)];
        if (!c) continue;
        const load = c.load.trim() === "" ? null : Number(c.load) || null;
        const reps = c.reps.trim() === "" ? null : Math.round(Number(c.reps)) || null;
        const rpe = c.rpe.trim() === "" ? null : Number(c.rpe) || null;
        if (reps == null && load == null) continue;
        sets.push({
          exercise_id: ex.exerciseId,
          set_index: i + 1,
          load_value: load,
          load_type: ex.suggested_load_type,
          reps,
          rpe,
        });
      }
    }
    let r: Awaited<ReturnType<typeof logSession>>;
    try {
      r = await logSession(dayId, type, sets, note);
    } catch {
      // Dropped connection / server error: nothing is confirmed, keep the draft.
      r = { ok: false, error: "Couldn't reach the server. Your sets are still here — try again." };
    }
    setBusy(false);
    if (r.ok === true) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // non-fatal
      }
      setDone(true);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  // Which exercise has the logging UI open, and which set row is being edited.
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);

  if (done) {
    return (
      <div className="rounded-card bg-green-soft p-5 text-center shadow-card">
        <p className="font-display text-xl font-bold text-green">Session logged</p>
        <p className="mt-1 text-sm font-medium text-muted">
          Nice work. It&apos;s in your history and feeds next week&apos;s review.
        </p>
      </div>
    );
  }

  const isLogged = (peId: string, i: number) => {
    const c = cells[key(peId, i)];
    // Mirrors finish(): a set is sent once it has reps or a load.
    return !!c && (c.reps.trim() !== "" || c.load.trim() !== "");
  };
  const loggedCount = (ex: LogExercise) => {
    const count = Math.max(1, ex.prescribed_sets ?? 1);
    let n = 0;
    for (let i = 0; i < count; i++) if (isLogged(ex.programExerciseId, i)) n++;
    return n;
  };

  // Prescription line with the load (and its type) bolded.
  const prescription = (ex: LogExercise) => {
    const scheme =
      ex.prescribed_sets && ex.rep_scheme
        ? `${ex.prescribed_sets} × ${ex.rep_scheme}`
        : ex.rep_scheme;
    const load = formatLoad(ex.suggested_load_value, ex.suggested_load_type);
    const rpe =
      ex.target_rpe_low != null && ex.target_rpe_high != null
        ? `RPE ${ex.target_rpe_low}–${ex.target_rpe_high}`
        : null;
    const parts: React.ReactNode[] = [];
    if (scheme) parts.push(scheme);
    if (load)
      parts.push(
        <strong key="load" className="font-bold text-ink">
          {load}
        </strong>
      );
    if (rpe) parts.push(rpe);
    return parts.map((p, i) => (
      <span key={i}>
        {i > 0 ? " · " : ""}
        {p}
      </span>
    ));
  };

  const fieldCls =
    "field tnum w-full px-2 text-center text-sm font-medium outline-none placeholder:text-muted focus:border-green";

  const activeIdx = Math.min(active, exercises.length - 1);
  const ex = exercises[activeIdx];
  const count = Math.max(1, ex.prescribed_sets ?? 1);
  const nextEmpty = Array.from({ length: count }).findIndex(
    (_, i) => !isLogged(ex.programExerciseId, i)
  );

  const editRow = (i: number) => {
    const c = get(ex.programExerciseId, i, ex.suggested_load_value);
    const unit = loadUnitLabel(ex.suggested_load_type);
    return (
      <div className="flex flex-col gap-2 rounded-tile bg-field p-3">
        <p className="text-xs font-bold text-ink">Set {i + 1}</p>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
            {unit}
            <input
              className={fieldCls}
              inputMode="decimal"
              value={c.load}
              onChange={(e) =>
                set(ex.programExerciseId, i, { load: e.target.value }, ex.suggested_load_value)
              }
              aria-label={`${ex.name} set ${i + 1} load`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
            reps
            <input
              className={fieldCls}
              inputMode="numeric"
              value={c.reps}
              onChange={(e) =>
                set(ex.programExerciseId, i, { reps: e.target.value }, ex.suggested_load_value)
              }
              aria-label={`${ex.name} set ${i + 1} reps`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
            RPE
            <input
              className={fieldCls}
              inputMode="decimal"
              value={c.rpe}
              onChange={(e) =>
                set(ex.programExerciseId, i, { rpe: e.target.value }, ex.suggested_load_value)
              }
              aria-label={`${ex.name} set ${i + 1} RPE`}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="btn-primary btn-primary-green w-full text-[13px]"
        >
          Done with set {i + 1}
        </button>
      </div>
    );
  };

  const others = exercises
    .map((e, i) => ({ e, i }))
    .filter(({ i }) => i !== activeIdx);

  return (
    <div className="space-y-3">
      {/* Active exercise: the logging UI */}
      <section
        aria-label={ex.name}
        className="glass flex flex-col gap-2 px-3.5 py-3 shadow-[var(--shadow-card),inset_3px_0_0_var(--green)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-[15px] font-bold text-ink">{ex.name}</h3>
          <p className="tnum text-[13px] text-muted">{prescription(ex)}</p>
        </div>
        {ex.coach_note ? (
          <p className="text-xs font-medium text-green">Coach: {ex.coach_note}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: count }).map((_, i) => {
            if (!isLogged(ex.programExerciseId, i) || editing === i) return null;
            const c = cells[key(ex.programExerciseId, i)];
            const unit = loadUnitLabel(ex.suggested_load_type);
            const load = c.load.trim() !== "" ? `${c.load.trim()} ${unit}` : "";
            return (
              <button
                key={i}
                type="button"
                onClick={() => setEditing(i)}
                aria-label={`Edit set ${i + 1}: ${[load, c.reps && `${c.reps} reps`, c.rpe && `RPE ${c.rpe}`].filter(Boolean).join(", ")}`}
                className="tnum min-h-[44px] rounded-[8px] bg-green-soft px-2.5 font-display text-xs font-bold text-green"
              >
                {[load, c.reps.trim()].filter((v) => v !== "").join(" × ")}
                {c.rpe ? ` · ${c.rpe}` : ""}
              </button>
            );
          })}
          {editing == null && nextEmpty !== -1 ? (
            <button
              type="button"
              onClick={() => setEditing(nextEmpty)}
              className="min-h-[44px] rounded-[8px] border border-dashed border-muted bg-transparent px-3 text-xs font-bold text-ink"
            >
              + Set {nextEmpty + 1}
            </button>
          ) : null}
        </div>
        {editing != null ? editRow(editing) : null}
      </section>

      {/* Remaining exercises */}
      {others.length ? (
        <section aria-label="Other exercises" className="glass px-3.5 py-0.5">
          <ul>
            {others.map(({ e, i }, n) => {
              const logged = loggedCount(e);
              const total = Math.max(1, e.prescribed_sets ?? 1);
              return (
                <li
                  key={e.programExerciseId}
                  className={n < others.length - 1 ? "border-b border-hairline" : ""}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActive(i);
                      setEditing(null);
                    }}
                    className="flex min-h-[46px] w-full items-center justify-between gap-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {e.name}
                      {logged > 0 ? (
                        <span className="mark mark-green tnum">
                          {logged}/{total}
                        </span>
                      ) : null}
                    </span>
                    <span className="tnum shrink-0 text-right text-[13px] text-muted">
                      {prescription(e)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {noteOpen || note ? (
        <div className="glass flex flex-col gap-1.5 px-3.5 py-3">
          <label className="text-sm font-bold text-ink" htmlFor="session-note">
            Session note <span className="font-medium text-muted">(optional)</span>
          </label>
          <textarea
            id="session-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            autoFocus={noteOpen && !note}
            placeholder="e.g. felt strong, or wrist a bit sore today"
            className="field w-full resize-none py-3 text-sm font-medium outline-none placeholder:text-muted focus:border-green"
          />
          <p className="text-[11px] text-muted">Your coach reads this in the weekly review.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="btn-secondary self-start px-3 text-[13px]"
        >
          + Add a session note
        </button>
      )}

      {error ? (
        <p
          role="alert"
          className="pop !rounded-tile px-4 py-3 text-sm font-medium text-ink shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void finish()}
        disabled={busy}
        className="btn-primary btn-primary-green w-full text-sm"
      >
        {busy ? "Saving…" : "Finish session"}
      </button>
    </div>
  );
}
