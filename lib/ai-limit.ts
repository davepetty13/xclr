import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserTz } from "@/lib/goal-change";
import { localDate, localDayStartISO } from "@/lib/time";

// Monthly AI limit per person (app_members.ai_limit_usd, default $1.50).
// The owner has no limit. Spend = sum of ai_usage.cost_usd since the 1st of
// the current month in the user's own time zone. Only user-triggered AI calls
// (they pass `track` to createMessage) are checked — library-first logging,
// quick logs and Watch sync never call the AI and keep working.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

// "2026-11" → first of this month / next month, as local dates.
function monthBounds(tz: string): { first: string; next: string } {
  const today = localDate(tz);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${y}-${pad(m)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { first, next };
}

// "Dec 1" — when questions and photo reads come back.
export function resetLabel(tz: string): string {
  const { next } = monthBounds(tz);
  return new Date(`${next}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function limitMessage(tz: string): string {
  return `This month's coach limit is used up. You can still log food, workouts and Watch data — saved meals and quick logs don't use the coach. Questions and photo reads come back on ${resetLabel(tz)}, or ask Dave to raise your limit.`;
}

export async function getMonthSpend(supabase: Supa, userId: string, tz: string): Promise<number> {
  const since = localDayStartISO(monthBounds(tz).first, tz);
  const { data, error } = await supabase
    .from("ai_usage")
    .select("cost_usd")
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw new Error(`ai_usage read failed: ${error.message}`);
  return (data ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
}

export type CoachUse = {
  owner: boolean;
  limit: number;
  spend: number;
  pct: number; // 0–100+, of the limit
  limited: boolean;
  resetLabel: string;
  message: string;
};

// The signed-in user's own member row is readable through RLS (migration 010).
// No row → no AI (fail closed: a stranger can never spend).
export async function getCoachUse(supabase: Supa, userId: string, tzIn?: string): Promise<CoachUse> {
  const tz = tzIn ?? (await getUserTz(supabase, userId));
  const { data: rows, error } = await supabase
    .from("app_members")
    .select("role, status, ai_limit_usd")
    .eq("user_id", userId)
    .limit(1);
  if (error) console.error(`[ai-limit] member read failed: ${error.message}`);
  const row = rows?.[0];
  const owner = row?.role === "owner";
  const base = { resetLabel: resetLabel(tz), message: limitMessage(tz) };
  if (owner) return { owner, limit: 0, spend: 0, pct: 0, limited: false, ...base };
  const limit = row && row.status === "active" ? Number(row.ai_limit_usd) || 0 : 0;
  let spend = 0;
  try {
    spend = await getMonthSpend(supabase, userId, tz);
  } catch (e) {
    console.error(`[ai-limit] ${e instanceof Error ? e.message : String(e)}`);
    // Can't tell what's been spent → don't spend more.
    return { owner, limit, spend: limit, pct: 100, limited: true, ...base };
  }
  const pct = limit > 0 ? Math.round((spend / limit) * 100) : 100;
  return { owner, limit, spend, pct, limited: spend >= limit, ...base };
}
