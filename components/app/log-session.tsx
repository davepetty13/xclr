"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logSession, type SetInput } from "@/app/(app)/workout/actions";
import { formatLoad, type LoadType } from "@/lib/program-schema";

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
    const r = await logSession(dayId, type, sets, note);
    setBusy(false);
    if (r.ok) {
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

  if (done) {
    return (
      <div className="rounded-tile border border-line bg-green-soft p-5 text-center">
        <p className="font-serif text-xl font-medium text-green">
          Session logged 💪
        </p>
        <p className="mt-1 text-sm font-medium text-muted">
          Nice work. It&apos;s in your history and feeds next week&apos;s review.
        </p>
      </div>
    );
  }

  const cellCls =
    "tnum w-full rounded-chip border border-line bg-paper px-2 py-2 text-center text-sm font-medium text-ink outline-none placeholder:text-faint focus:border-green";

  return (
    <div className="space-y-4">
      {exercises.map((ex) => {
        const count = Math.max(1, ex.prescribed_sets ?? 1);
        const prescribed = formatLoad(ex.suggested_load_value, ex.suggested_load_type);
        const rpe =
          ex.target_rpe_low != null && ex.target_rpe_high != null
            ? `RPE ${ex.target_rpe_low}–${ex.target_rpe_high}`
            : null;
        return (
          <div key={ex.programExerciseId} className="rounded-tile border border-line bg-card p-4">
            <p className="text-sm font-semibold text-ink">{ex.name}</p>
            <p className="tnum mt-0.5 text-sm text-muted">
              {[
                ex.prescribed_sets && ex.rep_scheme
                  ? `${ex.prescribed_sets} × ${ex.rep_scheme}`
                  : ex.rep_scheme,
                prescribed,
                rpe,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {ex.coach_note ? (
              <p className="mt-1 text-xs font-medium text-green">{ex.coach_note}</p>
            ) : null}

            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr] items-center gap-2 text-xs font-semibold text-faint">
                <span>Set</span>
                <span className="text-center">load</span>
                <span className="text-center">reps</span>
                <span className="text-center">RPE</span>
              </div>
              {Array.from({ length: count }).map((_, i) => {
                const c = get(ex.programExerciseId, i, ex.suggested_load_value);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1.5rem_1fr_1fr_1fr] items-center gap-2"
                  >
                    <span className="tnum text-sm font-semibold text-muted">{i + 1}</span>
                    <input
                      className={cellCls}
                      inputMode="decimal"
                      value={c.load}
                      onChange={(e) =>
                        set(ex.programExerciseId, i, { load: e.target.value }, ex.suggested_load_value)
                      }
                      aria-label={`${ex.name} set ${i + 1} load`}
                    />
                    <input
                      className={cellCls}
                      inputMode="numeric"
                      value={c.reps}
                      onChange={(e) =>
                        set(ex.programExerciseId, i, { reps: e.target.value }, ex.suggested_load_value)
                      }
                      aria-label={`${ex.name} set ${i + 1} reps`}
                    />
                    <input
                      className={cellCls}
                      inputMode="decimal"
                      value={c.rpe}
                      onChange={(e) =>
                        set(ex.programExerciseId, i, { rpe: e.target.value }, ex.suggested_load_value)
                      }
                      aria-label={`${ex.name} set ${i + 1} RPE`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div>
        <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="session-note">
          Session note
        </label>
        <textarea
          id="session-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. felt strong, or wrist a bit sore today"
          className="w-full resize-none rounded-chip border border-line bg-paper px-4 py-3 text-sm font-medium text-ink outline-none placeholder:text-faint focus:border-green"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void finish()}
        disabled={busy}
        className="w-full rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Finish session"}
      </button>
    </div>
  );
}
