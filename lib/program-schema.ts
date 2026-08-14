// The program-generation contract (Doc 02 §3c). This module holds:
//  - the TypeScript shape the app works with,
//  - the JSON Schema handed to Claude as a forced-tool input_schema (see lib/ai-json.ts),
//  - a defensive validator/normalizer used on BOTH the AI output and the
//    client-approved payload before anything is written (never trust either).

export const LOAD_TYPES = [
  "total_kg",
  "per_side_kg",
  "assist_kg",
  "bodyweight",
  "time_min",
  "none",
] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const DAY_TYPES = ["strength", "cardio", "recovery", "rest"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export type GeneratedExercise = {
  exercise: string;
  category: string | null;
  position: number | null;
  prescribed_sets: number | null;
  rep_scheme: string | null;
  rep_low: number | null;
  rep_high: number | null;
  suggested_load_value: number | null;
  suggested_load_type: LoadType | null;
  target_rpe_low: number | null;
  target_rpe_high: number | null;
  coach_note: string | null;
};

export type GeneratedDay = {
  day_index: number;
  label: string;
  type: DayType;
  exercises: GeneratedExercise[];
};

export type GeneratedProgram = {
  program: { name: string; goal: string; days_per_week: number };
  days: GeneratedDay[];
  summary_for_user: string;
  flags: string[];
};

// JSON Schema passed as the forced-tool input_schema (lib/ai-json.ts). Every
// field is required and nullable-where-optional so the model returns the full
// shape. Range/format checks live in validateProgram below (the schema is a
// shape hint, not a compiled constraint — that's exactly why nullable enums
// like suggested_load_type are safe here but 400 under output_config.format).
export const PROGRAM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    program: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        goal: { type: "string" },
        days_per_week: { type: "integer" },
      },
      required: ["name", "goal", "days_per_week"],
    },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day_index: { type: "integer" },
          label: { type: "string" },
          type: { type: "string", enum: [...DAY_TYPES] },
          exercises: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                exercise: { type: "string" },
                category: { type: ["string", "null"] },
                position: { type: ["integer", "null"] },
                prescribed_sets: { type: ["integer", "null"] },
                rep_scheme: { type: ["string", "null"] },
                rep_low: { type: ["integer", "null"] },
                rep_high: { type: ["integer", "null"] },
                suggested_load_value: { type: ["number", "null"] },
                suggested_load_type: {
                  type: ["string", "null"],
                  enum: [...LOAD_TYPES, null],
                },
                target_rpe_low: { type: ["number", "null"] },
                target_rpe_high: { type: ["number", "null"] },
                coach_note: { type: ["string", "null"] },
              },
              required: [
                "exercise",
                "category",
                "position",
                "prescribed_sets",
                "rep_scheme",
                "rep_low",
                "rep_high",
                "suggested_load_value",
                "suggested_load_type",
                "target_rpe_low",
                "target_rpe_high",
                "coach_note",
              ],
            },
          },
        },
        required: ["day_index", "label", "type", "exercises"],
      },
    },
    summary_for_user: { type: "string" },
    flags: { type: "array", items: { type: "string" } },
  },
  required: ["program", "days", "summary_for_user", "flags"],
} as const;

// Display a load value + type distinctly (Design Brief §4). Never flatten types.
export function formatLoad(value: number | null, type: LoadType | null): string {
  if (type === "bodyweight") return "Bodyweight";
  if (value == null || type == null || type === "none") return "";
  if (type === "total_kg") return `${value} kg`;
  if (type === "per_side_kg") return `${value} kg/side`;
  if (type === "assist_kg") return `${value} kg assist`;
  if (type === "time_min") return `${value} min`;
  return "";
}

// ---- validation / normalization ----

type ValidationResult =
  | { ok: true; program: GeneratedProgram }
  | { ok: false; error: string };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function validateProgram(input: unknown): ValidationResult {
  if (!input || typeof input !== "object")
    return { ok: false, error: "Program was empty." };
  const root = input as Record<string, unknown>;

  const p = root.program as Record<string, unknown> | undefined;
  const name = str(p?.name);
  const goal = str(p?.goal);
  const daysPerWeek = int(p?.days_per_week);
  if (!name || !goal || daysPerWeek === null || daysPerWeek < 1 || daysPerWeek > 7)
    return { ok: false, error: "Program header was invalid." };

  if (!Array.isArray(root.days) || root.days.length === 0)
    return { ok: false, error: "Program had no days." };

  const days: GeneratedDay[] = [];
  for (const rawDay of root.days) {
    const d = rawDay as Record<string, unknown>;
    const dayIndex = int(d.day_index);
    const label = str(d.label);
    const type = DAY_TYPES.includes(d.type as DayType)
      ? (d.type as DayType)
      : null;
    if (dayIndex === null || dayIndex < 1 || dayIndex > 7 || !label || !type)
      return { ok: false, error: "A program day was invalid." };

    const exList = Array.isArray(d.exercises) ? d.exercises : [];
    const exercises: GeneratedExercise[] = exList.map((rawEx, i) => {
      const e = rawEx as Record<string, unknown>;
      const loadType = str(e.suggested_load_type);
      return {
        exercise: str(e.exercise) ?? "Exercise",
        category: str(e.category),
        position: int(e.position) ?? i + 1,
        prescribed_sets: int(e.prescribed_sets),
        rep_scheme: str(e.rep_scheme),
        rep_low: int(e.rep_low),
        rep_high: int(e.rep_high),
        suggested_load_value: num(e.suggested_load_value),
        suggested_load_type:
          loadType && LOAD_TYPES.includes(loadType as LoadType)
            ? (loadType as LoadType)
            : null,
        target_rpe_low: num(e.target_rpe_low),
        target_rpe_high: num(e.target_rpe_high),
        coach_note: str(e.coach_note),
      };
    });

    // Rest days may legitimately have no exercises; others must have some.
    if (type !== "rest" && exercises.length === 0)
      return { ok: false, error: `Day "${label}" had no exercises.` };

    days.push({ day_index: dayIndex, label, type, exercises });
  }

  const summary = str(root.summary_for_user) ?? "";
  const flags = Array.isArray(root.flags)
    ? root.flags.filter((f): f is string => typeof f === "string")
    : [];

  return {
    ok: true,
    program: {
      program: { name, goal, days_per_week: daysPerWeek },
      days,
      summary_for_user: summary,
      flags,
    },
  };
}
