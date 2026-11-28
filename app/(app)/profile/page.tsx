import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { kgToLbs } from "@/lib/units";
import { DEFAULT_TZ, localDate, prettyDate } from "@/lib/time";
import { ProfileBodyForm } from "@/components/app/profile-body-form";
import { ProfileTrainingForm } from "@/components/app/profile-training-form";
import { ProfileSettingsForm } from "@/components/app/profile-settings-form";
import { ProfileHealth, type HealthItem } from "@/components/app/profile-health";
import { getCurrentUser } from "@/lib/session";
import { getCurrentAccess } from "@/lib/access";
import { OWNER_USER_ID } from "@/lib/owner";
import { DeleteMyData } from "@/components/app/delete-my-data";

const SOURCE_LABEL: Record<string, string> = {
  chat: "Added from chat",
  photo: "Added from a photo",
  manual: "Added by you",
};

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// "You" — everything from onboarding, editable. BMI is never shown here.
export default async function ProfilePage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ data: p }, { data: latest }, access] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, height_cm, sex, birthdate, weight_unit, timezone, sports, training_days_per_week, session_minutes, preferred_days, preferred_time, training_experience, equipment_access, training_notes, health_data_consent_at"
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("weights")
      .select("kg")
      .eq("user_id", user.id)
      .order("measured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getCurrentAccess().catch(() => null),
  ]);
  const owner = access?.role === "owner";
  // Delete card: never for the owner (by id or row), and never when the access
  // lookup failed (getCurrentAccess throws → null) — fail closed.
  const canDelete = !!access && !owner && user.id !== OWNER_USER_ID;

  const tz = (p?.timezone as string | null) ?? DEFAULT_TZ;
  const unit: "kg" | "lbs" = p?.weight_unit === "lbs" ? "lbs" : "kg";
  const consentOn = p?.health_data_consent_at != null;

  // Medical data is read ONLY when consent is on.
  let items: HealthItem[] = [];
  if (consentOn) {
    const { data: conds } = await supabase
      .from("medical_conditions")
      .select("id, condition, notes, source, created_at")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: true });
    items = (conds ?? []).map((c) => {
      const src = SOURCE_LABEL[(c.source as string | null) ?? "manual"] ?? SOURCE_LABEL.manual;
      const when = c.created_at ? prettyDate(localDate(tz, new Date(c.created_at as string))) : null;
      return {
        id: c.id as string,
        condition: c.condition as string,
        notes: (c.notes as string | null) ?? null,
        sourceLine: when ? `${src} · ${when}` : src,
      };
    });
  }

  const heightCm = p?.height_cm != null ? Number(p.height_cm) : null;
  const weightKg = latest?.kg != null ? Number(latest.kg) : null;
  const days = Number(p?.training_days_per_week) || 4;

  const weightNum = weightKg == null ? "—" : unit === "lbs" ? kgToLbs(weightKg).toFixed(1) : weightKg.toFixed(2);
  const summary: { label: string; value: string; suffix?: string }[] = [
    { label: "Height", value: heightCm != null ? `${Math.round(heightCm)}` : "—", suffix: heightCm != null ? " cm" : undefined },
    { label: "Weight", value: weightNum, suffix: weightKg != null ? ` ${unit}` : undefined },
    { label: "Trains", value: `${days}`, suffix: " × / wk" },
  ];

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3.5">
      <Link
        href="/goals"
        className="inline-flex min-h-[44px] items-center self-start px-1 text-[13px] font-semibold text-muted"
      >
        ← Goals
      </Link>
      <header className="-mt-2 px-1">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">You</h1>
        <p className="mt-0.5 text-xs text-muted">Everything from signup. Change anything, then save that section.</p>
      </header>

      {/* The one top band */}
      <dl aria-label="Body" className="band grid grid-cols-3">
        {summary.map((s, i) => (
          <div key={s.label} className={`px-3.5 py-3 ${i === 0 ? "band-edge" : "border-l border-band-hairline"}`}>
            <dt className="text-[11px] text-band-label">{s.label}</dt>
            <dd className="tnum font-display text-[19px] font-bold">
              {s.value}
              {s.suffix ? <span className="text-xs text-band-secondary">{s.suffix}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="-mt-1 px-1 text-xs text-muted">Log a new weight in chat or on Today.</p>

      <ProfileBodyForm
        initial={{
          display_name: (p?.display_name as string | null) ?? "",
          height_cm: heightCm,
          sex: (p?.sex as string | null) ?? null,
          birthdate: (p?.birthdate as string | null) ?? null,
        }}
      />

      <ProfileTrainingForm
        initial={{
          training_days_per_week: days,
          session_minutes: Number(p?.session_minutes) || 60,
          preferred_days: strList(p?.preferred_days),
          preferred_time: (p?.preferred_time as string | null) ?? null,
          sports: strList(p?.sports),
          training_experience: (p?.training_experience as string | null) ?? "intermediate",
          equipment_access: (p?.equipment_access as string | null) ?? "commercial_gym",
          training_notes: (p?.training_notes as string | null) ?? "",
        }}
      />

      <ProfileHealth consentOn={consentOn} items={items} />

      <ProfileSettingsForm initial={{ weight_unit: unit, timezone: tz }} />

      <section aria-labelledby="phone-h" className="flex flex-col gap-2">
        <h2 id="phone-h" className="px-1 pt-1 text-xs font-bold text-muted">
          Phone &amp; Watch
        </h2>
        <div className="glass px-4 py-0.5">
          {[
            { href: "/profile/health-sync", title: "Watch & phone sync", hint: "Apple Health or Android · steps, burn, sleep" },
            { href: "/profile/notifications", title: "Notifications", hint: "Reminders on this iPhone and in the bell" },
          ].map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex min-h-[56px] items-center justify-between gap-3 py-2 text-ink ${i === 0 ? "border-b border-hairline" : ""}`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{l.title}</span>
                <span className="block text-xs text-muted">{l.hint}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          ))}
        </div>
      </section>

      {owner ? (
        <section aria-labelledby="people-h" className="flex flex-col gap-2">
          <h2 id="people-h" className="px-1 pt-1 text-xs font-bold text-muted">
            Friends on Xclr
          </h2>
          <Link href="/profile/people" className="glass flex min-h-[56px] items-center justify-between gap-3 px-4 py-2 text-ink">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">People</span>
              <span className="block text-xs text-muted">Invite friends, see AI cost, pause or remove</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="your-data-h" className="flex flex-col gap-2">
        <h2 id="your-data-h" className="px-1 pt-1 text-xs font-bold text-muted">
          Your data
        </h2>
        <div className="glass flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px] text-muted">A JSON file with everything you&apos;ve logged in Xclr.</p>
          <a href="/profile/export" download className="btn-secondary shrink-0 px-3 text-[13px]">
            Download my data
          </a>
        </div>
        {canDelete ? <DeleteMyData /> : null}
      </section>
    </main>
  );
}
