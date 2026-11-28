// Weekly review prompt (Doc 02 §4). Pure builder. The AI proposes changes; it
// never applies them — approval is a separate, user-driven step.

export const REVIEW_SYSTEM_PROMPT = `You are Xclr reviewing a user's training week and proposing program adjustments. You PROPOSE only — nothing you output is applied automatically; the user approves each item.

RULES (Doc 02 §4):
- Progress an exercise ONLY if its top set hit the TOP of the rep range at or below the target RPE — ideally on two sets. Increment small: machine/total_kg +2.5kg; per_side_kg +2.5/side; assist_kg −2.5kg (LESS assist = progress).
- HOLD (propose no change, or say why) if top-set reps were below the range top, or RPE was at the ceiling.
- DELOAD or HOLD kindly if the notes flag illness, pain, or a rough week — and say so gently.
- Skipped days are not failures. Never progress an exercise that was only on skipped days (no new data). Use the skip reasons: illness/pain → hold or ease off; busy/schedule → hold, maybe suggest a lighter plan; no reason → hold. Mention skips once, kindly, in a rationale where it matters.
- Day edits, home days and extra activities are the user's own choices, not failures. An exercise swapped out or done as a home version this week has no new gym data — hold it. Home-version sets show the effort but never justify a gym load increase. Weigh hard extra activities (e.g. 60 min badminton) as added fatigue.
- Respect any standing constraint in a coach_note (e.g. "increase only if the back feels good", "protect the wrist").
- Every proposed item needs a short rationale in a warm coach voice (e.g. "You hit 4×10 at RPE 7 twice — room to load.").
- You may propose changes to these fields only: suggested_load_value, prescribed_sets, rep_scheme, coach_note. Reference each exercise by its [ref] number. Only include items you actually want to change — an empty items list is a valid "hold everything" week.
- old_value = the current value; new_value = your proposal (as text). summary = 1–2 sentences on the week.`;

export type ReviewExercise = {
  ref: number;
  name: string;
  prescribed_sets: number | null;
  rep_scheme: string | null;
  rep_high: number | null;
  target_rpe_high: number | null;
  suggested_load_value: number | null;
  suggested_load_type: string | null;
  coach_note: string | null;
  actuals: { load_value: number | null; reps: number | null; rpe: number | null }[];
};

export type ReviewContext = {
  exercises: ReviewExercise[];
  notes: string[]; // this week's session my_notes (illness/pain signals)
  skipped?: { day: string; note: string | null }[]; // days skipped this week + why
  edited?: { day: string; changes: string[] }[]; // "This week only" Edit day changes
  home_days?: number; // days the user switched "At home today" on
  other_logged?: { name: string; actuals: { load_value: number | null; load_type: string | null; reps: number | null; rpe: number | null }[] }[]; // sets on exercises outside the plan (home swaps, this-week swaps)
  activities?: { name: string; minutes: number | null; effort: string | null; kcal: number | null }[]; // extra activities
  avg_sleep_min: number | null;
  weight_trend: string; // short human string
  // Daily averages from Apple Health / Health Connect, when synced.
  activity?: { days: number; avg_steps: number | null; avg_active_kcal: number | null; avg_sleep_min: number | null } | null;
};

// User-written text (notes, skip reasons) stays on one line, unquoted-safe.
const oneLine = (t: string) => t.replace(/[\r\n\t]+/g, " ").replace(/"/g, "'").trim();

export function buildReviewUserMessage(ctx: ReviewContext): string {
  const lines: string[] = ["This week's training review.", ""];
  for (const e of ctx.exercises) {
    const prescribed = `${e.prescribed_sets ?? "?"}×${e.rep_scheme ?? "?"} @ ${
      e.suggested_load_value ?? "?"
    } ${e.suggested_load_type ?? ""} (target RPE ≤ ${e.target_rpe_high ?? "?"})`;
    const actuals = e.actuals.length
      ? e.actuals
          .map(
            (a) =>
              `${a.reps ?? "?"} reps @ ${a.load_value ?? "?"}${
                a.rpe != null ? ` RPE ${a.rpe}` : ""
              }`
          )
          .join("; ")
      : "no sets logged this week";
    lines.push(
      `[${e.ref}] ${e.name} — prescribed ${prescribed}${
        e.coach_note ? ` · note: "${e.coach_note}"` : ""
      }`,
      `    logged: ${actuals}`
    );
  }
  lines.push(
    "",
    `Session notes this week: ${ctx.notes.length ? ctx.notes.map(oneLine).join(" | ") : "none"}`,
    `Skipped days this week: ${
      ctx.skipped && ctx.skipped.length
        ? ctx.skipped.map((k) => `${k.day}${k.note ? ` — "${oneLine(k.note)}"` : " — no reason given"}`).join(" | ")
        : "none"
    }`,
    `Days the user edited this week (their own choice, this week only): ${
      ctx.edited && ctx.edited.length
        ? ctx.edited.map((e) => `${e.day}: ${e.changes.map(oneLine).join("; ")}`).join(" | ")
        : "none"
    }`,
    `Days trained at home this week (home versions of the exercises): ${ctx.home_days ?? 0}`,
    `Sets logged on exercises outside the plan (home or swapped versions): ${
      ctx.other_logged && ctx.other_logged.length
        ? ctx.other_logged
            .map(
              (o) =>
                `${oneLine(o.name)} — ${o.actuals
                  .map((a) => `${a.reps ?? "?"} reps @ ${a.load_value ?? "?"}${a.load_type ? ` ${a.load_type}` : ""}${a.rpe != null ? ` RPE ${a.rpe}` : ""}`)
                  .join("; ")}`
            )
            .join(" | ")
        : "none"
    }`,
    `Extra activities this week: ${
      ctx.activities && ctx.activities.length
        ? ctx.activities
            .map((a) => `${oneLine(a.name)} ${a.minutes ?? "?"} min${a.effort ? `, ${a.effort}` : ""}${a.kcal != null ? `, ${a.kcal} kcal (user-entered)` : ""}`)
            .join(" | ")
        : "none"
    }`,
    `Average sleep: ${ctx.avg_sleep_min != null ? `${Math.round(ctx.avg_sleep_min / 60)}h` : "unknown"}`,
    `Weight trend: ${ctx.weight_trend}`,
    ...(ctx.activity
      ? [
          `Watch / phone daily averages (${ctx.activity.days} day${ctx.activity.days === 1 ? "" : "s"} synced): ${[
            ctx.activity.avg_steps != null ? `${ctx.activity.avg_steps} steps` : null,
            ctx.activity.avg_active_kcal != null ? `${ctx.activity.avg_active_kcal} kcal active burn` : null,
            ctx.activity.avg_sleep_min != null
              ? `${Math.floor(ctx.activity.avg_sleep_min / 60)}h ${ctx.activity.avg_sleep_min % 60}m sleep`
              : null,
          ]
            .filter(Boolean)
            .join(", ")}`,
        ]
      : []),
    "",
    "Propose adjustments per the rules. Reference exercises by [ref]. Hold anything that isn't clearly ready to progress."
  );
  return lines.join("\n");
}
