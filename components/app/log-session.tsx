"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logSession, type SetInput } from "@/app/(app)/workout/actions";
import { formatLoad, loadUnitLabel, type LoadType } from "@/lib/program-schema";
import { getSessionShare } from "@/app/(app)/workout/share-actions";
import { ShareSheet } from "@/components/app/share-sheet";
import type { ShareBundle } from "@/lib/share-cards";

export type LogExercise = {
  // Row key for this day's list: the program_exercise id, a "This week only"
  // row id, or "home:<id>" for a home swap — so gym and home sets typed for
  // the same slot stay apart in the draft.
  rowKey: string;
  exerciseId: string; // "" = found / added by name when the session is saved
  name: string;
  category: string | null;
  activity?: boolean; // extra activity (minutes only)
  homeFor?: string | null; // gym exercise this home version stands in for
  homeTip?: string | null;
  subline?: string | null; // short muted line ("Same as gym", "Added this week")
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
  home = false,
}: {
  userId: string;
  dayId: string;
  type: string | null;
  exercises: LogExercise[];
  home?: boolean; // "At home today" is on (saved in the draft too)
}) {
  const router = useRouter();
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Share card for the session just logged (numbers re-read from the saved rows).
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareBundle, setShareBundle] = useState<ShareBundle | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const closeShare = useCallback(() => {
    setShareOpen(false);
    shareBtnRef.current?.focus();
  }, []);
  // Which exercise has the logging UI open, and which set row is being edited.
  // Both are part of the draft, so coming back to Train reopens where you were.
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);

  // Draft survives a mobile reload / tab switch until the session is submitted.
  const draftKey = `xclr-draft-workout-${userId}-${dayId}`;
  const persistReady = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as {
          cells?: Record<string, Cell>;
          note?: string;
          active?: number;
          editing?: number | null;
        };
        if (d.cells) setCells(d.cells);
        if (typeof d.note === "string") {
          setNote(d.note);
          if (d.note.trim()) setNoteOpen(true);
        }
        if (typeof d.active === "number" && d.active >= 0 && d.active < exercises.length) setActive(d.active);
        if (typeof d.editing === "number" || d.editing === null) setEditing(d.editing ?? null);
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
      // Cells are keyed by row (home rows are "home:…"), so switching At home
      // on/off or editing the day keeps every typed set; `home` records the mode.
      localStorage.setItem(draftKey, JSON.stringify({ cells, note, active, editing, home }));
    } catch {
      // storage unavailable/full — non-fatal
    }
  }, [draftKey, cells, note, active, editing, home]);

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
        const c = cells[key(ex.rowKey, i)];
        if (!c) continue;
        const load = c.load.trim() === "" ? null : Number(c.load) || null;
        const reps = c.reps.trim() === "" ? null : Math.round(Number(c.reps)) || null;
        const rpe = c.rpe.trim() === "" ? null : Number(c.rpe) || null;
        if (reps == null && load == null) continue;
        sets.push({
          exercise_id: ex.exerciseId,
          // Home swaps are recorded as the exercise actually performed.
          exercise_name: ex.exerciseId ? null : ex.name,
          category: ex.exerciseId ? null : ex.category,
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
      setSessionId(r.sessionId);
      setDone(true);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function openShare() {
    if (shareBundle) {
      setShareOpen(true);
      return;
    }
    if (!sessionId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const r = await getSessionShare(sessionId);
      if (r.ok) {
        setShareBundle(r.bundle);
        setShareOpen(true);
      } else setShareError(r.error);
    } catch {
      setShareError("Couldn't reach the server. Try again.");
    }
    setShareBusy(false);
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-card bg-green-soft p-5 text-center shadow-card">
          <p className="font-display text-xl font-bold text-green">Session logged</p>
          <p className="mt-1 text-sm font-medium text-muted">
            Nice work. It&apos;s in your history and feeds next week&apos;s review.
          </p>
        </div>
        {sessionId ? (
          <button
            ref={shareBtnRef}
            type="button"
            aria-haspopup="dialog"
            onClick={() => void openShare()}
            disabled={shareBusy}
            className="btn-primary w-full text-sm"
          >
            {shareBusy ? "Getting your numbers…" : "Share this session"}
          </button>
        ) : null}
        {shareError ? (
          <p role="alert" className="px-1 text-sm font-medium text-ink">
            {shareError}
          </p>
        ) : null}
        {shareOpen && shareBundle ? (
          <ShareSheet bundle={shareBundle} initialTab="session" onClose={closeShare} />
        ) : null}
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
    for (let i = 0; i < count; i++) if (isLogged(ex.rowKey, i)) n++;
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
    (_, i) => !isLogged(ex.rowKey, i)
  );

  const editRow = (i: number) => {
    const c = get(ex.rowKey, i, ex.suggested_load_value);
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
                set(ex.rowKey, i, { load: e.target.value }, ex.suggested_load_value)
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
                set(ex.rowKey, i, { reps: e.target.value }, ex.suggested_load_value)
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
                set(ex.rowKey, i, { rpe: e.target.value }, ex.suggested_load_value)
              }
              aria-label={`${ex.name} set ${i + 1} RPE`}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            // Minutes come prefilled for an activity / timed item: "Done"
            // counts that set even if nothing was retyped.
            if (ex.suggested_load_type === "time_min" && !cells[key(ex.rowKey, i)] && ex.suggested_load_value != null)
              set(ex.rowKey, i, {}, ex.suggested_load_value);
            setEditing(null);
          }}
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
        {ex.homeFor ? (
          <p className="text-xs text-muted">
            Home swap for <strong className="font-bold text-ink">{ex.homeFor}</strong>
            {ex.homeTip ? ` · ${ex.homeTip}` : ""}
          </p>
        ) : ex.subline ? (
          <p className="text-xs text-muted">{ex.subline}</p>
        ) : null}
        {ex.coach_note ? (
          <p className="text-xs font-medium text-green">Coach: {ex.coach_note}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: count }).map((_, i) => {
            if (!isLogged(ex.rowKey, i) || editing === i) return null;
            const c = cells[key(ex.rowKey, i)];
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
                  key={e.rowKey}
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
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {e.name}
                        {logged > 0 ? (
                          <span className="mark mark-green tnum">
                            {logged}/{total}
                          </span>
                        ) : null}
                      </span>
                      {e.homeFor || e.subline ? (
                        <span className="block text-[11px] text-muted">
                          {e.homeFor ? `Swap for ${e.homeFor}` : e.subline}
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
