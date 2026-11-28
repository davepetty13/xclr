import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runNotify } from "@/lib/notify-rules";

// Reminder job. Supabase pg_cron + pg_net calls this every 15 minutes (POST;
// see docs/notify-cron.sql) with `Authorization: Bearer ${CRON_SECRET}`.
// GET works too, for a manual run. Idempotent: each reminder has a
// dedupe_key, so a repeat run never sends twice. No AI calls.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  // Hash both sides so the compare is constant-time regardless of length.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runNotify(createAdminClient());
    console.info(`[cron:notify] users=${r.users} created=${r.created} pushed=${r.pushed} failed=${r.failed}`);
    return NextResponse.json(r, { status: r.failed ? 500 : 200 });
  } catch (err) {
    console.error(`[cron:notify] ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "notify failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
