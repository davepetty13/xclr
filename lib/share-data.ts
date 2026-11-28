import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { getWeekStatus, type WeekStatus } from "@/lib/programs";
import { addDays, DEFAULT_TZ, localDate, localDayStartISO, todayLocal } from "@/lib/time";
import { countPRs, epley1RM, type PrSet } from "@/lib/training";
import { formatLoad, LOAD_TYPES, type LoadType } from "@/lib/program-schema";
import { kgToLbs } from "@/lib/units";
import type {
  PrCardData,
  SessionCardData,
  ShareBundle,
  ShareStat,
  StripState,
  WeekCardData,
} from "@/lib/share-cards";

// Builds share-card data from the user's own rows (every query filtered by
// user_id, on top of RLS). Never invents a number: a field with no data is
// left off the card. Body weight and session notes are included here but only
// drawn when the user switches them on in the sheet.

type Supa = ReturnType<typeof createClient>;

type SessionRow = {
  id: string;
  at: string;
  type: string | null;
  note: string | null;
  dayId: string | null;
};
type SetRow = {
  sessionId: string;
  exId: string;
  load: number | null;
  type: LoadType | null;
  reps: number | null;
  rpe: number | null;
  isPr: boolean;
  at: string;
};
type DayRow = { day_index: number; label: string | null; program_id: string };

export type ShareContext = {
  tz: string;
  weightUnit: "kg" | "lbs";
  status: WeekStatus | null;
  sessions: Map<string, SessionRow>;
  sets: SetRow[];
  setsBySession: Map<string, SetRow[]>;
  names: Map<string, string>;
  days: Map<string, DayRow>;
  week: WeekCardData | null;
  weekPr: PrCardData | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asLoadType = (v: unknown): LoadType | null =>
  typeof v === "string" && (LOAD_TYPES as readonly string[]).includes(v) ? (v as LoadType) : null;

const trimNum = (n: number) => String(Math.round(n * 100) / 100);
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

function dateParts(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const mon = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return { wd, mon, day: d.getUTCDate(), year: d.getUTCFullYear() };
}

// Volume counts real external load only: total kg, and per-side kg × 2.
function volumeOf(sets: SetRow[]): number {
  return sets.reduce((sum, s) => {
    if (s.load == null || s.reps == null) return sum;
    if (s.type === "total_kg") return sum + s.load * s.reps;
    if (s.type === "per_side_kg") return sum + s.load * 2 * s.reps;
    return sum;
  }, 0);
}

function volumeStat(kg: number): ShareStat | null {
  if (!(kg > 0)) return null;
  if (kg >= 10_000) return { label: "VOLUME", value: (Math.round(kg / 100) / 10).toFixed(1), unit: "t" };
  return { label: "VOLUME", value: fmtInt(kg), unit: "kg" };
}

function avgRpe(sets: SetRow[]): number | null {
  const v = sets.map((s) => s.rpe).filter((r): r is number => r != null && r > 0);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

// "62.5 kg × 8", "20 kg/side × 10", "20 kg assist × 8", "Bodyweight × 12", "20 min".
function formatSet(s: Pick<SetRow, "load" | "type" | "reps">): string {
  const load = formatLoad(s.load, s.type);
  if (s.type === "time_min") return load || (s.reps != null ? `${s.reps} reps` : "");
  if (load && s.reps != null) return `${load} × ${s.reps}`;
  if (load) return load;
  return s.reps != null ? `${s.reps} reps` : "";
}

// Best set of an exercise within a session (for "Top sets").
function setScore(s: SetRow): number {
  switch (s.type) {
    case "total_kg":
    case "per_side_kg":
      return epley1RM(s.load, s.reps) ?? s.load ?? 0;
    case "assist_kg":
      return s.load != null ? -s.load : -Infinity; // less assist = stronger
    case "time_min":
      return s.load ?? 0;
    case "bodyweight":
      return (s.load ?? 0) * 100 + (s.reps ?? 0);
    default:
      return s.reps ?? 0;
  }
}
function better(a: SetRow, b: SetRow): boolean {
  const d = setScore(a) - setScore(b);
  return d > 0 || (d === 0 && (a.reps ?? 0) > (b.reps ?? 0));
}

// ── PRs (same rule as lib/training.ts countPRs) ─────────────────────────────
// A PR = a new best estimated 1RM for an exercise (total kg and per-side kg
// compared separately, never flattened) against everything logged before, or
// a set already flagged is_pr. No earlier history → no PR yet.
type FoundPr = { exId: string; set: SetRow; prior: SetRow | null; gain: number };

function findPRs(sets: SetRow[], inside: (s: SetRow) => boolean, cutoffISO: string): FoundPr[] {
  const cutoff = Date.parse(cutoffISO);
  const before = new Map<string, SetRow>();
  const best = new Map<string, SetRow>();
  const flagged = new Map<string, SetRow>();
  for (const s of sets) {
    const isIn = inside(s);
    if (isIn && s.isPr && !flagged.has(s.exId)) flagged.set(s.exId, s);
    if (s.type !== "total_kg" && s.type !== "per_side_kg") continue;
    const est = epley1RM(s.load, s.reps);
    if (est == null) continue;
    const key = `${s.exId}|${s.type}`;
    if (isIn) {
      const cur = best.get(key);
      if (!cur || est > (epley1RM(cur.load, cur.reps) ?? 0)) best.set(key, s);
    } else if (Date.parse(s.at) < cutoff) {
      const cur = before.get(key);
      if (!cur || est > (epley1RM(cur.load, cur.reps) ?? 0)) before.set(key, s);
    }
  }
  const out = new Map<string, FoundPr>();
  for (const [key, s] of Array.from(best.entries())) {
    const prior = before.get(key);
    if (!prior) continue;
    const a = epley1RM(s.load, s.reps) ?? 0;
    const b = epley1RM(prior.load, prior.reps) ?? 0;
    if (a > b && b > 0) {
      const gain = (a - b) / b;
      const cur = out.get(s.exId);
      if (!cur || gain > cur.gain) out.set(s.exId, { exId: s.exId, set: s, prior, gain });
    }
  }
  for (const [exId, s] of Array.from(flagged.entries()))
    if (!out.has(exId)) out.set(exId, { exId, set: s, prior: null, gain: -1 });
  return Array.from(out.values()).sort((x, y) => y.gain - x.gain);
}

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadShareContext(supabase: Supa, userId: string): Promise<ShareContext> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, weight_unit")
    .eq("id", userId)
    .maybeSingle();
  const tz = (profile?.timezone as string | null) ?? DEFAULT_TZ;
  const weightUnit: "kg" | "lbs" = profile?.weight_unit === "lbs" ? "lbs" : "kg";

  const [status, { data: sessRows }, { data: setRows }, { data: exRows }, { data: dayRows }] =
    await Promise.all([
      getWeekStatus(supabase, userId, tz),
      supabase
        .from("workout_sessions")
        .select("id, performed_at, type, my_note, program_day_id")
        .eq("user_id", userId)
        .order("performed_at", { ascending: true }),
      supabase
        .from("set_logs")
        .select("session_id, exercise_id, set_index, actual_load_value, actual_load_type, actual_reps, actual_rpe, is_pr")
        .eq("user_id", userId)
        .order("set_index", { ascending: true }),
      supabase.from("exercises").select("id, name").eq("user_id", userId),
      supabase.from("program_days").select("id, day_index, label, program_id").eq("user_id", userId),
    ]);

  const sessions = new Map<string, SessionRow>();
  for (const s of sessRows ?? [])
    sessions.set(s.id as string, {
      id: s.id as string,
      at: s.performed_at as string,
      type: (s.type as string | null) ?? null,
      note: ((s.my_note as string | null) ?? "").trim() || null,
      dayId: (s.program_day_id as string | null) ?? null,
    });

  const sets: SetRow[] = [];
  const setsBySession = new Map<string, SetRow[]>();
  for (const r of setRows ?? []) {
    const sess = sessions.get(r.session_id as string);
    if (!sess) continue;
    const row: SetRow = {
      sessionId: sess.id,
      exId: r.exercise_id as string,
      load: num(r.actual_load_value),
      type: asLoadType(r.actual_load_type),
      reps: num(r.actual_reps),
      rpe: num(r.actual_rpe),
      isPr: r.is_pr === true,
      at: sess.at,
    };
    sets.push(row);
    const list = setsBySession.get(sess.id) ?? [];
    list.push(row);
    setsBySession.set(sess.id, list);
  }

  const names = new Map<string, string>();
  for (const e of exRows ?? []) names.set(e.id as string, e.name as string);
  const days = new Map<string, DayRow>();
  for (const d of dayRows ?? [])
    days.set(d.id as string, {
      day_index: Number(d.day_index),
      label: (d.label as string | null) ?? null,
      program_id: d.program_id as string,
    });

  const ctx: ShareContext = {
    tz,
    weightUnit,
    status,
    sessions,
    sets,
    setsBySession,
    names,
    days,
    week: null,
    weekPr: null,
  };
  if (status) {
    ctx.week = await buildWeek(supabase, userId, ctx, status);
    const prs = findPRs(sets, (s) => Date.parse(s.at) >= Date.parse(status.weekStartISO), status.weekStartISO);
    ctx.weekPr = prs.length ? prCard(ctx, prs[0]) : null;
  }
  return ctx;
}

function inCurrentWeek(ctx: ShareContext, at: string): boolean {
  return !!ctx.status && Date.parse(at) >= Date.parse(ctx.status.weekStartISO);
}

function sessionTitle(ctx: ShareContext, s: SessionRow) {
  const day = s.dayId ? ctx.days.get(s.dayId) : undefined;
  if (day && Number.isFinite(day.day_index))
    return { top: `DAY ${day.day_index}`, bottom: day.label ? day.label.toUpperCase() : null, word: day.label ?? s.type };
  return { top: (s.type ?? "Session").toUpperCase(), bottom: null, word: s.type };
}

function prCard(ctx: ShareContext, pr: FoundPr): PrCardData | null {
  const s = pr.set;
  const sess = ctx.sessions.get(s.sessionId);
  if (!sess) return null;
  const exercise = ctx.names.get(pr.exId) ?? "Exercise";
  let big = "";
  let unit = "";
  let repsInBig = false;
  if (s.load != null && s.type && s.type !== "bodyweight" && s.type !== "none") {
    big = trimNum(s.load);
    unit = s.type === "total_kg" ? "KG" : s.type === "per_side_kg" ? "KG/SIDE" : s.type === "assist_kg" ? "KG ASSIST" : "MIN";
  } else if (s.reps != null) {
    big = String(s.reps);
    unit = "REPS";
    repsInBig = true;
  } else return null;

  const detail: string[] = [];
  if (!repsInBig && s.reps != null && s.type !== "time_min") detail.push(`× ${s.reps} reps`);
  if (s.rpe != null && s.rpe > 0) detail.push(`RPE ${trimNum(s.rpe)}`);
  const p = pr.prior;
  if (p && p.type === s.type && p.load != null && s.load != null && s.load > p.load) {
    detail.push(`up ${trimNum(s.load - p.load)} ${s.type === "per_side_kg" ? "kg/side" : "kg"} on your best`);
  } else if (p) {
    const prev = formatSet(p);
    if (prev) detail.push(`best before ${prev}`);
  }

  const local = localDate(ctx.tz, new Date(sess.at));
  const dp = dateParts(local);
  const title = sessionTitle(ctx, sess);
  const stats: ShareStat[] = [];
  if (title.word) stats.push({ label: "SESSION", value: title.word.charAt(0).toUpperCase() + title.word.slice(1) });
  const vol = volumeStat(volumeOf(ctx.setsBySession.get(sess.id) ?? []));
  if (vol) stats.push(vol);
  if (ctx.status && inCurrentWeek(ctx, sess.at))
    stats.push({ label: "WEEK", value: `${ctx.status.week} · ${ctx.status.doneCount}/${ctx.status.plannedCount}` });

  return {
    exercise,
    big,
    unit,
    detail: detail.join(" · "),
    dateLabel: `${dp.wd} · ${dp.day} ${dp.mon} ${dp.year}`,
    stats,
  };
}

function sessionCard(ctx: ShareContext, sess: SessionRow): { card: SessionCardData; prs: FoundPr[] } {
  const sets = ctx.setsBySession.get(sess.id) ?? [];
  const local = localDate(ctx.tz, new Date(sess.at));
  const dp = dateParts(local);
  const title = sessionTitle(ctx, sess);
  const current = inCurrentWeek(ctx, sess.at);
  const week = current && ctx.status ? ctx.status.week : null;
  const day = sess.dayId ? ctx.days.get(sess.dayId) : undefined;
  const programName =
    current && ctx.status && day && day.program_id === ctx.status.program.id ? ctx.status.program.name : null;
  const subline = [week != null ? `Week ${week}` : null, programName].filter(Boolean).join(" · ") || null;

  const stats: ShareStat[] = [];
  const vol = volumeStat(volumeOf(sets));
  if (vol) stats.push(vol);
  // TIME: sessions don't record a duration yet, so it's left off.
  if (sets.length) stats.push({ label: "SETS", value: String(sets.length) });
  const rpe = avgRpe(sets);
  if (rpe != null) stats.push({ label: "AVG RPE", value: rpe.toFixed(1) });

  // Top set per exercise, in the order the exercises were logged.
  const top = new Map<string, SetRow>();
  for (const s of sets) {
    const cur = top.get(s.exId);
    if (!cur || better(s, cur)) top.set(s.exId, s);
  }
  const topSets = Array.from(top.entries())
    .map(([exId, s]) => ({ name: ctx.names.get(exId) ?? "Exercise", value: formatSet(s) }))
    .filter((r) => r.value);

  const prs = findPRs(ctx.sets, (s) => s.sessionId === sess.id, sess.at);
  return {
    card: {
      dateLabel: `${dp.wd} · ${dp.day} ${dp.mon} ${dp.year}`,
      shortDate: `${dp.wd} ${dp.day} ${dp.mon}`,
      titleTop: title.top,
      titleBottom: title.bottom,
      subline,
      week,
      stats,
      topSets,
      prNames: prs.map((p) => ctx.names.get(p.exId) ?? "Lift"),
      note: sess.note,
    },
    prs,
  };
}

async function buildWeek(supabase: Supa, userId: string, ctx: ShareContext, st: WeekStatus): Promise<WeekCardData> {
  const monday = addDays(st.weekEndsOn, -6);
  const sunday = st.weekEndsOn;
  const today = todayLocal(ctx.tz);
  const from = st.weekStartedOn > monday ? st.weekStartedOn : monday;
  const fromISO = localDayStartISO(from, ctx.tz);
  const toISO = localDayStartISO(addDays(sunday, 1), ctx.tz);

  const [{ data: food }, { data: sleep }, { data: weights }, { data: skips }] = await Promise.all([
    supabase
      .from("food_logs")
      .select("logged_at, protein_g")
      .eq("user_id", userId)
      .gte("logged_at", fromISO)
      .lt("logged_at", toISO),
    supabase
      .from("sleep_logs")
      .select("slept_on, duration_min")
      .eq("user_id", userId)
      .gte("slept_on", from)
      .lte("slept_on", sunday),
    supabase
      .from("weights")
      .select("measured_on, kg")
      .eq("user_id", userId)
      .gte("measured_on", from)
      .lte("measured_on", sunday)
      .order("measured_on", { ascending: false })
      .limit(1),
    supabase
      .from("day_skips")
      .select("created_at")
      .eq("user_id", userId)
      .eq("program_id", st.program.id)
      .eq("week_started_on", st.weekStartedOn),
  ]);

  // Mon → Sun strip: a day with a logged session is done; the day a skip was
  // tapped shows skipped; days before the week began or still ahead are faint.
  const doneDates = new Set<string>();
  const weekSets: SetRow[] = [];
  for (const s of Array.from(ctx.sessions.values())) {
    if (Date.parse(s.at) < Date.parse(st.weekStartISO)) continue;
    doneDates.add(localDate(ctx.tz, new Date(s.at)));
    weekSets.push(...(ctx.setsBySession.get(s.id) ?? []));
  }
  const skipDates = new Set<string>();
  for (const k of skips ?? []) if (k.created_at) skipDates.add(localDate(ctx.tz, new Date(k.created_at as string)));
  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const strip = letters.map((letter, i) => {
    const d = addDays(monday, i);
    let state: StripState = "open";
    if (doneDates.has(d)) state = "done";
    else if (skipDates.has(d)) state = "skipped";
    else if (d < st.weekStartedOn || d > today) state = "later";
    return { letter, state };
  });

  const stats: ShareStat[] = [];
  // Protein: average over the local days that have food logged with protein.
  const byDay = new Map<string, number>();
  for (const f of food ?? []) {
    const p = num(f.protein_g);
    if (p == null) continue;
    const d = localDate(ctx.tz, new Date(f.logged_at as string));
    byDay.set(d, (byDay.get(d) ?? 0) + p);
  }
  if (byDay.size) {
    const avg = Array.from(byDay.values()).reduce((a, b) => a + b, 0) / byDay.size;
    stats.push({ label: "PROTEIN AVG", value: fmtInt(avg), unit: "g" });
  }
  const vol = volumeStat(volumeOf(weekSets));
  if (vol) stats.push(vol);
  const prSets: PrSet[] = ctx.sets.map((s) => ({
    exercise_id: s.exId,
    load_value: s.load,
    load_type: s.type,
    reps: s.reps,
    at: s.at,
    is_pr: s.isPr,
  }));
  const prCount = countPRs(prSets, st.weekStartISO);
  if (prCount > 0) stats.push({ label: "PRS", value: String(prCount), tone: "pr" });
  const mins = (sleep ?? []).map((r) => num(r.duration_min)).filter((m): m is number => m != null && m > 0);
  if (mins.length) {
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    stats.push({ label: "AVG SLEEP", value: `${Math.floor(avg / 60)}h${String(avg % 60).padStart(2, "0")}` });
  }

  let bodyWeight: string | null = null;
  const kg = num(weights?.[0]?.kg);
  if (kg != null && kg > 0)
    bodyWeight = ctx.weightUnit === "lbs" ? `${kgToLbs(kg).toFixed(1)} lbs` : `${(Math.round(kg * 10) / 10).toFixed(1)} kg`;

  const m = dateParts(monday);
  const s = dateParts(sunday);
  const rangeLabel = m.mon === s.mon ? `${m.day} – ${s.day} ${s.mon}` : `${m.day} ${m.mon} – ${s.day} ${s.mon}`;

  const summary =
    st.plannedCount === 0
      ? "No training days this week."
      : st.doneCount >= st.plannedCount
        ? "Every session done."
        : st.skippedCount
          ? `${st.doneCount} done · ${st.skippedCount} skipped.`
          : `${st.doneCount} of ${st.plannedCount} sessions done.`;

  return {
    week: st.week,
    rangeLabel,
    done: st.doneCount,
    planned: st.plannedCount,
    summary,
    strip,
    stats,
    // Approved progression changes aren't stored per item yet (a proposal is
    // only marked approved as a whole), so they're left off rather than guessed.
    changes: [],
    bodyWeight,
  };
}

// ── Bundles handed to the share sheet ───────────────────────────────────────

export function sessionShare(ctx: ShareContext, sessionId: string): ShareBundle | null {
  const sess = ctx.sessions.get(sessionId);
  if (!sess) return null;
  const { card, prs } = sessionCard(ctx, sess);
  const pr = (prs.length ? prCard(ctx, prs[0]) : null) ?? (inCurrentWeek(ctx, sess.at) ? ctx.weekPr : null);
  return { session: card, week: ctx.week, pr };
}

export function weekShare(ctx: ShareContext): ShareBundle | null {
  if (!ctx.week) return null;
  return { session: null, week: ctx.week, pr: ctx.weekPr };
}
