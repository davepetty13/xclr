// Home and bodyweight versions of gym exercises — a small built-in map, no AI.
// Used by "At home today" (automatic swap per exercise) and by the swap picker's
// Home / Bodyweight tabs. Pure module: safe on the server and in the browser.

import type { LoadType } from "@/lib/program-schema";

export const CATEGORIES = ["push", "pull", "legs", "core", "cardio", "mobility"] as const;
export type Category = (typeof CATEGORIES)[number];

export function asCategory(v: unknown): Category | null {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v) ? (v as Category) : null;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  push: "Chest · shoulders · triceps",
  pull: "Back · biceps",
  legs: "Legs · glutes",
  core: "Core",
  cardio: "Cardio",
  mobility: "Mobility",
};

// ── Home equipment (profiles.home_equipment) ────────────────────────────────

export type HomeEquipment = {
  dumbbells_max_kg: number; // 0 = no dumbbells
  bands: boolean;
  pullup_bar: boolean;
  bench: boolean; // bench or a sturdy chair
  kettlebell_kg: number; // 0 = no kettlebell
  mat: boolean;
};

export const NO_EQUIPMENT: HomeEquipment = {
  dumbbells_max_kg: 0,
  bands: false,
  pullup_bar: false,
  bench: false,
  kettlebell_kg: 0,
  mat: false,
};

// Never trust the stored / posted shape: unknown keys drop, numbers clamp.
export function normalizeEquipment(raw: unknown): HomeEquipment {
  if (!raw || typeof raw !== "object") return { ...NO_EQUIPMENT };
  const r = raw as Record<string, unknown>;
  const kg = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v)) * 2) / 2 : 0;
  return {
    dumbbells_max_kg: kg(r.dumbbells_max_kg),
    bands: r.bands === true,
    pullup_bar: r.pullup_bar === true,
    bench: r.bench === true,
    kettlebell_kg: kg(r.kettlebell_kg),
    mat: r.mat === true,
  };
}

// "dumbbells up to 10 kg, mat" — or "bodyweight only".
export function describeEquipment(eq: HomeEquipment): string {
  const parts: string[] = [];
  if (eq.dumbbells_max_kg > 0) parts.push(`dumbbells up to ${eq.dumbbells_max_kg} kg`);
  if (eq.bands) parts.push("bands");
  if (eq.pullup_bar) parts.push("pull-up bar");
  if (eq.bench) parts.push("bench");
  if (eq.kettlebell_kg > 0) parts.push(`${eq.kettlebell_kg} kg kettlebell`);
  if (eq.mat) parts.push("mat");
  return parts.length ? parts.join(", ") : "bodyweight only";
}

// ── Category guess for names without one (typed exercises, old rows) ───────

const GUESS: [Category, RegExp][] = [
  ["cardio", /\b(run|running|jog|walk|treadmill|bike|cycling|spin|rowing machine|rower|erg|swim|badminton|basketball|tennis|football|futsal|volleyball|hike|elliptical|stair|skipping|jump rope|zumba|dance|boxing|cardio)\b/],
  ["mobility", /\b(stretch|stretching|mobility|yoga|foam roll|pilates)\b/],
  ["core", /\b(plank|crunch|abs?|sit-?ups?|leg raises?|pallof|dead ?bug|twist|hollow|woodchop|bird ?dog)\b/],
  ["legs", /\b(squat|lunge|leg|legs|deadlift|rdl|romanian|calf|calves|glute|hip thrust|step-?ups?|hamstring|quad)\b/],
  ["pull", /\b(row|pull|pulldown|pull-?ups?|chin-?ups?|curl|face pull|rear delt|shrug|lat)\b/],
  ["push", /\b(press|push-?ups?|dips?|fly|flye|raise|triceps?|pushdown|extension|bench)\b/],
];

export function guessCategory(name: string): Category | null {
  const n = name.toLowerCase();
  for (const [c, re] of GUESS) if (re.test(n)) return c;
  return null;
}

// ── The map ─────────────────────────────────────────────────────────────────

type Needs = "dumbbells" | "bands" | "pullup_bar" | "bench" | "kettlebell";
// per_side = a dumbbell in each hand · single = one dumbbell · band = band
// tension (no number) · bodyweight · time = minutes.
type LoadKind = "per_side" | "single" | "band" | "bodyweight" | "time";

export type Alternative = {
  name: string;
  category: Category;
  needs: Needs[];
  load: LoadKind;
  tip: string | null;
};

const alt = (name: string, category: Category, needs: Needs[], load: LoadKind, tip: string | null = null): Alternative => ({
  name,
  category,
  needs,
  load,
  tip,
});

// Common picks, reused below.
const PUSH_UPS = alt("Push-ups", "push", [], "bodyweight", "hands on a chair to make it easier");
const DB_FLOOR_PRESS = alt("Dumbbell floor press", "push", ["dumbbells"], "per_side", null);
const DB_ROW = alt("Dumbbell row", "pull", ["dumbbells"], "per_side", "one arm at a time, hand on a chair");
const BAND_ROW = alt("Band row", "pull", ["bands"], "band", null);
const TABLE_ROW = alt("Table row", "pull", [], "bodyweight", "lie under a sturdy table and pull your chest up");
const GOBLET_SQUAT = alt("Goblet squat", "legs", ["dumbbells"], "single", null);
const SPLIT_SQUAT = alt("Bulgarian split squat", "legs", [], "bodyweight", "back foot on a chair");
const BW_SQUAT = alt("Bodyweight squat", "legs", [], "bodyweight", null);
const DB_RDL = alt("Dumbbell Romanian deadlift", "legs", ["dumbbells"], "per_side", null);
const GLUTE_BRIDGE = alt("Single-leg glute bridge", "legs", [], "bodyweight", null);
const PLANK = alt("Plank", "core", [], "time", null);
const DEAD_BUG = alt("Dead bug", "core", [], "bodyweight", null);
const WALK = alt("Brisk walk", "cardio", [], "time", "outside or around the house");
const JACKS = alt("Jumping jacks", "cardio", [], "time", "in rounds of 1 minute");

// Order matters: the first match wins, so specific names come before general
// ones ("leg curl" before "curl", "rowing machine" before "row").
const SWAPS: { match: RegExp; alts: Alternative[] }[] = [
  { match: /treadmill|stair|elliptical|stationary bike|exercise bike|spin bike|cycling|rowing machine|rower|\berg\b/, alts: [WALK, JACKS] },
  { match: /leg curl|hamstring curl/, alts: [DB_RDL, GLUTE_BRIDGE] },
  { match: /leg press|hack squat|smith.*squat|barbell.*squat|back squat|front squat|^squat$/, alts: [GOBLET_SQUAT, SPLIT_SQUAT, BW_SQUAT] },
  { match: /leg extension/, alts: [GOBLET_SQUAT, SPLIT_SQUAT] },
  { match: /deadlift|rdl|romanian/, alts: [DB_RDL, alt("Kettlebell swing", "legs", ["kettlebell"], "single"), GLUTE_BRIDGE] },
  { match: /hip thrust|glute (drive|machine|kickback)|cable kickback/, alts: [alt("Dumbbell hip thrust", "legs", ["dumbbells"], "single", "back on a sofa or chair"), alt("Glute bridge", "legs", [], "bodyweight")] },
  { match: /calf/, alts: [alt("Dumbbell calf raise", "legs", ["dumbbells"], "per_side"), alt("Single-leg calf raise", "legs", [], "bodyweight", "on a step")] },
  { match: /lunge/, alts: [alt("Dumbbell lunge", "legs", ["dumbbells"], "per_side"), alt("Bodyweight lunge", "legs", [], "bodyweight")] },
  { match: /(bench|chest) press|smith.*press|machine press|incline press|decline press/, alts: [DB_FLOOR_PRESS, PUSH_UPS, alt("Band chest press", "push", ["bands"], "band")] },
  { match: /fly|flye|pec deck|crossover/, alts: [PUSH_UPS, alt("Dumbbell floor fly", "push", ["dumbbells"], "per_side")] },
  { match: /\bdips?\b/, alts: [alt("Chair dips", "push", [], "bodyweight", "hands on a sturdy chair")] },
  { match: /overhead press|shoulder press|military press|\bohp\b|arnold/, alts: [alt("Dumbbell shoulder press", "push", ["dumbbells"], "per_side"), alt("Band overhead press", "push", ["bands"], "band"), alt("Pike push-ups", "push", [], "bodyweight")] },
  { match: /lateral raise|side raise/, alts: [alt("Dumbbell lateral raise", "push", ["dumbbells"], "per_side"), alt("Band lateral raise", "push", ["bands"], "band"), alt("Pike push-ups", "push", [], "bodyweight")] },
  { match: /tricep|pushdown|push-down|skull/, alts: [alt("Dumbbell overhead triceps extension", "push", ["dumbbells"], "single"), alt("Band pushdown", "push", ["bands"], "band"), alt("Diamond push-ups", "push", [], "bodyweight")] },
  { match: /pulldown|pull-down|pull-?ups?|chin-?ups?/, alts: [alt("Pull-ups", "pull", ["pullup_bar"], "bodyweight"), alt("Band pulldown", "pull", ["bands"], "band", "band over a door or bar"), DB_ROW, TABLE_ROW] },
  { match: /face pull|rear delt|reverse fly|reverse pec/, alts: [alt("Band face pull", "pull", ["bands"], "band"), alt("Dumbbell rear-delt fly", "pull", ["dumbbells"], "per_side"), alt("Prone Y-raise", "pull", [], "bodyweight", "lying face down on the floor")] },
  { match: /\brow\b|\brows\b/, alts: [DB_ROW, BAND_ROW, TABLE_ROW] },
  { match: /curl/, alts: [alt("Dumbbell curl", "pull", ["dumbbells"], "per_side"), alt("Band curl", "pull", ["bands"], "band")] },
  { match: /shrug/, alts: [alt("Dumbbell shrug", "pull", ["dumbbells"], "per_side")] },
  { match: /cable crunch|ab machine|crunch machine|ab crunch|decline crunch/, alts: [alt("Crunch", "core", [], "bodyweight"), DEAD_BUG] },
  { match: /pallof|woodchop|cable twist|cable rotation/, alts: [alt("Band Pallof press", "core", ["bands"], "band"), DEAD_BUG] },
  { match: /hanging (leg|knee) raise|captain/, alts: [alt("Hanging knee raise", "core", ["pullup_bar"], "bodyweight"), alt("Lying leg raise", "core", [], "bodyweight")] },
];

const CATEGORY_DEFAULTS: Record<Category, Alternative[]> = {
  push: [DB_FLOOR_PRESS, PUSH_UPS],
  pull: [DB_ROW, BAND_ROW, TABLE_ROW],
  legs: [GOBLET_SQUAT, SPLIT_SQUAT, BW_SQUAT],
  core: [PLANK, DEAD_BUG],
  cardio: [WALK, JACKS],
  mobility: [],
};

// Already fine at home as written (dumbbell work, bodyweight moves, walks…).
const HOME_READY = /dumbbell|kettlebell|\bdb\b|push-?ups?|plank|bodyweight|crunch|sit-?ups?|dead ?bug|bird ?dog|glute bridge|lying leg raise|burpee|jumping jack|walk|jog|\brun\b|running|skipping|jump rope|stretch|mobility|yoga|foam roll|chair dips|table row|band /;

// One-weight moves (goblet squat…) work with a kettlebell too.
// …unless it names gym kit ("Treadmill walk", "Smith machine lunge").
const GYM_ONLY = /treadmill|machine|cable|smith|barbell|stair|elliptical|rower|leg press/;

function hasAll(a: Alternative, eq: HomeEquipment): boolean {
  return a.needs.every((n) => {
    if (n === "dumbbells") return eq.dumbbells_max_kg > 0 || (a.load === "single" && eq.kettlebell_kg > 0);
    if (n === "kettlebell") return eq.kettlebell_kg > 0;
    return eq[n];
  });
}

// Every built-in alternative for a gym exercise: name hits first, then the
// category defaults. Deduped, gym name excluded.
export function alternativesFor(name: string, category: Category | null): Alternative[] {
  const n = name.toLowerCase().trim();
  const cat = category ?? guessCategory(n);
  const out: Alternative[] = [];
  const seen = new Set<string>([n]);
  const push = (a: Alternative) => {
    const k = a.name.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  };
  const hit = SWAPS.find((s) => s.match.test(n));
  for (const a of hit?.alts ?? []) push(a);
  for (const a of cat ? CATEGORY_DEFAULTS[cat] : []) push(a);
  return out;
}

// Every built-in exercise, for the picker's search box.
export function catalog(): Alternative[] {
  const out = new Map<string, Alternative>();
  for (const s of SWAPS) for (const a of s.alts) out.set(a.name.toLowerCase(), a);
  for (const list of Object.values(CATEGORY_DEFAULTS)) for (const a of list) out.set(a.name.toLowerCase(), a);
  return Array.from(out.values());
}

// Picker tabs: Home = needs some kit; Bodyweight = needs nothing.
export function pickerOptions(name: string, category: Category | null, tab: "home" | "bodyweight"): Alternative[] {
  const cat = category ?? guessCategory(name);
  const list = alternativesFor(name, cat);
  // Add the rest of the category's built-ins so the tab is never thin.
  const extra = catalog().filter((a) => a.category === cat);
  const all = [...list, ...extra.filter((e) => !list.some((l) => l.name === e.name))].filter(
    (a) => a.name.toLowerCase() !== name.toLowerCase()
  );
  return all.filter((a) => (tab === "bodyweight" ? a.needs.length === 0 : a.needs.length > 0));
}

export function needsLabel(a: Alternative): string {
  if (!a.needs.length) return "Bodyweight";
  const words: Record<Needs, string> = {
    dumbbells: "dumbbells",
    bands: "bands",
    pullup_bar: "pull-up bar",
    bench: "bench",
    kettlebell: "kettlebell",
  };
  return `Needs ${a.needs.map((x) => words[x]).join(" + ")}`;
}

// The load type a built-in alternative is logged with.
export function altLoadType(a: Alternative): LoadType {
  switch (a.load) {
    case "per_side":
      return "per_side_kg";
    case "single":
      return "total_kg";
    case "band":
      return "none";
    case "time":
      return "time_min";
    default:
      return "bodyweight";
  }
}

// ── Suggested load for a home exercise ─────────────────────────────────────

export type GymLoad = { value: number | null; type: LoadType | null };

const half = (v: number) => Math.round(v * 2) / 2;

// Turn a gym load into a home one: dumbbells are capped at what you own.
export function homeLoad(kind: LoadKind, gym: GymLoad, eq: HomeEquipment): { value: number | null; type: LoadType; capped: boolean } {
  if (kind === "bodyweight") return { value: null, type: "bodyweight", capped: false };
  if (kind === "band") return { value: null, type: "none", capped: false };
  if (kind === "time") return { value: gym.type === "time_min" ? gym.value : null, type: "time_min", capped: false };
  const max = kind === "single" ? Math.max(eq.dumbbells_max_kg, eq.kettlebell_kg) : eq.dumbbells_max_kg;
  let want: number | null = null;
  if (gym.value != null && gym.value > 0) {
    if (kind === "per_side") want = gym.type === "per_side_kg" ? gym.value : gym.type === "total_kg" ? gym.value / 2 : null;
    else want = gym.type === "total_kg" ? gym.value : gym.type === "per_side_kg" ? gym.value * 2 : null;
  }
  const value = want == null ? max : Math.min(max, half(want));
  return { value, type: kind === "per_side" ? "per_side_kg" : "total_kg", capped: want != null && want > max };
}

// ── "At home today": one home version per gym exercise ──────────────────────

export type HomeSwap = {
  name: string;
  category: Category | null;
  same: boolean; // the gym exercise works at home as-is
  load_value: number | null;
  load_type: LoadType | null;
  tip: string | null;
};

const SLOW_TIP = "slow 3-sec lowering to make light weights count";

export function homeSwapFor(
  ex: { name: string; category: Category | null; load_value: number | null; load_type: LoadType | null },
  eq: HomeEquipment
): HomeSwap {
  const n = ex.name.toLowerCase();
  const cat = ex.category ?? guessCategory(n);

  // Works at home already (needs dumbbells only if it says so).
  const isDb = /dumbbell|\bdb\b/.test(n);
  if (
    HOME_READY.test(n) &&
    !GYM_ONLY.test(n) &&
    (!isDb || eq.dumbbells_max_kg > 0) &&
    (!/kettlebell/.test(n) || eq.kettlebell_kg > 0) &&
    (!/\bband\b/.test(n) || eq.bands)
  ) {
    const needsBench = isDb && /bench|incline|decline/.test(n) && !eq.bench;
    let value = ex.load_value;
    let tip: string | null = needsBench ? "on the floor, back propped" : null;
    if (isDb && value != null && (ex.load_type === "per_side_kg" || ex.load_type === "total_kg")) {
      const cap = ex.load_type === "per_side_kg" ? eq.dumbbells_max_kg : eq.dumbbells_max_kg * 2;
      if (value > cap) {
        value = cap;
        tip = tip ? `${tip} · ${SLOW_TIP}` : SLOW_TIP;
      }
    }
    return { name: ex.name, category: cat, same: true, load_value: value, load_type: ex.load_type, tip };
  }
  if (cat === "mobility") return { name: ex.name, category: cat, same: true, load_value: ex.load_value, load_type: ex.load_type, tip: null };

  const pick = alternativesFor(ex.name, cat).find((a) => hasAll(a, eq));
  if (!pick) {
    // Nothing in the map fits (e.g. an unknown machine): keep it, say so.
    return { name: ex.name, category: cat, same: true, load_value: ex.load_value, load_type: ex.load_type, tip: "no home version found — do what you can" };
  }
  const load = homeLoad(pick.load, { value: ex.load_value, type: ex.load_type }, eq);
  const tip = [pick.tip, load.capped ? SLOW_TIP : null].filter(Boolean).join(" · ") || null;
  return { name: pick.name, category: pick.category, same: false, load_value: load.value, load_type: load.type, tip };
}
