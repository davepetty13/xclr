"use server";

import { createClient } from "@/lib/supabase/server";
import { loadShareContext, sessionShare } from "@/lib/share-data";
import type { ShareBundle } from "@/lib/share-cards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Share-card numbers for one of the caller's own sessions (right after
// "Session logged"). Reads only; nothing is written, nothing leaves the app.
export async function getSessionShare(
  sessionId: string
): Promise<{ ok: true; bundle: ShareBundle } | { ok: false; error: string }> {
  if (typeof sessionId !== "string" || !UUID.test(sessionId))
    return { ok: false, error: "That session isn't available." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const ctx = await loadShareContext(supabase, user.id);
  const bundle = sessionShare(ctx, sessionId);
  if (!bundle) return { ok: false, error: "That session isn't available." };
  return { ok: true, bundle };
}
