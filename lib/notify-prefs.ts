// Reminder settings: shape, defaults, validation. Shared by the settings page
// (client) and the reminder job (server). No secrets here.

export type NotifyPrefs = {
  enabled: boolean;
  breakfast_on: boolean;
  breakfast_time: string; // "HH:MM"
  lunch_on: boolean;
  lunch_time: string;
  dinner_on: boolean;
  dinner_time: string;
  session_on: boolean;
  session_time: string;
  workout_reminder_on: boolean;
  workout_reminder_time: string;
  calories_on: boolean;
  calories_time: string;
  review_on: boolean;
  nudges_on: boolean;
  steps_on: boolean; // Watch & activity (needs Watch & phone sync)
  steps_time: string;
  sleep_on: boolean;
  sync_check_on: boolean;
  sync_check_time: string;
  quiet_start: string | null; // null = no quiet hours
  quiet_end: string | null;
};

export const DEFAULT_PREFS: NotifyPrefs = {
  enabled: false,
  breakfast_on: true,
  breakfast_time: "10:00",
  lunch_on: true,
  lunch_time: "14:00",
  dinner_on: true,
  dinner_time: "21:00",
  session_on: true,
  session_time: "07:00",
  workout_reminder_on: true,
  workout_reminder_time: "20:00",
  calories_on: true,
  calories_time: "20:00",
  review_on: true,
  nudges_on: true,
  steps_on: true,
  steps_time: "18:30",
  sleep_on: true,
  sync_check_on: true,
  sync_check_time: "22:00",
  quiet_start: "22:00",
  quiet_end: "06:00",
};

export const BOOL_KEYS = [
  "enabled",
  "breakfast_on",
  "lunch_on",
  "dinner_on",
  "session_on",
  "workout_reminder_on",
  "calories_on",
  "review_on",
  "nudges_on",
  "steps_on",
  "sleep_on",
  "sync_check_on",
] as const;
export const TIME_KEYS = [
  "breakfast_time",
  "lunch_time",
  "dinner_time",
  "session_time",
  "workout_reminder_time",
  "calories_time",
  "steps_time",
  "sync_check_time",
] as const;

// "10:00:00" (Postgres time) or "10:00" → "10:00"; anything else → null.
export function hhmm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${m[1]}:${m[2]}`;
}

// Only 30-minute steps are offered, so only those are accepted.
export function validStep(v: unknown): string | null {
  const t = hhmm(v);
  return t && (t.endsWith(":00") || t.endsWith(":30")) ? t : null;
}

export function readPrefs(row: Record<string, unknown> | null | undefined): NotifyPrefs {
  const p: NotifyPrefs = { ...DEFAULT_PREFS };
  if (!row) return p;
  for (const k of BOOL_KEYS) if (typeof row[k] === "boolean") p[k] = row[k] as boolean;
  for (const k of TIME_KEYS) p[k] = hhmm(row[k]) ?? DEFAULT_PREFS[k];
  const qs = hhmm(row.quiet_start);
  const qe = hhmm(row.quiet_end);
  p.quiet_start = qs && qe ? qs : null;
  p.quiet_end = qs && qe ? qe : null;
  return p;
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// 30-minute steps for the time dropdowns: "00:00" … "23:30".
export const TIME_OPTIONS: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  return { value: `${String(h).padStart(2, "0")}:${m}`, label: timeLabel(`${String(h).padStart(2, "0")}:${m}`) };
});

export function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (h === 0 && m === 0) return "Midnight";
  if (h === 12 && m === 0) return "Noon";
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// Quiet hours: a short list of sensible windows (dropdown, not a pill row).
export const QUIET_OPTIONS: { value: string; start: string | null; end: string | null; label: string }[] = [
  { value: "off", start: null, end: null, label: "Off" },
  { value: "21-06", start: "21:00", end: "06:00", label: "9 PM – 6 AM" },
  { value: "22-06", start: "22:00", end: "06:00", label: "10 PM – 6 AM" },
  { value: "22-07", start: "22:00", end: "07:00", label: "10 PM – 7 AM" },
  { value: "23-06", start: "23:00", end: "06:00", label: "11 PM – 6 AM" },
  { value: "23-07", start: "23:00", end: "07:00", label: "11 PM – 7 AM" },
  { value: "00-07", start: "00:00", end: "07:00", label: "Midnight – 7 AM" },
];

export function quietValue(p: Pick<NotifyPrefs, "quiet_start" | "quiet_end">): string {
  const hit = QUIET_OPTIONS.find((o) => o.start === p.quiet_start && o.end === p.quiet_end);
  return hit ? hit.value : p.quiet_start ? "custom" : "off";
}

// Is local minute-of-day `now` inside quiet hours? Handles windows that wrap
// past midnight (22:00 → 06:00).
export function inQuietHours(p: Pick<NotifyPrefs, "quiet_start" | "quiet_end">, now: number): boolean {
  if (!p.quiet_start || !p.quiet_end) return false;
  const s = toMinutes(p.quiet_start);
  const e = toMinutes(p.quiet_end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

// Inbox tabs.
export const MEAL_KINDS = new Set(["meal_breakfast", "meal_lunch", "meal_dinner", "protein", "calories_low", "calories_high"]);
export const TRAINING_KINDS = new Set(["session", "workout_missing", "review", "weigh_in", "steps_low", "sleep_short", "sync_missing"]);

// Which logged meals count as "breakfast / lunch / dinner is logged".
export const MEAL_COUNTS: Record<"breakfast" | "lunch" | "dinner", readonly string[]> = {
  breakfast: ["breakfast", "brunch"],
  lunch: ["lunch", "brunch"],
  dinner: ["dinner"],
};
