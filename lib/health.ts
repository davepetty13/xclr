// Apple Health sync (via iPhone Shortcuts). Pure parsing + small read helpers.
// Health numbers are personal: nothing here logs a value or a token.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export const HEALTH_FIELDS = ["steps", "active", "workouts", "sleep", "weight", "resting_hr"] as const;
export type HealthField = (typeof HEALTH_FIELDS)[number];
export type HealthFields = Record<HealthField, boolean>;

export const DEFAULT_HEALTH_FIELDS: HealthFields = {
  steps: true,
  active: true,
  workouts: true,
  sleep: true,
  weight: true,
  resting_hr: true,
};

// "Share with my coach": weekly averages and Watch workouts go into the
// weekly review only when this is on (resting heart rate never does). Stored
// in profiles.health_sync_fields.share_with_coach; missing = off, and making
// the first sync link switches it on.
export function readShareWithCoach(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>).share_with_coach === true;
}

export function readHealthFields(v: unknown): HealthFields {
  const out = { ...DEFAULT_HEALTH_FIELDS };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of HEALTH_FIELDS) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === "boolean") out[k] = x;
    }
  }
  return out;
}

// Limits (match the CHECKs in migration 008).
export const LIMITS = {
  bodyBytes: 64 * 1024,
  days: 14,
  workouts: 50,
  steps: [0, 200_000],
  kcal: [0, 20_000],
  sleep: [0, 1440],
  hr: [20, 250],
  weight: [20, 400],
  minutes: [0, 1440],
} as const;

export type DayIn = {
  date: string;
  steps?: number;
  active_kcal?: number;
  resting_hr?: number;
  sleep_minutes?: number;
  weight_kg?: number;
};
export type WorkoutIn = {
  external_id: string;
  started_at: string;
  ended_at: string | null;
  kind: string;
  minutes: number | null;
  kcal: number | null;
  avg_hr: number | null;
};
export const HEALTH_SOURCES = ["apple_health", "health_connect", "other"] as const;
export type HealthSource = (typeof HEALTH_SOURCES)[number];
export type SyncPayload = { source: HealthSource; days: DayIn[]; workouts: WorkoutIn[] };
export type ParseResult = { ok: true; payload: SyncPayload } | { ok: false; error: string };

// Shortcuts often sends numbers as text with a unit ("8,412 steps", "71.6 kg").
// Accept a plain number, or a string that is a number + an optional unit word.
// Returns the number and the unit (lower-case) or null when it isn't one.
function num(v: unknown): { n: number; unit: string } | null {
  if (typeof v === "number") return Number.isFinite(v) ? { n: v, unit: "" } : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 40) return null;
  const m = /^(-?\d{1,3}(?:,\d{3})+|-?\d+)(\.\d+)?\s*([a-zA-Z/ ]{0,20})$/.exec(s);
  if (!m) return null;
  const n = Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`);
  return Number.isFinite(n) ? { n, unit: m[3].trim().toLowerCase() } : null;
}

function inRange(n: number, [lo, hi]: readonly [number, number]): boolean {
  return n >= lo && n <= hi;
}

// Optional integer field: absent/blank → undefined, present but wrong → error.
type Field<T> = { ok: true; value: T | undefined } | { ok: false };
function intField(v: unknown, range: readonly [number, number]): Field<number> {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  const p = num(v);
  if (!p) return { ok: false };
  const n = Math.round(p.n);
  return inRange(n, range) ? { ok: true, value: n } : { ok: false };
}

function weightField(v: unknown): Field<number> {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  const p = num(v);
  if (!p) return { ok: false };
  const lb = p.unit === "lb" || p.unit === "lbs" || p.unit === "pounds";
  const kg = Math.round((lb ? p.n * 0.45359237 : p.n) * 100) / 100;
  return inRange(kg, LIMITS.weight) ? { ok: true, value: kg } : { ok: false };
}

// Sleep: exactly one unit per field, never guessed from the size of the
// number. sleep_minutes (minutes), sleep_hours (hours, decimals ok) or
// sleep_seconds (seconds — what Shortcuts durations usually are). A unit word
// is allowed only if it matches the field ("420 min", "7.5 h", "25200 s").
const SLEEP_UNITS: { key: string; per: number; words: RegExp }[] = [
  { key: "sleep_minutes", per: 1, words: /^(|m|min|mins|minute|minutes)$/ },
  { key: "sleep_hours", per: 60, words: /^(|h|hr|hrs|hour|hours)$/ },
  { key: "sleep_seconds", per: 1 / 60, words: /^(|s|sec|secs|second|seconds)$/ },
];

function sleepField(row: Record<string, unknown>): Field<number> {
  for (const u of SLEEP_UNITS) {
    const raw = row[u.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const p = num(raw);
    if (!p || !u.words.test(p.unit)) return { ok: false };
    const n = Math.round(p.n * u.per);
    return inRange(n, LIMITS.sleep) ? { ok: true, value: n } : { ok: false };
  }
  return { ok: true, value: undefined };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function cleanKind(v: unknown): string {
  if (typeof v !== "string") return "Workout";
  // Shortcuts sends e.g. "HKWorkoutActivityTypeBadminton" or "Badminton".
  const s = v
    .replace(/^HKWorkoutActivityType/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9\u00C0-\u024F '&()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return s || "Workout";
}

function parseDay(row: unknown, today: string): DayIn | string {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "Each day must be an object.";
  const r = row as Record<string, unknown>;
  const date = typeof r.date === "string" && r.date.trim() ? r.date.trim().slice(0, 10) : today;
  if (!validDate(date)) return "Dates must look like 2026-11-28.";
  if (date > addDays(today, 1) || date < addDays(today, -LIMITS.days)) return "Dates must be within the last 14 days.";

  const steps = intField(r.steps, LIMITS.steps);
  const active = intField(r.active_kcal ?? r.active_energy, LIMITS.kcal);
  const hr = intField(r.resting_hr, LIMITS.hr);
  const sleep = sleepField(r);
  const weight = weightField(r.weight_kg ?? r.weight);
  if (!steps.ok) return "Steps must be a number from 0 to 200,000.";
  if (!active.ok) return "Active calories must be a number from 0 to 20,000.";
  if (!hr.ok) return "Resting heart rate must be from 20 to 250.";
  if (!sleep.ok) return "Sleep must be 0 to 24 hours, sent as sleep_minutes, sleep_hours or sleep_seconds.";
  if (!weight.ok) return "Weight must be from 20 to 400 kg.";
  return {
    date,
    steps: steps.value,
    active_kcal: active.value,
    resting_hr: hr.value,
    sleep_minutes: sleep.value,
    weight_kg: weight.value,
  };
}

function parseWorkout(row: unknown, nowMs: number): WorkoutIn | string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "Each workout must be an object.";
  const r = row as Record<string, unknown>;
  const startRaw = typeof r.start === "string" ? r.start : typeof r.started_at === "string" ? r.started_at : null;
  if (!startRaw || startRaw.length > 40) return "Each workout needs a start time.";
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) return "A workout start time couldn't be read.";
  if (startMs > nowMs + 3_600_000 || startMs < nowMs - (LIMITS.days + 1) * 86_400_000) return null; // out of window: skip quietly
  const endRaw = typeof r.end === "string" ? r.end : typeof r.ended_at === "string" ? r.ended_at : null;
  const endMs = endRaw && endRaw.length <= 40 ? Date.parse(endRaw) : NaN;
  const end = Number.isFinite(endMs) && endMs >= startMs ? new Date(endMs).toISOString() : null;

  let minutes: number | null = null;
  const m = intField(r.minutes ?? r.duration_minutes, LIMITS.minutes);
  if (!m.ok) return "Workout minutes must be from 0 to 1,440.";
  if (m.value !== undefined) minutes = m.value;
  else if (end) minutes = Math.min(1440, Math.round((endMs - startMs) / 60_000));

  const kcal = intField(r.kcal ?? r.active_kcal, LIMITS.kcal);
  if (!kcal.ok) return "Workout calories must be from 0 to 20,000.";
  const hr = intField(r.avg_hr, LIMITS.hr);
  if (!hr.ok) return "Workout heart rate must be from 20 to 250.";

  const kind = cleanKind(r.kind ?? r.type);
  const started = new Date(startMs).toISOString();
  let ext = typeof r.id === "string" ? r.id.trim() : typeof r.id === "number" ? String(r.id) : "";
  if (!/^[\w.:-]{1,200}$/.test(ext)) ext = `${started}|${kind}`.slice(0, 200);
  return {
    external_id: ext,
    started_at: started,
    ended_at: end,
    kind,
    minutes,
    kcal: kcal.value ?? null,
    avg_hr: hr.value ?? null,
  };
}

// Accepts {days:[...], workouts:[...]} or the flat one-day shape a Shortcut
// makes ({date, steps, active_kcal, ...} with an optional workouts list).
export function parseSyncBody(body: unknown, today: string, nowMs: number = Date.now()): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const b = { ...(body as Record<string, unknown>) };

  // Which app sent it (Shortcuts on iPhone by default; Health Connect on Android).
  let source: HealthSource = "apple_health";
  if (b.source !== undefined && b.source !== null && b.source !== "") {
    if (typeof b.source !== "string" || !HEALTH_SOURCES.includes(b.source as HealthSource))
      return { ok: false, error: "source must be apple_health, health_connect or other." };
    source = b.source as HealthSource;
  }
  delete b.source;

  let dayRows: unknown[];
  if (b.days !== undefined) {
    if (!Array.isArray(b.days)) return { ok: false, error: "days must be a list." };
    dayRows = b.days;
  } else {
    const flat = { ...b };
    delete flat.workouts;
    const hasAny = Object.keys(flat).some((k) => k !== "date");
    dayRows = hasAny ? [flat] : [];
  }
  if (dayRows.length > LIMITS.days) return { ok: false, error: "At most 14 days per sync." };

  const byDate = new Map<string, DayIn>();
  for (const row of dayRows) {
    const d = parseDay(row, today);
    if (typeof d === "string") return { ok: false, error: d };
    byDate.set(d.date, { ...byDate.get(d.date), ...stripUndefined(d) } as DayIn);
  }

  const wRaw = b.workouts;
  const workouts: WorkoutIn[] = [];
  if (wRaw !== undefined && wRaw !== null && wRaw !== "") {
    if (!Array.isArray(wRaw)) return { ok: false, error: "workouts must be a list." };
    if (wRaw.length > LIMITS.workouts) return { ok: false, error: "At most 50 workouts per sync." };
    const seen = new Set<string>();
    for (const row of wRaw) {
      const w = parseWorkout(row, nowMs);
      if (typeof w === "string") return { ok: false, error: w };
      if (w && !seen.has(w.external_id)) {
        seen.add(w.external_id);
        workouts.push(w);
      }
    }
  }

  return { ok: true, payload: { source, days: Array.from(byDate.values()), workouts } };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------- reads ----------

export type HealthDay = {
  local_date: string;
  steps: number | null;
  active_kcal: number | null;
  resting_hr: number | null;
  sleep_minutes: number | null;
  weight_kg: number | null;
  updated_at: string | null;
};

const n = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function toHealthDay(r: Record<string, unknown>): HealthDay {
  return {
    local_date: r.local_date as string,
    steps: n(r.steps),
    active_kcal: n(r.active_kcal),
    resting_hr: n(r.resting_hr),
    sleep_minutes: n(r.sleep_minutes),
    weight_kg: n(r.weight_kg),
    updated_at: (r.updated_at as string | null) ?? null,
  };
}

export type HealthAverages = {
  days: number;
  avg_steps: number | null;
  avg_active_kcal: number | null;
  avg_sleep_min: number | null;
};

// Averages over [fromDate, toDate) (toDate null = up to today). Each metric
// averages only the days that have it; null when no day has it.
export async function healthAverages(
  supabase: Supa,
  userId: string,
  fromDate: string,
  toDate: string | null
): Promise<HealthAverages | null> {
  let q = supabase
    .from("health_daily")
    .select("steps, active_kcal, sleep_minutes")
    .eq("user_id", userId)
    .gte("local_date", fromDate);
  if (toDate) q = q.lt("local_date", toDate);
  const { data, error } = await q;
  if (error || !data || !data.length) return null;
  const avg = (key: "steps" | "active_kcal" | "sleep_minutes") => {
    const vals = data.map((r) => n((r as Record<string, unknown>)[key])).filter((x): x is number => x != null && x > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const out = {
    days: data.length,
    avg_steps: avg("steps"),
    avg_active_kcal: avg("active_kcal"),
    avg_sleep_min: avg("sleep_minutes"),
  };
  return out.avg_steps == null && out.avg_active_kcal == null && out.avg_sleep_min == null ? null : out;
}

export function fmtSleep(min: number): string {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
