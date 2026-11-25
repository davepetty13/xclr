import { createClient } from "@/lib/supabase/server";
import { getUserTz } from "@/lib/goal-change";
import { addDays, localDayStartISO, todayLocal } from "@/lib/time";

type Supa = ReturnType<typeof createClient>;

// Display order + names + bar colour per ai_usage.label. Token classes only.
const KINDS = [
  { label: "program", name: "Program build · Sonnet", bar: "bg-ember" },
  { label: "review", name: "Week reviews · Sonnet", bar: "bg-violet" },
  { label: "coach", name: "Coach answers · Haiku", bar: "bg-green" },
  { label: "parse", name: "Quick parses · Haiku", bar: "bg-amber" },
  { label: "vision", name: "Photo reads · Haiku", bar: "bg-ink" },
] as const;
const OTHER = { label: "other", name: "Other", bar: "bg-muted" } as const;

function nextMonthStart(monthStart: string): string {
  // monthStart is YYYY-MM-01; jump past the month then snap back to day 1.
  const d = addDays(monthStart, 32);
  return `${d.slice(0, 8)}01`;
}

function money(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

// Server-rendered: what AI cost this month (user's local calendar month) and
// how often food logs were matched from the free personal library.
export async function AiUsageCard({ supabase, userId }: { supabase: Supa; userId: string }) {
  const tz = await getUserTz(supabase, userId);
  const monthStart = `${todayLocal(tz).slice(0, 8)}01`;
  const start = localDayStartISO(monthStart, tz);
  const end = localDayStartISO(nextMonthStart(monthStart), tz);
  const monthName = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

  const [{ data: usage }, { count: foodTotal }, { count: foodLibrary }] = await Promise.all([
    supabase
      .from("ai_usage")
      .select("label, cost_usd")
      .eq("user_id", userId)
      .gte("created_at", start)
      .lt("created_at", end),
    supabase
      .from("food_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("logged_at", start)
      .lt("logged_at", end),
    supabase
      .from("food_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "library")
      .gte("logged_at", start)
      .lt("logged_at", end),
  ]);

  const rows = usage ?? [];
  const byLabel = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    const known = KINDS.some((k) => k.label === r.label);
    const key = known ? (r.label as string) : OTHER.label;
    byLabel.set(key, (byLabel.get(key) ?? 0) + cost);
    total += cost;
  }
  const parts = [...KINDS, OTHER]
    .map((k) => ({ ...k, cost: byLabel.get(k.label) ?? 0 }))
    .filter((k) => k.cost > 0);

  const libShare =
    foodTotal && foodTotal > 0 ? Math.round(((foodLibrary ?? 0) / foodTotal) * 10) : null;

  return (
    <section className="glass flex flex-col gap-2.5 px-4 py-3.5" aria-labelledby="ai-usage-h">
      <h2 id="ai-usage-h" className="text-sm font-bold text-ink">
        AI usage · {monthName}
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm font-medium text-muted">
          No AI calls yet this month. Costs show up here once you chat, log food, or build a program.
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="tnum font-display text-[30px] font-bold leading-none tracking-[-0.03em] text-ink">
              {money(total)}
            </span>
            <span className="text-xs text-muted">est. this month</span>
          </p>
          {total > 0 ? (
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-line"
              role="img"
              aria-label={parts.map((p) => `${p.name} ${money(p.cost)}`).join(", ")}
            >
              {parts.map((p) => (
                <span key={p.label} className={`h-full ${p.bar}`} style={{ width: `${(p.cost / total) * 100}%` }} />
              ))}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-ink">
                  <span aria-hidden className={`h-2 w-2 rounded-sm ${p.bar}`} />
                  {p.name}
                </span>
                <span className="tnum font-semibold text-muted">{money(p.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {libShare != null ? (
        <p className="text-xs font-semibold text-green">
          {libShare} in 10 food logs matched your library — free.
        </p>
      ) : null}
    </section>
  );
}
