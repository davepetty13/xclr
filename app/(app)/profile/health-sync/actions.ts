"use server";

import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { HEALTH_FIELDS, readHealthFields, type HealthFields } from "@/lib/health";

export type LinkResult = { ok: true; token: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = { ok: false as const, error: "You're signed out — please sign in again." };

// Makes a new private sync link (32 random bytes). The token is returned ONCE
// for the copy box; only its SHA-256 hash is saved. Any older link stops
// working at the same moment (one link per user).
export async function makeSyncLink(): Promise<LinkResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SIGNED_OUT;

  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.from("health_sync_tokens").upsert(
    {
      user_id: user.id,
      token_hash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      sync_day: null,
      sync_count_today: 0,
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: "Couldn't make a link. Try again." };
  return { ok: true, token };
}

export async function saveHealthFields(input: Partial<HealthFields>): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SIGNED_OUT;

  const clean: Record<string, boolean> = {};
  const base = readHealthFields(input);
  for (const k of HEALTH_FIELDS) clean[k] = base[k];
  const { error } = await supabase.from("profiles").update({ health_sync_fields: clean }).eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}
