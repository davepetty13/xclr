// The ready-made "Xclr Sync" shortcut (format "shortcut_v1") sends raw Apple
// Health sample lists instead of totals, because Shortcuts can't de-duplicate
// iPhone + Watch samples itself. Each list arrives as a JSON array or as text
// with one item per line. This turns them into one flat day:
//   steps / active_kcal — summed per source (iPhone, Watch…), keeping the
//                         largest source total, so the same walk isn't counted
//                         twice when both devices recorded it.
//   sleep_minutes       — asleep stages only (Core, Deep, REM, Asleep), largest
//                         source; falls back to "In Bed" when that's all there is.
//   resting_hr          — the latest sample.
// Never invents a number: a list that's missing or unreadable is left out.

const MAX_ITEMS = 5000;

function toList(v: unknown): string[] | null {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => String(x ?? "").trim());
  if (typeof v === "number") return Number.isFinite(v) ? [String(v)] : null;
  if (typeof v === "string") return v.split(/\r?\n/).slice(0, MAX_ITEMS).map((s) => s.trim());
  return null;
}

function toNum(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// "1:06:52" → 4012 s, "28:09" → 1689 s (minutes:seconds), "3600" → 3600 s,
// "7 hr 12 min" / "45 min" → seconds.
export function durationSeconds(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const p = t.split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  const h = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/i);
  const sec = t.match(/(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/i);
  if (h || m || sec) return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
  const n = toNum(t);
  return n == null ? null : n;
}

function maxBySource(values: number[], sources: string[] | null): number | null {
  if (!values.length) return null;
  if (!sources || sources.length !== values.length) return values.reduce((a, b) => a + b, 0);
  const per = new Map<string, number>();
  values.forEach((v, i) => per.set(sources[i] || "?", (per.get(sources[i] || "?") ?? 0) + v));
  return Math.max(...Array.from(per.values()));
}

function summed(valuesRaw: unknown, sourcesRaw: unknown): number | undefined {
  const vals = toList(valuesRaw);
  if (!vals) return undefined;
  const nums: number[] = [];
  const srcs: string[] = [];
  const sourceList = toList(sourcesRaw);
  vals.forEach((s, i) => {
    const n = toNum(s);
    if (n != null && n >= 0) {
      nums.push(n);
      srcs.push(sourceList?.[i] ?? "?");
    }
  });
  if (!nums.length) return vals.every((s) => !s) ? undefined : 0;
  const total = maxBySource(nums, sourceList && sourceList.length === vals.length ? srcs : null);
  return total == null ? undefined : Math.round(total);
}

const ASLEEP = /asleep|core|deep|rem/i;
const IN_BED = /in ?bed/i;

function sleepMinutes(valuesRaw: unknown, durationsRaw: unknown, sourcesRaw: unknown): number | undefined {
  const vals = toList(valuesRaw);
  const durs = toList(durationsRaw);
  if (!vals || !durs || vals.length !== durs.length) return undefined;
  const sources = toList(sourcesRaw);
  const useSources = sources && sources.length === vals.length ? sources : null;
  const pick = (re: RegExp) => {
    const nums: number[] = [];
    const srcs: string[] = [];
    vals.forEach((v, i) => {
      if (!re.test(v) || /awake/i.test(v)) return;
      const d = durationSeconds(durs[i]);
      if (d != null && d > 0 && d <= 86400) {
        nums.push(d);
        srcs.push(useSources?.[i] ?? "?");
      }
    });
    return maxBySource(nums, useSources ? srcs : null);
  };
  const secs = pick(ASLEEP) ?? pick(IN_BED);
  if (secs == null) return undefined;
  return Math.min(1440, Math.round(secs / 60));
}

export function fromShortcutV1(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof b.date === "string") out.date = b.date;
  const steps = summed(b.steps_values, b.steps_sources);
  if (steps !== undefined) out.steps = steps;
  const active = summed(b.active_values, b.active_sources);
  if (active !== undefined) out.active_kcal = active;
  const sleep = sleepMinutes(b.sleep_values, b.sleep_durations, b.sleep_sources);
  if (sleep !== undefined) out.sleep_minutes = sleep;
  const hrList = toList(b.resting_hr);
  const hr = hrList?.length ? toNum(hrList[0]) : null;
  if (hr != null) out.resting_hr = Math.round(hr);
  return out;
}
