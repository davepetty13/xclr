// Local-calendar "today" for Xclr. The app used UTC days before v3, which made
// "today" reset at 8:00 AM in Manila. Every day boundary now goes through here.
// Stored data is unchanged: timestamps stay full timestamptz values.

export const DEFAULT_TZ = "Asia/Manila";

function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

// Minutes the zone is ahead of UTC at the given instant (Manila → 480).
function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

// The local calendar date (YYYY-MM-DD) of an instant in the user's zone.
export function localDate(tz?: string | null, at: Date = new Date()): string {
  const zone = safeTz(tz);
  const shifted = new Date(at.getTime() + offsetMinutes(zone, at) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

// Today's local date (YYYY-MM-DD).
export function todayLocal(tz?: string | null): string {
  return localDate(tz);
}

// Add whole days to a YYYY-MM-DD date.
export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The UTC instant (ISO string) when a local date starts — e.g. midnight in
// Manila on 2026-11-26 → "2026-11-25T16:00:00.000Z". Use for logged_at >= ...
export function localDayStartISO(dateISO: string, tz?: string | null): string {
  const zone = safeTz(tz);
  const guess = new Date(`${dateISO}T00:00:00Z`);
  const off = offsetMinutes(zone, guess);
  return new Date(guess.getTime() - off * 60_000).toISOString();
}

// Start of today and start of tomorrow (local), as UTC ISO strings.
export function todayWindow(tz?: string | null): { start: string; end: string; date: string } {
  const date = todayLocal(tz);
  return { date, start: localDayStartISO(date, tz), end: localDayStartISO(addDays(date, 1), tz) };
}

// A timestamp to store for something eaten on a past local date (noon local,
// so it lands safely inside that day).
export function noonOnLocalDateISO(dateISO: string, tz?: string | null): string {
  const start = new Date(localDayStartISO(dateISO, tz));
  return new Date(start.getTime() + 12 * 3_600_000).toISOString();
}

// "Wed, Nov 25" style label for a local date.
export function prettyDate(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
