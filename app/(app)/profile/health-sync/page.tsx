import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_TZ, localDate, todayLocal } from "@/lib/time";
import { readHealthFields, readShareWithCoach } from "@/lib/health";
import { HealthSyncPanel } from "@/components/app/health-sync-panel";

function clock(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

export default async function HealthSyncPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, health_sync_fields")
    .eq("id", user.id)
    .maybeSingle();
  const tz = (profile?.timezone as string | null) ?? DEFAULT_TZ;
  const today = todayLocal(tz);

  const [{ data: tok }, { data: day }] = await Promise.all([
    supabase
      .from("health_sync_tokens")
      .select("created_at, last_used_at, sync_day, sync_count_today")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("health_daily")
      .select("source")
      .eq("user_id", user.id)
      .eq("local_date", today)
      .maybeSingle(),
  ]);

  // From config, never from request headers (a forged Host can't change the
  // link the user copies into their shortcut).
  const origin = (process.env.APP_URL || "https://xclr.vercel.app").replace(/\/+$/, "");
  const endpoint = `${origin}/api/health/sync`;

  const lastSync = tok?.last_used_at ? (tok.last_used_at as string) : null;
  const syncsToday = tok?.sync_day === today ? Number(tok.sync_count_today) || 0 : 0;
  const lastLabel = lastSync
    ? localDate(tz, new Date(lastSync)) === today
      ? clock(lastSync, tz)
      : new Date(lastSync).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })
    : "Never";
  const from = day?.source === "health_connect" ? "Android" : day?.source === "other" ? "Other app" : day ? "Watch" : null;

  const band: { label: string; value: string; suffix?: string }[] = [
    { label: "Last sync", value: lastLabel },
    { label: "Syncs today", value: String(syncsToday), suffix: " of 3" },
    { label: "From", value: from ?? "—" },
  ];

  // Local minute of day, for ticking off sync times that have passed.
  const nowMin = (() => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date())
      .split(":")
      .map(Number);
    return p[0] * 60 + p[1];
  })();

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
          <h1 className="font-display text-[21px] font-bold tracking-[-0.02em] text-ink">Watch &amp; phone sync</h1>
          <p className="text-xs text-muted">Apple Watch, Garmin and more · free</p>
        </div>
      </div>

      <dl aria-label="Sync status" className="band grid grid-cols-3">
        {band.map((s, i) => (
          <div key={s.label} className={`px-3.5 py-3 ${i === 0 ? "shadow-[inset_3px_0_0_var(--green)]" : "border-l border-band-hairline"}`}>
            <dt className="text-[11px] text-band-label">{s.label}</dt>
            <dd className="tnum font-display text-[17px] font-bold">
              {s.value}
              {s.suffix ? <span className="text-[11px] text-band-secondary">{s.suffix}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      <HealthSyncPanel
        endpoint={endpoint}
        hasLink={!!tok}
        fields={readHealthFields(profile?.health_sync_fields)}
        shareWithCoach={readShareWithCoach(profile?.health_sync_fields)}
        syncsToday={syncsToday}
        nowMin={nowMin}
      />
    </main>
  );
}
