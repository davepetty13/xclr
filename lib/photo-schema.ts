// The photo-read contract. A photo (food plate, health paper, scale or watch
// screen) goes to Claude vision with one of the schemas below as a forced tool.
// This module is client-safe (no server imports): the client uses the types,
// MEALS and the labels; the server uses the schemas, prompts and normalizers.
//
// Anti-fabrication: if the image isn't what the tab says, or can't be read,
// the model sets needs_clarification and NOTHING is saved.

import { MEALS } from "@/lib/parse-schema";

export { MEALS };
export type Meal = (typeof MEALS)[number];

export const PHOTO_KINDS = ["food", "health", "scale"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function isPhotoKind(v: unknown): v is PhotoKind {
  return typeof v === "string" && (PHOTO_KINDS as readonly string[]).includes(v);
}

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  food: "Food",
  health: "Health paper",
  scale: "Scale or watch",
};

export type PhotoFood = {
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

export type HealthReading = {
  name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
};

export type FoodRead = { kind: "food"; foods: PhotoFood[]; meal: Meal | null };
export type ScaleRead = {
  kind: "scale";
  weight_kg: number | null;
  body_fat_pct: number | null;
  steps: number | null;
  active_kcal: number | null;
  date_shown: string | null;
};
export type HealthRead = {
  kind: "health";
  readings: HealthReading[];
  document_type: string;
  summary: string;
};
export type PhotoRead = FoodRead | ScaleRead | HealthRead;

// ---------------------------------------------------------------------------
// Forced-tool input schemas (shape hints; output is normalized below).
// ---------------------------------------------------------------------------

const CLARIFY = { type: ["string", "null"] } as const;

const FOOD_SCHEMA = {
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
          kcal: { type: ["number", "null"] },
          protein_g: { type: ["number", "null"] },
          carbs_g: { type: ["number", "null"] },
          fat_g: { type: ["number", "null"] },
        },
        required: ["name", "serving", "kcal", "protein_g", "carbs_g", "fat_g"],
      },
    },
    meal: { type: ["string", "null"], enum: [...MEALS, null] },
    needs_clarification: CLARIFY,
  },
  required: ["foods", "meal", "needs_clarification"],
} as const;

const SCALE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    weight_value: { type: ["number", "null"] },
    weight_unit: { type: ["string", "null"], enum: ["kg", "lb", null] },
    body_fat_pct: { type: ["number", "null"] },
    steps: { type: ["integer", "null"] },
    active_kcal: { type: ["number", "null"] },
    date_shown: { type: ["string", "null"], description: "YYYY-MM-DD if a date is visible" },
    needs_clarification: CLARIFY,
  },
  required: [
    "weight_value",
    "weight_unit",
    "body_fat_pct",
    "steps",
    "active_kcal",
    "date_shown",
    "needs_clarification",
  ],
} as const;

const HEALTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          unit: { type: ["string", "null"] },
          reference_range: { type: ["string", "null"] },
        },
        required: ["name", "value", "unit", "reference_range"],
      },
    },
    document_type: { type: "string" },
    summary: { type: "string" },
    needs_clarification: CLARIFY,
  },
  required: ["readings", "document_type", "summary", "needs_clarification"],
} as const;

export const PHOTO_SCHEMA: Record<PhotoKind, object> = {
  food: FOOD_SCHEMA,
  scale: SCALE_SCHEMA,
  health: HEALTH_SCHEMA,
};

export const PHOTO_TOOL: Record<PhotoKind, string> = {
  food: "read_food_photo",
  scale: "read_scale_photo",
  health: "read_health_paper",
};

// ---------------------------------------------------------------------------
// System prompts (stable text → cacheable).
// ---------------------------------------------------------------------------

const COMMON = `You read one photo for Xclr, a personal health app used in the Philippines. Metric units only (kg, kcal, g).
Never invent anything you cannot see. If the photo is not what was asked for, is blurry, cropped, or too dark to read, return empty/null values and set needs_clarification to one short, friendly sentence saying what you need (e.g. "I can't make out the numbers — try a closer, brighter photo."). Otherwise needs_clarification is null.`;

export const PHOTO_SYSTEM: Record<PhotoKind, string> = {
  food: `${COMMON}

Task: a photo of food or a meal. List each distinct dish or item you can see.
- Filipino dishes are first-class: name them as a Filipino would (sinigang na baboy, adobong manok, pancit canton, tapsilog, lumpiang shanghai, rice, etc.). Rice is its own item.
- serving: a plain household amount you can see ("1 cup", "1 bowl", "2 pieces", "1 plate").
- kcal and macros (protein_g, carbs_g, fat_g) are ESTIMATES for that serving, using typical Filipino home/carinderia recipes. Round kcal to whole numbers and grams to 1 decimal.
- If the user's personal food library (given in the message) has a matching dish, use its numbers, scaled to the serving you see.
- meal: your best guess from the food and the local time given, or null.
- If there is no food in the photo, set needs_clarification.`,

  scale: `${COMMON}

Task: a photo or screenshot of a bathroom scale, smart-scale app, or fitness watch/phone screen.
- Copy only numbers that are clearly shown. Do not calculate or guess anything.
- weight_value + weight_unit exactly as displayed (kg or lb). Null if no weight is shown.
- body_fat_pct, steps, active_kcal (active/move calories, not total) if shown, else null.
- date_shown as YYYY-MM-DD only if a date is visible, else null.
- If no number of these kinds is readable, set needs_clarification.`,

  health: `${COMMON}

Task: a photo of a health paper (lab result, check-up form, prescription, blood-pressure log).
- TRANSCRIBE values only: test or item name, value exactly as printed, unit, and the printed reference range if any.
- NEVER diagnose, interpret, or name a condition. Do not say a value is high, low, normal, or abnormal. Do not give advice.
- document_type: what the paper is, in a few plain words (e.g. "Lipid panel", "Complete blood count", "Prescription").
- summary: one plain line describing what was transcribed (e.g. "6 values from a lipid panel dated 2026-11-20."). No interpretation.
- Leave out names, addresses, ID numbers, and doctor details — values only.
- If you cannot read the paper, set needs_clarification.`,
};

// ---------------------------------------------------------------------------
// Normalizers — never trust the model's (or the client's) output as-is.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function cleanStr(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
}

export function cleanNum(v: unknown, min: number, max: number, decimals = 1): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function cleanFood(v: unknown): PhotoFood | null {
  if (!isObj(v)) return null;
  const name = cleanStr(v.name, 80);
  if (!name) return null;
  return {
    name,
    serving: cleanStr(v.serving, 40),
    kcal: cleanNum(v.kcal, 0, 5000, 0),
    protein_g: cleanNum(v.protein_g, 0, 500),
    carbs_g: cleanNum(v.carbs_g, 0, 1000),
    fat_g: cleanNum(v.fat_g, 0, 500),
  };
}

export function cleanReading(v: unknown): HealthReading | null {
  if (!isObj(v)) return null;
  const name = cleanStr(v.name, 80);
  const value = cleanStr(typeof v.value === "number" ? String(v.value) : v.value, 40);
  if (!name || !value) return null;
  return {
    name,
    value,
    unit: cleanStr(v.unit, 30),
    reference_range: cleanStr(v.reference_range, 60),
  };
}

export function isMeal(v: unknown): v is Meal {
  return typeof v === "string" && (MEALS as readonly string[]).includes(v);
}

export type NormalizedRead = { ok: true; read: PhotoRead } | { ok: false; clarification: string };

const UNREADABLE = "I couldn't read that photo. Try a closer, brighter shot.";

export function normalizePhotoRead(kind: PhotoKind, raw: unknown): NormalizedRead {
  if (!isObj(raw)) return { ok: false, clarification: UNREADABLE };
  const clarify = cleanStr(raw.needs_clarification, 240);
  if (clarify) return { ok: false, clarification: clarify };

  if (kind === "food") {
    const foods = (Array.isArray(raw.foods) ? raw.foods : [])
      .map(cleanFood)
      .filter((f): f is PhotoFood => f !== null)
      .slice(0, 12);
    if (!foods.length) return { ok: false, clarification: "I couldn't spot any food in that photo." };
    return { ok: true, read: { kind, foods, meal: isMeal(raw.meal) ? raw.meal : null } };
  }

  if (kind === "scale") {
    const value = cleanNum(raw.weight_value, 0, 800, 2);
    const kg =
      value == null ? null : raw.weight_unit === "lb" ? value * 0.45359237 : value;
    const read: ScaleRead = {
      kind,
      weight_kg: cleanNum(kg, 20, 400, 2),
      body_fat_pct: cleanNum(raw.body_fat_pct, 2, 75, 1),
      steps: cleanNum(raw.steps, 0, 200_000, 0),
      active_kcal: cleanNum(raw.active_kcal, 0, 10_000, 0),
      date_shown:
        typeof raw.date_shown === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date_shown)
          ? raw.date_shown
          : null,
    };
    if (read.weight_kg == null && read.body_fat_pct == null && read.steps == null && read.active_kcal == null)
      return { ok: false, clarification: "I couldn't find a weight or activity number on that screen." };
    return { ok: true, read };
  }

  const readings = (Array.isArray(raw.readings) ? raw.readings : [])
    .map(cleanReading)
    .filter((r): r is HealthReading => r !== null)
    .slice(0, 40);
  if (!readings.length) return { ok: false, clarification: "I couldn't read any values on that paper." };
  return {
    ok: true,
    read: {
      kind: "health",
      readings,
      document_type: cleanStr(raw.document_type, 60) ?? "Health paper",
      // Built in code, never the model's words, so nothing reads as a diagnosis.
      summary: `${readings.length} value${readings.length === 1 ? "" : "s"} read from ${
        cleanStr(raw.document_type, 60) ?? "your health paper"
      }.`,
    },
  };
}
