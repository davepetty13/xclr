import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TZ, todayLocal } from "@/lib/time";
import { LIMITS, parseSyncBody, readHealthFields } from "@/lib/health";

// Apple Health / Health Connect sync. An iPhone Shortcut (or any Android app
// that can send a web request) POSTs JSON here with
// `Authorization: Bearer <sync token>`. Safe to call many times a day: days
// upsert by date, workouts dedupe by id (or start time + kind).
//
// Public path (see middleware.ts): no session cookie, the token is the auth.
// Only the token's SHA-256 hash is stored. Never log the token or any value.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const SMALL_BODY = 4 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Read the body with a running byte cap, so a huge or endless upload stops at
// LIMITS.bodyBytes instead of being buffered first.
async function readCapped(request: Request, cap: number): Promise<string | "too_big"> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return "too_big";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  // Tolerate a key pasted with its own "Bearer " (→ "Bearer Bearer …") or spaces.
  const token = /^bearer\s/i.test(header) ? header.replace(/^(bearer\s+)+/i, "").trim() : "";
  if (!TOKEN_RE.test(token)) return json(401, { ok: false, error: "Missing or bad sync link." });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.bodyBytes) return json(413, { ok: false, error: "Too much data in one sync." });
  let raw: string;
  try {
    const r = await readCapped(request, LIMITS.bodyBytes);
    if (r === "too_big") return json(413, { ok: false, error: "Too much data in one sync." });
    raw = r;
  } catch {
    return json(400, { ok: false, error: "Couldn't read the request." });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return json(503, { ok: false, error: "Sync isn't set up on the server yet." });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: tok } = await admin
    .from("health_sync_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!tok) return json(401, { ok: false, error: "This sync link isn't valid any more. Make a new one in Xclr." });
  const userId = tok.user_id as string;

  const { data: profile } = await admin
    .from("profiles")
    .select("timezone, health_sync_fields")
    .eq("id", userId)
    .maybeSingle();
  const tz = (profile?.timezone as string | null) ?? DEFAULT_TZ;
  const today = todayLocal(tz);
  const fields = readHealthFields(profile?.health_sync_fields);

  // Rate limit per link, claimed in ONE conditional update (two syncs at the
  // same moment can't both pass): small one-day syncs every 10 s at most,
  // bigger back-fills once a minute.
  const gapSeconds = Buffer.byteLength(raw, "utf8") <= SMALL_BODY ? 10 : 60;
  const { data: claimed, error: claimErr } = await admin.rpc("claim_health_sync", {
    p_token_hash: tokenHash,
    p_gap_seconds: gapSeconds,
    p_today: today,
  });
  if (claimErr) return json(503, { ok: false, error: "Sync isn't set up on the server yet." });
  const claim = (Array.isArray(claimed) ? claimed[0] : claimed) as { out_user_id?: string; out_sync_count?: number } | null;
  if (!claim || claim.out_user_id !== userId)
    return json(429, { ok: false, error: "Synced a moment ago. Try again in a minute." });
  const count = Number(claim.out_sync_count) || 1;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "The body must be JSON." });
  }

  const parsed = parseSyncBody(body, today);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
  const { source, days, workouts } = parsed.payload;
  const now = new Date().toISOString();

  // Days: one upsert per date with only the fields sent AND switched on, so a
  // partial sync never blanks a number an earlier sync saved.
  let daysSaved = 0;
  for (const d of days) {
    const row: Record<string, unknown> = { user_id: userId, local_date: d.date, source, updated_at: now };
    if (fields.steps && d.steps !== undefined) row.steps = d.steps;
    if (fields.active && d.active_kcal !== undefined) row.active_kcal = d.active_kcal;
    if (fields.resting_hr && d.resting_hr !== undefined) row.resting_hr = d.resting_hr;
    if (fields.sleep && d.sleep_minutes !== undefined) row.sleep_minutes = d.sleep_minutes;
    if (fields.weight && d.weight_kg !== undefined) row.weight_kg = d.weight_kg;
    if (Object.keys(row).length <= 4) continue; // nothing accepted for this day
    const { error } = await admin.from("health_daily").upsert(row, { onConflict: "user_id,local_date" });
    if (error) return json(500, { ok: false, error: "Couldn't save that day. Try again." });
    daysSaved++;

    // Weight also goes into the weight log, without doubling up: add it when the
    // day has no weigh-in, update it only if the day's entry came from a sync.
    if (fields.weight && d.weight_kg !== undefined) {
      const { data: w } = await admin
        .from("weights")
        .select("id, kg, source")
        .eq("user_id", userId)
        .eq("measured_on", d.date)
        .maybeSingle();
      if (!w) {
        await admin
          .from("weights")
          .insert({ user_id: userId, measured_on: d.date, kg: d.weight_kg, source });
      } else if (
        (w.source === "apple_health" || w.source === "health_connect" || w.source === "other") &&
        Math.abs(Number(w.kg) - d.weight_kg) >= 0.01
      ) {
        await admin.from("weights").update({ kg: d.weight_kg, source }).eq("id", w.id).eq("user_id", userId);
      }
    }
  }

  let workoutsSaved = 0;
  if (fields.workouts && workouts.length) {
    const rows = workouts.map((w) => ({ user_id: userId, source, ...w }));
    const { error } = await admin.from("health_workouts").upsert(rows, { onConflict: "user_id,external_id" });
    if (error) return json(500, { ok: false, error: "Couldn't save the workouts. Try again." });
    workoutsSaved = rows.length;
  }

  const saved = days[0]
    ? Object.keys(days[0]).filter((k) => k !== "date" && (days[0] as Record<string, unknown>)[k] !== undefined)
    : [];
  return json(200, {
    ok: true,
    days: daysSaved,
    workouts: workoutsSaved,
    syncs_today: count,
    ...(parsed.payload.received ? { received: parsed.payload.received, saved } : {}),
  });
}

export function GET() {
  return json(405, { ok: false, error: "Send a POST with JSON." });
}
