import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client. BYPASSES RLS — server-only, used ONLY by:
//   - the crons (app/api/cron/photo-cleanup, app/api/cron/notify)
//   - the health sync endpoint (app/api/health/sync), after it has matched
//     the sync-link token to exactly one user
//   - saving a push subscription (one device endpoint can only belong to one
//     user), always scoped to the signed-in user's id
// Never import from client code, and always filter by a user id you verified.
//
// Env (server-only, never NEXT_PUBLIC_):
//   SUPABASE_URL              — project URL (falls back to NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY — the secret key (sb_secret_* or legacy service_role)
export function createAdminClient(): SupabaseClient {
  const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Accept the project URL with or without a trailing "/rest/v1" or slash —
  // the client adds "/rest/v1" itself, so a doubled path returns 404.
  const url = raw?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this environment");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
