import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

// Tables exported with a plain user_id filter (RLS-scoped client on top).
const USER_TABLES = [
  "food_logs",
  "food_library",
  "weights",
  "sleep_logs",
  "programs",
  "program_days",
  "program_exercises",
  "exercises",
  "workout_sessions",
  "set_logs",
  "messages",
  "ai_usage",
  "pending_changes",
] as const;

// Added in migration 008. Skipped (not fatal) if that migration hasn't run.
const OPTIONAL_TABLES = ["health_daily", "health_workouts", "notification_prefs", "notifications"] as const;

// GET /profile/export — the signed-in user's own rows as a JSON download.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: "Couldn't read your profile" }, { status: 500 });

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    profile,
  };

  const results = await Promise.all(
    USER_TABLES.map((t) => supabase.from(t).select("*").eq("user_id", user.id).limit(50000))
  );
  for (let i = 0; i < USER_TABLES.length; i++) {
    const r = results[i];
    if (r.error) {
      console.error(`[export] ${USER_TABLES[i]}: ${r.error.message}`);
      return NextResponse.json({ error: "Couldn't build your export. Try again." }, { status: 500 });
    }
    out[USER_TABLES[i]] = r.data ?? [];
  }

  const optional = await Promise.all(
    OPTIONAL_TABLES.map((t) => supabase.from(t).select("*").eq("user_id", user.id).limit(50000))
  );
  OPTIONAL_TABLES.forEach((t, i) => {
    if (!optional[i].error) out[t] = optional[i].data ?? [];
  });

  // Health notes only when consent is on.
  if (profile?.health_data_consent_at) {
    const { data: med, error: mErr } = await supabase
      .from("medical_conditions")
      .select("*")
      .eq("user_id", user.id);
    if (mErr) return NextResponse.json({ error: "Couldn't build your export. Try again." }, { status: 500 });
    out.medical_conditions = med ?? [];
  }

  const tz = (profile?.timezone as string | null) ?? null;
  const filename = `xclr-export-${todayLocal(tz)}.json`;
  return new NextResponse(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
