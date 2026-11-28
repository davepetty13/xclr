"use server";

import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HEALTH_FIELDS, readHealthFields, readShareWithCoach, type HealthFields } from "@/lib/health";

export type LinkResult = { ok: true; token: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = { ok: false as const, error: "You're signed out — please sign in again." };

async function me() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

// The stored settings object: the receive switches + share_with_coach.
async function readStored(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data } = await supabase.from("profiles").select("health_sync_fields").eq("id", userId).maybeSingle();
  const raw = data?.health_sync_fields as unknown;
  const hasShare =
    !!raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).share_with_coach === "boolean";
  return { fields: readHealthFields(raw), share: readShareWithCoach(raw), hasShare };
}

function toStored(fields: HealthFields, share: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of HEALTH_FIELDS) out[k] = fields[k];
  out.share_with_coach = share;
  return out;
}

// Makes a new private sync link (32 random bytes). The token is returned ONCE
// for the copy box; only its SHA-256 hash is saved. Any older link stops
// working at the same moment (one link per user). The link row is written
// with the service role (the owner can only see or delete it), always for the
// signed-in id.
export async function makeSyncLink(): Promise<LinkResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Sync isn't set up on the server yet." };
  }

  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const { error } = await admin.from("health_sync_tokens").upsert(
    {
      user_id: s.userId,
      token_hash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      sync_day: null,
      sync_count_today: 0,
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: "Couldn't make a link. Try again." };

  // First link: "Share with my coach" starts on (the user can switch it off).
  const stored = await readStored(s.supabase, s.userId);
  if (!stored.hasShare) {
    await s.supabase
      .from("profiles")
      .update({ health_sync_fields: toStored(stored.fields, true) })
      .eq("id", s.userId);
  }
  return { ok: true, token };
}

// "Turn off sync": deletes the link, so the shortcut stops working at once.
// Numbers already synced stay where they are.
export async function turnOffSync(): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  const { error } = await s.supabase.from("health_sync_tokens").delete().eq("user_id", s.userId);
  if (error) return { ok: false, error: "Couldn't turn sync off. Try again." };
  return { ok: true };
}

export async function saveHealthFields(input: Partial<HealthFields>): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  const stored = await readStored(s.supabase, s.userId);
  const { error } = await s.supabase
    .from("profiles")
    .update({ health_sync_fields: toStored(readHealthFields(input), stored.share) })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

export async function saveShareWithCoach(on: boolean): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  if (typeof on !== "boolean") return { ok: false, error: "Couldn't save. Try again." };
  const stored = await readStored(s.supabase, s.userId);
  const { error } = await s.supabase
    .from("profiles")
    .update({ health_sync_fields: toStored(stored.fields, on) })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}
