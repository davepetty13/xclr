"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateProgram, approveProgram } from "@/app/program/actions";
import { formatLoad, type GeneratedProgram } from "@/lib/program-schema";
import { AutoGrowTextarea, TextField } from "@/components/onboarding/controls";

type Phase = "building" | "preview" | "error";

const DAY_BADGE: Record<string, string> = {
  strength: "bg-green-soft text-green",
  cardio: "bg-ember-soft text-ember",
  recovery: "bg-paper text-muted",
  rest: "bg-paper text-muted",
};

export function ProgramBuilder({
  displayName,
  goalLabel,
}: {
  displayName: string;
  goalLabel: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("building");
  const [program, setProgram] = useState<GeneratedProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  async function build() {
    setPhase("building");
    setError(null);
    const result = await generateProgram();
    if (result.ok) {
      setProgram(result.program);
      setPhase("preview");
    } else {
      setError(result.error);
      setPhase("error");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setProgramName(name: string) {
    setProgram((p) => (p ? { ...p, program: { ...p.program, name } } : p));
  }
  function editExercise(
    dayIdx: number,
    exIdx: number,
    patch: Partial<GeneratedProgram["days"][number]["exercises"][number]>
  ) {
    setProgram((p) => {
      if (!p) return p;
      const days = p.days.map((d, di) =>
        di !== dayIdx
          ? d
          : {
              ...d,
              exercises: d.exercises.map((e, ei) =>
                ei !== exIdx ? e : { ...e, ...patch }
              ),
            }
      );
      return { ...p, days };
    });
  }

  async function approve() {
    if (!program) return;
    setApproving(true);
    setError(null);
    const result = await approveProgram(program);
    if (result.ok) {
      router.replace("/");
      router.refresh();
    } else {
      setError(result.error);
      setApproving(false);
    }
  }

  // ---- building moment ----
  if (phase === "building") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-soft">
          <span className="h-4 w-4 animate-ping rounded-full bg-green" />
        </span>
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink">
          Xclr is building your program…
        </h1>
        <p className="mt-3 text-sm font-medium text-muted">
          Shaping a {goalLabel.toLowerCase()} plan around your availability. This
          takes a few seconds.
        </p>
      </main>
    );
  }

  // ---- error ----
  if (phase === "error" || !program) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-ink">
          That didn&apos;t work
        </h1>
        <p className="mt-3 text-sm font-medium text-muted">
          {error ?? "Something went wrong building your program."}
        </p>
        <button
          type="button"
          onClick={() => void build()}
          className="mt-6 rounded-chip bg-green px-6 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </main>
    );
  }

  // ---- preview ----
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
        Your program — review &amp; approve
      </p>
      <div className="mt-2">
        <TextField
          value={program.program.name}
          onChange={setProgramName}
          ariaLabel="Program name"
        />
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-faint">
          {program.program.days_per_week} days / week
        </p>
      </div>

      {program.summary_for_user ? (
        <p className="mt-4 text-sm font-medium text-muted">
          {program.summary_for_user}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {program.days.map((day, di) => (
          <div key={di} className="rounded-tile border border-line bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-medium text-ink">
                Day {day.day_index} · {day.label}
              </h2>
              <span
                className={`rounded-chip px-2.5 py-1 text-xs font-semibold capitalize ${
                  DAY_BADGE[day.type] ?? "bg-paper text-muted"
                }`}
              >
                {day.type}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {day.exercises.map((ex, ei) => {
                const load = formatLoad(ex.suggested_load_value, ex.suggested_load_type);
                const rpe =
                  ex.target_rpe_low != null && ex.target_rpe_high != null
                    ? `RPE ${ex.target_rpe_low}–${ex.target_rpe_high}`
                    : null;
                return (
                  <div
                    key={ei}
                    className="rounded-chip border border-line bg-paper p-3"
                  >
                    <p className="text-sm font-semibold text-ink">{ex.exercise}</p>
                    <p className="tnum mt-0.5 text-sm text-muted">
                      {[
                        ex.prescribed_sets != null && ex.rep_scheme
                          ? `${ex.prescribed_sets} × ${ex.rep_scheme}`
                          : ex.rep_scheme,
                        load,
                        rpe,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {ex.suggested_load_type &&
                    ex.suggested_load_type !== "bodyweight" &&
                    ex.suggested_load_type !== "none" &&
                    ex.suggested_load_type !== "time_min" ? (
                      <div className="mt-2">
                        <TextField
                          value={
                            ex.suggested_load_value != null
                              ? String(ex.suggested_load_value)
                              : ""
                          }
                          onChange={(v) =>
                            editExercise(di, ei, {
                              suggested_load_value:
                                v.trim() === "" ? null : Number(v) || null,
                            })
                          }
                          inputMode="decimal"
                          suffix="kg"
                          ariaLabel={`${ex.exercise} load`}
                        />
                      </div>
                    ) : null}
                    {ex.coach_note != null ? (
                      <div className="mt-2">
                        <AutoGrowTextarea
                          value={ex.coach_note}
                          onChange={(v) => editExercise(di, ei, { coach_note: v })}
                          placeholder="Coach note"
                          ariaLabel={`${ex.exercise} coach note`}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {day.exercises.length === 0 ? (
                <p className="text-sm font-medium text-muted">Rest day.</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {program.flags.length ? (
        <ul className="mt-4 space-y-1">
          {program.flags.map((f, i) => (
            <li key={i} className="text-xs font-medium text-muted">
              · {f}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void build()}
          disabled={approving}
          className="rounded-chip border border-line bg-card px-5 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Regenerate
        </button>
        <button
          type="button"
          onClick={() => void approve()}
          disabled={approving}
          className="flex-1 rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {approving ? "Activating…" : "Approve & activate"}
        </button>
      </div>
      <p className="mt-3 text-center text-xs font-medium text-faint">
        {displayName ? `${displayName}, you` : "You"} can tweak loads and notes,
        or change your plan anytime from Goals.
      </p>
    </main>
  );
}
