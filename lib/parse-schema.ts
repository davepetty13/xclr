// The AI-parse contract (Master Spec §10): chat text → strict JSON → rows.
// The AI never free-writes to the DB — it returns this shape and the app maps
// it. Anti-fabrication is enforced in the action: vague input →
// needs_clarification set, everything else null, and NOTHING is written.

import { LOAD_TYPES, type LoadType } from "@/lib/program-schema";
import { GOALS, isGoal, type Goal } from "@/lib/goal-change";

export const MEALS = ["breakfast", "brunch", "lunch", "dinner", "snack"] as const;

export type ParsedFood = {
  name: string;
  serving: string | null;
  meal: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_estimate: boolean;
};

export type ParsedSet = {
  exercise: string;
  load_value: number | null;
  load_type: LoadType | null;
  reps: number | null;
  rpe: number | null;
};

export type ParsedWorkout = { type: string | null; sets: ParsedSet[] };

export type ParsedSleep = { duration_min: number | null; quality: number | null };

export const HEALTH_ACTIONS = ["add", "update", "resolve"] as const;
export type HealthAction = (typeof HEALTH_ACTIONS)[number];

export type ParsedGoalChange = { goal: Goal; goal_weight_kg: number | null };
export type ParsedHealthUpdate = {
  condition: string;
  notes: string | null;
  action: HealthAction;
};

export type ParsedInput = {
  foods: ParsedFood[];
  workout: ParsedWorkout | null;
  sleep: ParsedSleep | null;
  weight_kg: number | null;
  // Which local day the logs belong to: "today" | "yesterday" | "YYYY-MM-DD" | null (= today).
  log_date: string | null;
  // True when the message asks something or wants conversation (the coach answers).
  is_question: boolean;
  goal_change: ParsedGoalChange | null;
  health_update: ParsedHealthUpdate | null;
  needs_clarification: string | null;
};

// Forced-tool input_schema handed to Claude (lib/ai-json.ts). Every field required; nullable
// where optional so the model always returns the full shape.
export const PARSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    foods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          serving: { type: ["string", "null"] },
          meal: { type: ["string", "null"], enum: [...MEALS, null] },
          kcal: { type: ["number", "null"] },
          protein_g: { type: ["number", "null"] },
          carbs_g: { type: ["number", "null"] },
          fat_g: { type: ["number", "null"] },
          is_estimate: { type: "boolean" },
        },
        required: [
          "name",
          "serving",
          "meal",
          "kcal",
          "protein_g",
          "carbs_g",
          "fat_g",
          "is_estimate",
        ],
      },
    },
    workout: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        type: { type: ["string", "null"] },
        sets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              exercise: { type: "string" },
              load_value: { type: ["number", "null"] },
              load_type: { type: ["string", "null"], enum: [...LOAD_TYPES, null] },
              reps: { type: ["integer", "null"] },
              rpe: { type: ["number", "null"] },
            },
            required: ["exercise", "load_value", "load_type", "reps", "rpe"],
          },
        },
      },
      required: ["type", "sets"],
    },
    sleep: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        duration_min: { type: ["integer", "null"] },
        quality: { type: ["integer", "null"] },
      },
      required: ["duration_min", "quality"],
    },
    weight_kg: { type: ["number", "null"] },
    log_date: { type: ["string", "null"] },
    is_question: { type: "boolean" },
    goal_change: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        goal: { type: "string", enum: [...GOALS] },
        goal_weight_kg: { type: ["number", "null"] },
      },
      required: ["goal", "goal_weight_kg"],
    },
    health_update: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        condition: { type: "string" },
        notes: { type: ["string", "null"] },
        action: { type: "string", enum: [...HEALTH_ACTIONS] },
      },
      required: ["condition", "notes", "action"],
    },
    needs_clarification: { type: ["string", "null"] },
  },
  required: [
    "foods",
    "workout",
    "sleep",
    "weight_kg",
    "log_date",
    "is_question",
    "goal_change",
    "health_update",
    "needs_clarification",
  ],
} as const;

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

// Defensive normalizer over the AI output. Returns a clean ParsedInput; the
// action decides (from needs_clarification) whether to write anything.
export function normalizeParse(input: unknown): ParsedInput {
  const root = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;

  const foods: ParsedFood[] = Array.isArray(root.foods)
    ? root.foods
        .map((rawF) => {
          const f = rawF as Record<string, unknown>;
          const name = str(f.name);
          if (!name) return null;
          const meal = str(f.meal);
          return {
            name,
            serving: str(f.serving),
            meal: meal && MEALS.includes(meal as (typeof MEALS)[number]) ? meal : null,
            kcal: num(f.kcal),
            protein_g: num(f.protein_g),
            carbs_g: num(f.carbs_g),
            fat_g: num(f.fat_g),
            is_estimate: f.is_estimate !== false,
          } satisfies ParsedFood;
        })
        .filter((f): f is ParsedFood => f !== null)
    : [];

  let workout: ParsedWorkout | null = null;
  if (root.workout && typeof root.workout === "object") {
    const w = root.workout as Record<string, unknown>;
    const sets: ParsedSet[] = Array.isArray(w.sets)
      ? w.sets
          .map((rawS) => {
            const s = rawS as Record<string, unknown>;
            const exercise = str(s.exercise);
            if (!exercise) return null;
            const loadType = str(s.load_type);
            return {
              exercise,
              load_value: num(s.load_value),
              load_type:
                loadType && LOAD_TYPES.includes(loadType as LoadType)
                  ? (loadType as LoadType)
                  : null,
              reps: int(s.reps),
              rpe: num(s.rpe),
            } satisfies ParsedSet;
          })
          .filter((s): s is ParsedSet => s !== null)
      : [];
    if (sets.length) workout = { type: str(w.type), sets };
  }

  let sleep: ParsedSleep | null = null;
  if (root.sleep && typeof root.sleep === "object") {
    const s = root.sleep as Record<string, unknown>;
    const duration = int(s.duration_min);
    const quality = int(s.quality);
    if (duration !== null || quality !== null)
      sleep = { duration_min: duration, quality };
  }

  let goal_change: ParsedGoalChange | null = null;
  if (root.goal_change && typeof root.goal_change === "object") {
    const g = root.goal_change as Record<string, unknown>;
    if (isGoal(g.goal)) {
      const gw = num(g.goal_weight_kg);
      goal_change = { goal: g.goal, goal_weight_kg: gw != null && gw >= 30 && gw <= 300 ? gw : null };
    }
  }

  let health_update: ParsedHealthUpdate | null = null;
  if (root.health_update && typeof root.health_update === "object") {
    const h = root.health_update as Record<string, unknown>;
    const condition = str(h.condition);
    const action = str(h.action);
    if (condition)
      health_update = {
        condition: condition.slice(0, 200),
        notes: str(h.notes)?.slice(0, 1000) ?? null,
        action: action && HEALTH_ACTIONS.includes(action as HealthAction) ? (action as HealthAction) : "add",
      };
  }

  const logDate = str(root.log_date);
  return {
    foods,
    workout,
    sleep,
    weight_kg: num(root.weight_kg),
    // An unreadable day ("last monday") must NOT fall back to today: keep a
    // marker so the chat asks "Which day was that?" and writes nothing.
    log_date: logDate
      ? /^(today|yesterday)$/i.test(logDate) || /^\d{4}-\d{2}-\d{2}$/.test(logDate)
        ? logDate.toLowerCase()
        : "invalid"
      : null,
    is_question: root.is_question === true,
    goal_change,
    health_update,
    needs_clarification: str(root.needs_clarification),
  };
}
