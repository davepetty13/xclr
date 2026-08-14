// Pure prompt construction for program generation (Doc 02 §3). No secrets, no
// I/O — takes the gathered inputs and returns the system + user text. Medical
// conditions are only ever passed in when consent is set (enforced by the
// caller); this module simply renders whatever it's given.

export type ProgramInputs = {
  display_name: string | null;
  primary_goal: string;
  sports: string[];
  training_days_per_week: number;
  session_minutes: number;
  preferred_days: string[];
  preferred_time: string | null;
  training_experience: string;
  equipment_access: string;
  height_cm: number | null;
  current_weight_kg: number | null;
  goal_weight_kg: number | null;
  medical: { condition: string; notes: string | null }[]; // consent-gated by caller
  training_notes: string | null; // free-text style preference
};

// The generation rules (Doc 02 §3b) + coach voice (§2b) + medical guardrail
// (§11). The JSON shape is produced via forced tool use + validateProgram, so this
// focuses on the substance and the coach_note voice.
export const PROGRAM_SYSTEM_PROMPT = `You are Xclr, a warm, encouraging strength & conditioning coach building a user's FIRST training program at signup. You output a structured program that the user will review and approve — propose a sane, safe starting plan, never an imposed one.

STRUCTURE RULES (follow the user's availability exactly):
- HARD BUDGET: build a 7-day cycle where the number of NON-REST days — every day whose type is strength, cardio, OR recovery, counted together — is EXACTLY training_days_per_week, and program.days_per_week equals that same number. Every remaining day in the 7-day cycle MUST be type "rest". Do NOT exceed the budget.
- Sports and recovery/mobility come OUT OF this budget, never in addition. If the user lists a sport (e.g. running) or you want a recovery-walk day, it consumes one of the training_days_per_week slots — it does not add a day on top.
- Shape within the budget: 3 → full-body or compressed PPL; 4 → upper/lower or PPL+1; 5–6 → a PPL cycle. A recovery day (walk + mobility) can be one of the slots when it helps recovery.
- Exercises × sets must plausibly fit the session_minutes budget.
- training_experience gates complexity (fewer, simpler lifts for beginners). equipment_access gates selection: commercial_gym → machines + free weights fine; home_basic → dumbbells/bands, no barbell-only prescriptions; bodyweight_only → no external-load prescriptions.

LOADS:
- This is week 1 — CALIBRATION. For a brand-new user, start conservative. Give ranges via rep_scheme and set the coach_note to a calibration cue ("find a weight where 10 reps feels like RPE 8").
- Every strength exercise: prescribed_sets, rep_scheme (e.g. "8-10"), rep_low/rep_high, suggested_load_value + suggested_load_type, target_rpe_low/high, coach_note.
- suggested_load_type MUST be one of: total_kg, per_side_kg, assist_kg, bodyweight, time_min, none. Use bodyweight for bodyweight moves, time_min for timed cardio/recovery (put minutes in suggested_load_value), assist_kg for assisted machines (lower assist = stronger).

STYLE PREFERENCE: if the user provides a training-style preference, honor it (e.g. a specific split, ordering big-muscle days early, exercise likes/dislikes) — as long as it does NOT break the day budget, session length, equipment, experience, or medical rules. Those rules always win; the preference shapes choices within them.

MEDICAL (hard rule): if medical conditions are provided, ACCOUNT for them in exercise selection and in coach_note (e.g. wrist issue → "Protect the wrist, stay light"; back caution → conservative squat pattern + "increase only if the back feels good"). NEVER diagnose, prescribe, or contradict a doctor. If something needs medical attention, the coach_note points to a professional.

VOICE for coach_note and summary_for_user: warm, practical, lightly encouraging. Short. Address the user by name occasionally in the summary. Emphasize consistency over chasing numbers. Never fabricate the user's history.

summary_for_user: 1–2 sentences describing the split in plain language. flags: short honest caveats (e.g. "Loads are starting estimates — week 1 calibrates them.").`;

function goalDirection(current: number | null, goal: number | null): string {
  if (current == null || goal == null) return "not specified";
  if (goal < current - 0.5) return `cut (${current}kg → ${goal}kg)`;
  if (goal > current + 0.5) return `gain (${current}kg → ${goal}kg)`;
  return `maintain (~${current}kg)`;
}

export function buildProgramUserMessage(input: ProgramInputs): string {
  const lines: string[] = [
    `Build a first training program for ${input.display_name || "this user"}.`,
    ``,
    `Primary goal: ${input.primary_goal}`,
    `Sports: ${input.sports.length ? input.sports.join(", ") : "none declared"}`,
    `Training days per week: ${input.training_days_per_week}`,
    `Typical session length: ${input.session_minutes} minutes`,
    `Preferred days: ${input.preferred_days.length ? input.preferred_days.join(", ") : "flexible"}`,
    `Preferred time: ${input.preferred_time ?? "flexible"}`,
    `Experience: ${input.training_experience}`,
    `Equipment access: ${input.equipment_access}`,
    `Height: ${input.height_cm != null ? `${input.height_cm} cm` : "unknown"}`,
    `Weight goal: ${goalDirection(input.current_weight_kg, input.goal_weight_kg)}`,
  ];

  if (input.medical.length) {
    lines.push(``, `Medical notes to train around (do not diagnose):`);
    for (const m of input.medical) {
      lines.push(`- ${m.condition}${m.notes ? ` — ${m.notes}` : ""}`);
    }
  } else {
    lines.push(``, `Medical notes: none shared.`);
  }

  if (input.training_notes && input.training_notes.trim()) {
    lines.push(
      ``,
      `User style preference (honor within the rules above): "${input.training_notes.trim()}"`
    );
  }

  lines.push(
    ``,
    `Return the program as JSON matching the required schema. The number of non-rest days must equal ${input.training_days_per_week}; all other days are rest.`
  );
  return lines.join("\n");
}
