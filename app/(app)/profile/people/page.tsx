import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_AI_LIMIT_USD, LIMIT_OPTIONS, MAX_MEMBERS, getCurrentAccess } from "@/lib/access";
import { getUserTz } from "@/lib/goal-change";
import { createClient } from "@/lib/supabase/server";
import { localDate, localDayStartISO } from "@/lib/time";
import { PeopleAdmin, type PersonRow } from "@/components/app/people-admin";

export const metadata = { title: "People · Xclr" };

const STATUS_ORDER: Record<string, number> = { owner: 0, active: 1, invited: 2, paused: 3 };

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Owner only: the invite list, each person's AI cost this month, and
// limit / pause / remove. Everyone else gets a 404.
export default async function PeoplePage() {
  const user = await getCurrentUser();
  const access = await getCurrentAccess().catch(() => null);
  if (!user || access?.role !== "owner") notFound();

  const admin = createAdminClient();
  const tz = await getUserTz(createClient(), user.id);
  const monthStart = localDayStartISO(`${localDate(tz).slice(0, 7)}-01`, tz);

  const { data: members, error } = await admin
    .from("app_members")
    .select("email, user_id, role, status, ai_limit_usd, invited_at")
    .order("invited_at", { ascending: true });
  if (error) console.error(`[people] list failed: ${error.message}`);

  const ids = (members ?? []).map((m) => m.user_id as string | null).filter((x): x is string => !!x);
  const [{ data: profiles }, { data: usage }] = await Promise.all([
    ids.length
      ? admin.from("profiles").select("id, display_name").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    ids.length
      ? admin.from("ai_usage").select("user_id, cost_usd").in("user_id", ids).gte("created_at", monthStart)
      : Promise.resolve({ data: [] as { user_id: string; cost_usd: number }[] }),
  ]);

  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) if (p.display_name) nameById.set(p.id as string, String(p.display_name));
  const spendById = new Map<string, number>();
  for (const u of usage ?? []) {
    const id = u.user_id as string;
    spendById.set(id, (spendById.get(id) ?? 0) + (Number(u.cost_usd) || 0));
  }

  const rows: PersonRow[] = (members ?? [])
    .map((m) => {
      const email = m.email as string;
      const uid = (m.user_id as string | null) ?? null;
      const full = uid ? nameById.get(uid) : undefined;
      const status = m.role === "owner" ? "owner" : ((m.status as string) ?? "invited");
      return {
        email,
        name: full ? full.split(" ")[0] || full : email.split("@")[0],
        status: status as PersonRow["status"],
        isYou: uid === user.id,
        spend: uid ? spendById.get(uid) ?? 0 : null,
        limit: Number(m.ai_limit_usd) || 0,
      };
    })
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  const total = Array.from(spendById.values()).reduce((s, n) => s + n, 0);
  const band: { label: string; value: string; suffix?: string }[] = [
    { label: "People", value: String(rows.length), suffix: ` / ${MAX_MEMBERS}` },
    { label: "AI this month", value: money(total) },
    { label: "Limit each", value: `$${DEFAULT_AI_LIMIT_USD.toFixed(2)}` },
  ];

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3.5">
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          aria-label="Back to You"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-card text-ink shadow-card"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <div>
          <h1 className="font-display text-[21px] font-bold tracking-[-0.02em] text-ink">People</h1>
          <p className="text-xs text-muted">Only you see this page</p>
        </div>
      </div>

      <dl aria-label="People summary" className="band grid grid-cols-3">
        {band.map((s, i) => (
          <div key={s.label} className={`px-3.5 py-3 ${i === 0 ? "shadow-[inset_3px_0_0_var(--green)]" : "border-l border-band-hairline"}`}>
            <dt className="text-[11px] text-band-label">{s.label}</dt>
            <dd className="tnum font-display text-[19px] font-bold">
              {s.value}
              {s.suffix ? <span className="text-xs text-band-secondary">{s.suffix}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      <PeopleAdmin rows={rows} limitOptions={[...LIMIT_OPTIONS]} defaultLimit={DEFAULT_AI_LIMIT_USD} full={rows.length >= MAX_MEMBERS} />
    </main>
  );
}
