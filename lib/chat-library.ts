// Chat "brain" helpers that need no AI: the library-first matcher (a message
// made only of dishes the user already saved is logged with ZERO AI calls),
// the card shapes stored in messages.meta, and the reply templates.
// Pure + client-safe (types and string functions only; the one DB helper takes
// the caller's Supabase client).

import type { TargetPreview } from "@/lib/goal-change";
import type { createClient } from "@/lib/supabase/server";

// ---------- Cards (persisted in messages.meta.cards) ----------

export type CardFood = {
  id?: string; // food_logs.id once written
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_estimate: boolean;
  library_id?: string | null;
  user_stated?: boolean; // the user typed these numbers → they beat the library and any estimate
};

// The row's values before a chat correction (restored by Undo).
export type FoodSnapshot = {
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_estimate: boolean;
};

export type ChatCard =
  | {
      key: string;
      kind: "food";
      meal: string | null;
      via: "library" | "parse";
      items: CardFood[];
      kcal_today: number;
      protein_today: number;
      status: "logged" | "undone";
    }
  | {
      key: string;
      kind: "food_fixed";
      item: CardFood & { id: string }; // the corrected food_logs row, new values
      previous: FoodSnapshot;
      kcal_today: number;
      protein_today: number;
      status: "fixed" | "undone";
    }
  | {
      key: string;
      kind: "food_past";
      meal: string | null;
      date: string; // YYYY-MM-DD local
      items: CardFood[];
      status: "pending" | "added" | "dismissed";
      added_date?: string;
    }
  | {
      key: string;
      kind: "weight";
      date: string;
      kg: number;
      delta: number | null; // vs the previous weigh-in before this date
      previous_kg: number | null; // value on this same date before the save (for Undo)
      status: "saved" | "undone";
    }
  | {
      key: string;
      kind: "sleep";
      date: string;
      duration_min: number | null;
      quality: number | null;
      previous: { duration_min: number | null; quality: number | null } | null;
      status: "saved" | "undone";
    }
  | {
      key: string;
      kind: "goal";
      pending_id: string;
      preview: TargetPreview;
      goal_weight_kg: number | null;
      status: "pending" | "approved" | "rejected";
    }
  | {
      key: string;
      kind: "health";
      pending_id: string;
      condition: string;
      notes: string | null;
      action: "add" | "update" | "resolve";
      status: "pending" | "approved" | "rejected";
    }
  | { key: string; kind: "health_consent" };

export type ChatMeta = { cards: ChatCard[] };

// Where a card lives, so an action can update its status in messages.meta and
// a reload shows the same state (Undo gone after undoing, etc.).
export type CardRef = { messageId: string; key: string };

export function readMeta(raw: unknown): ChatMeta {
  if (raw && typeof raw === "object" && Array.isArray((raw as ChatMeta).cards))
    return { cards: (raw as ChatMeta).cards };
  return { cards: [] };
}

type SupaLike = ReturnType<typeof createClient>;

// Patch one card inside a stored coach message. Best-effort: the real write
// already happened; this only keeps the bubble honest after a reload.
export async function patchCard(
  supabase: SupaLike,
  userId: string,
  ref: CardRef | null | undefined,
  patch: Record<string, unknown>
): Promise<void> {
  if (!ref?.messageId || !ref.key) return;
  const { data } = await supabase
    .from("messages")
    .select("meta")
    .eq("id", ref.messageId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return;
  const meta = readMeta(data.meta);
  let hit = false;
  const cards = meta.cards.map((c) => {
    if (c.key !== ref.key) return c;
    hit = true;
    return { ...c, ...patch } as ChatCard;
  });
  if (!hit) return;
  const { error } = await supabase
    .from("messages")
    .update({ meta: { cards } })
    .eq("id", ref.messageId)
    .eq("user_id", userId);
  if (error) console.error(`[chat meta patch] ${error.message}`);
}

// ---------- Library-first matching (no AI) ----------

export type LibraryRow = {
  id: string;
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  times_logged: number | null;
};

const MEAL_WORDS: Record<string, string> = {
  breakfast: "breakfast",
  brunch: "brunch",
  lunch: "lunch",
  dinner: "dinner",
  supper: "dinner",
  snack: "snack",
  merienda: "snack",
};

// Words that point at another day or a question: let the parser handle those.
const NOT_SIMPLE =
  /\?|\b(yesterday|kahapon|last|ago|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weigh|weight|slept|sleep|kg|lbs?|goal|bulk|cut)\b/i;

const UNITS = "cup|cups|serving|servings|pc|pcs|piece|pieces|plate|plates|bowl|bowls|order|orders|glass|glasses|slice|slices";
const LEAD_QTY = new RegExp(`^(?:1|one|a|an)\\s+(?:(${UNITS})\\s+(?:of\\s+)?)?`, "i");
const TRAIL_QTY = new RegExp(`\\s+(?:x\\s*1|1|one|a|an)\\s*(${UNITS})?$`, "i");

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function singularUnit(u: string): string {
  const x = u.toLowerCase();
  if (x === "pcs") return "pc";
  if (x === "glasses") return "glass";
  if (x === "pieces") return "piece";
  return x.endsWith("s") ? x.slice(0, -1) : x;
}

// A stated unit ("1 cup") only counts as "one library serving" when the saved
// serving says the same thing — otherwise the numbers would be wrong.
function unitFits(unit: string | null, serving: string | null): boolean {
  if (!unit) return true;
  if (!serving) return false;
  const s = norm(serving);
  const u = singularUnit(unit);
  return new RegExp(`^(1|one|a)\\s+${u}s?\\b`).test(s) || s === u;
}

export function stripMeal(text: string): { meal: string | null; rest: string } {
  let rest = text.trim();
  let meal: string | null = null;
  for (let i = 0; i < 3; i++) {
    const before = rest;
    rest = rest.replace(/^(?:i\s+)?(?:had|ate|for)\s+/i, "");
    const m = rest.match(/^(breakfast|brunch|lunch|dinner|supper|snack|merienda)\b\s*[:\-–—]?\s*/i);
    if (m && !meal) {
      meal = MEAL_WORDS[m[1].toLowerCase()] ?? null;
      rest = rest.slice(m[0].length);
    }
    if (rest === before) break;
  }
  // "adobo for lunch"
  const tail = rest.match(/\s+for\s+(breakfast|brunch|lunch|dinner|supper|snack|merienda)\s*$/i);
  if (tail && !meal) {
    meal = MEAL_WORDS[tail[1].toLowerCase()] ?? null;
    rest = rest.slice(0, tail.index);
  }
  return { meal, rest: rest.trim() };
}

export function splitSegments(text: string): string[] {
  return text
    .split(/,|\+|\n|&|\band\b|\bwith\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchSegment(seg: string, lib: LibraryRow[]): LibraryRow | null {
  const s = norm(seg.replace(/[.!]+$/, ""));
  if (!s) return null;
  // Exact name, or the chip text "name serving".
  for (const row of lib) {
    const n = norm(row.name);
    if (s === n) return row;
    if (row.serving && s === norm(`${row.name} ${row.serving}`)) return row;
  }
  // "1 cup adobo" / "a chickenjoy" / "adobo 1 cup"
  let unit: string | null = null;
  let core = s;
  const lead = core.match(LEAD_QTY);
  if (lead) {
    unit = lead[1] ?? null;
    core = core.slice(lead[0].length).trim();
  } else {
    const trail = core.match(TRAIL_QTY);
    if (trail) {
      unit = trail[1] ?? null;
      core = core.slice(0, trail.index).trim();
    }
  }
  if (core === s) return null;
  const row = lib.find((r) => norm(r.name) === core);
  if (!row || !unitFits(unit, row.serving)) return null;
  return row;
}

// Every piece must be a saved dish, or we return null and the parser runs.
export function matchLibraryMessage(
  text: string,
  lib: LibraryRow[]
): { meal: string | null; rows: LibraryRow[] } | null {
  if (!lib.length || NOT_SIMPLE.test(text)) return null;
  const { meal, rest } = stripMeal(text);
  if (!rest) return null;
  const whole = matchSegment(rest, lib);
  if (whole) return { meal, rows: [whole] };
  const segs = splitSegments(rest);
  if (!segs.length) return null;
  const rows: LibraryRow[] = [];
  for (const seg of segs) {
    const row = matchSegment(seg, lib);
    if (!row) return null;
    rows.push(row);
  }
  return { meal, rows };
}

// ---------- Reply templates (no AI) ----------

const MEAL_LABEL: Record<string, string> = {
  breakfast: "breakfast",
  brunch: "brunch",
  lunch: "lunch",
  dinner: "dinner",
  snack: "a snack",
};

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function loggedFoodsLine(
  meal: string | null,
  names: string[],
  kcalToday: number,
  proteinToday: number
): string {
  const head = meal ? `Logged ${MEAL_LABEL[meal] ?? meal}: ` : "Logged: ";
  return `${head}${names.join(", ")}. Today ${fmtInt(kcalToday)} kcal · ${fmtInt(proteinToday)} g protein.`;
}

// "Fixed: Premier Protein shake, 325 ml — 160 kcal · 30 g protein. Today 710 kcal · 60 g protein."
export function fixedFoodLine(f: CardFood, kcalToday: number, proteinToday: number): string {
  const nums: string[] = [];
  if (f.kcal != null) nums.push(`${fmtInt(f.kcal)} kcal`);
  if (f.protein_g != null) nums.push(`${fmtInt(f.protein_g)} g protein`);
  return `Fixed: ${f.name}${f.serving ? `, ${f.serving}` : ""}${nums.length ? ` — ${nums.join(" · ")}` : ""}. Today ${fmtInt(kcalToday)} kcal · ${fmtInt(proteinToday)} g protein.`;
}

export function mealLabel(meal: string | null): string | null {
  if (!meal) return null;
  return meal.charAt(0).toUpperCase() + meal.slice(1);
}
