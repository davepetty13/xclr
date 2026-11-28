// "Edit day": the shape of one day's exercise list, shared by the Train page,
// the Edit day sheet, the save action and the weekly review. Pure module.
//
// A "This week only" edit stores the FULL replacement list in day_edits.edits
// (jsonb). "From now on" writes the same list into program_exercises.

import { LOAD_TYPES, formatLoad, type LoadType } from "@/lib/program-schema";
import { asCategory, guessCategory, type Category } from "@/lib/home-swaps";

export const MAX_DAY_ITEMS = 20;

// "+ Add activity" can log today or up to this many days back.
export const ACTIVITY_DAYS_BACK = 14;

// The activity dropdown ("Other" = type your own name).
export const ACTIVITY_TYPES = [
  "Badminton",
  "Basketball",
  "Run",
  "Walk",
  "Cycling",
  "Swim",
  "Yoga",
  "Home workout",
] as const;

// Load-type dropdown in Edit day / the swap picker (plain words).
export const LOAD_TYPE_OPTIONS: { value: LoadType; label: string }[] = [
  { value: "total_kg", label: "kg (total)" },
  { value: "per_side_kg", label: "kg per side / per hand" },
  { value: "assist_kg", label: "kg of assist" },
  { value: "bodyweight", label: "Bodyweight (+ kg added)" },
  { value: "time_min", label: "Minutes" },
  { value: "none", label: "No number (band, etc.)" },
];

export const EFFORTS = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
] as const;

export type DayItem = {
  key: string; // stable row key: the program_exercise id, or a new id for added rows
  source_id: string | null; // the program_exercise this row keeps / replaces
  exercise_id: string;
  name: string;
  category: Category | null;
  activity: boolean; // an extra activity (Badminton 60 min), logged like cardio
  prescribed_sets: number | null;
  rep_scheme: string | null;
  suggested_load_value: number | null;
  suggested_load_type: LoadType | null;
  target_rpe_low: number | null;
  target_rpe_high: number | null;
  coach_note: string | null;
  swapped_from: string | null; // the plan's exercise this row replaced this week
};

// What the browser sends to the save action (exercise ids are resolved by name
// on the server, never trusted from here).
export type DayItemInput = Omit<DayItem, "exercise_id" | "category"> & {
  category: string | null;
};

// ── small sanitizers ────────────────────────────────────────────────────────

export function cleanName(v: unknown, max = 80): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f"]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
}

function cleanText(v: unknown, max: number): string | null {
  return cleanName(v, max);
}

function num(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// "8-10" / "8–10" → 8,10 · "12" → 12,12 · anything else → nulls.
export function parseRepRange(scheme: string | null): { low: number | null; high: number | null } {
  if (!scheme) return { low: null, high: null };
  const m = scheme.trim().match(/^(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }
  const one = scheme.trim().match(/^(\d{1,3})$/);
  if (one) return { low: Number(one[1]), high: Number(one[1]) };
  return { low: null, high: null };
}

// Validate + clamp one row. `exerciseId` comes from the server's own lookup
// (or the stored jsonb when reading back). Returns null for a row to drop.
export function cleanItem(raw: unknown, exerciseId?: string): DayItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = cleanName(r.name);
  const id = exerciseId ?? (typeof r.exercise_id === "string" ? r.exercise_id : "");
  if (!name || !id) return null;
  const key = typeof r.key === "string" && KEY_RE.test(r.key) ? r.key : null;
  if (!key) return null;
  const loadType =
    typeof r.suggested_load_type === "string" && (LOAD_TYPES as readonly string[]).includes(r.suggested_load_type)
      ? (r.suggested_load_type as LoadType)
      : null;
  const activity = r.activity === true;
  const sets = num(r.prescribed_sets, 1, 10);
  const rpeLo = num(r.target_rpe_low, 1, 10);
  const rpeHi = num(r.target_rpe_high, 1, 10);
  return {
    key,
    source_id: typeof r.source_id === "string" && KEY_RE.test(r.source_id) ? r.source_id : null,
    exercise_id: id,
    name,
    category: asCategory(r.category) ?? (activity ? "cardio" : guessCategory(name)),
    activity,
    prescribed_sets: activity ? 1 : sets == null ? null : Math.round(sets),
    rep_scheme: cleanText(r.rep_scheme, 20),
    suggested_load_value: (() => {
      const v = num(r.suggested_load_value, 0, activity || loadType === "time_min" ? 600 : 1000);
      return v == null ? null : Math.round(v * 100) / 100;
    })(),
    suggested_load_type: activity ? "time_min" : loadType,
    target_rpe_low: rpeLo,
    target_rpe_high: rpeHi,
    coach_note: cleanText(r.coach_note, 300),
    swapped_from: cleanName(r.swapped_from),
  };
}

// Read day_edits.edits back. Bad rows drop; at most MAX_DAY_ITEMS.
export function parseDayEdits(raw: unknown): DayItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DayItem[] = [];
  const keys = new Set<string>();
  for (const r of raw.slice(0, MAX_DAY_ITEMS)) {
    const it = cleanItem(r);
    if (it && !keys.has(it.key)) {
      keys.add(it.key);
      out.push(it);
    }
  }
  return out;
}

// ── For the weekly review ──────────────────────────────────────────────────

const shortRx = (it: { prescribed_sets: number | null; rep_scheme: string | null; suggested_load_value: number | null; suggested_load_type: LoadType | null }) =>
  [
    it.prescribed_sets && it.rep_scheme ? `${it.prescribed_sets}×${it.rep_scheme}` : it.rep_scheme,
    formatLoad(it.suggested_load_value, it.suggested_load_type),
  ]
    .filter(Boolean)
    .join(" @ ");

// "swapped Bench press for Dumbbell floor press; removed Cable fly; added
// Badminton (60 min)". `plan` = the day's program_exercises with names.
export function describeDayEdit(
  items: DayItem[],
  plan: { id: string; exercise_id: string; name: string; prescribed_sets: number | null; rep_scheme: string | null; suggested_load_value: number | null; suggested_load_type: LoadType | null }[]
): string[] {
  const parts: string[] = [];
  const kept = new Set(items.map((i) => i.source_id).filter((x): x is string => !!x));
  const planById = new Map(plan.map((p) => [p.id, p]));
  for (const it of items) {
    const src = it.source_id ? planById.get(it.source_id) : undefined;
    if (it.activity && !src) {
      parts.push(`added ${it.name}${it.suggested_load_value ? ` (${it.suggested_load_value} min)` : ""}`);
      continue;
    }
    if (src && src.exercise_id !== it.exercise_id) {
      parts.push(`swapped ${src.name} for ${it.name}${shortRx(it) ? ` (${shortRx(it)})` : ""}`);
      continue;
    }
    if (!src) {
      parts.push(`${it.swapped_from ? `swapped ${it.swapped_from} for` : "added"} ${it.name}${shortRx(it) ? ` (${shortRx(it)})` : ""}`);
      continue;
    }
    const before = shortRx(src);
    const after = shortRx(it);
    if (before !== after) parts.push(`changed ${it.name} from ${before || "—"} to ${after || "—"}`);
  }
  for (const p of plan) if (!kept.has(p.id)) parts.push(`removed ${p.name}`);
  return parts;
}
