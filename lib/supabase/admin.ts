import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client. BYPASSES RLS — server-only, used ONLY by the
// photo-cleanup cron (app/api/cron/photo-cleanup). Never import from client
// code or from anything a user request can steer.
//
// Env (server-only, never NEXT_PUBLIC_):
//   SUPABASE_URL              — project URL (falls back to NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY — the secret key (sb_secret_* or legacy service_role)
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this environment");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
