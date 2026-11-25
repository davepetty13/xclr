import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAllExpired, deleteOrphanUploads } from "@/lib/photos";

// Layer (c) of photo deletion: Vercel Cron calls this (see vercel.json) with
// `Authorization: Bearer ${CRON_SECRET}`. Deletes every user's photos past
// their 48-hour expiry (storage + deleted_at), 100 at a time.
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

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const r = await deleteAllExpired(admin);
    const orphans = await deleteOrphanUploads(admin);
    console.info(
      `[cron:photo-cleanup] deleted=${r.deleted} orphans=${orphans} batches=${r.batches} failed=${r.failed}`
    );
    return NextResponse.json({ ...r, orphans }, { status: r.failed ? 500 : 200 });
  } catch (err) {
    console.error(
      `[cron:photo-cleanup] ${err instanceof Error ? err.message : String(err)}`
    );
    return NextResponse.json({ error: "cleanup failed" }, { status: 500 });
  }
}
