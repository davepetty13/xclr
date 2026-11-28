"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quickAddFromLibrary } from "@/app/(app)/food/actions";
import { BOOL_KEYS, QUIET_OPTIONS, TIME_KEYS, validStep, type NotifyPrefs } from "@/lib/notify-prefs";
import { pushConfigured, pushToUser } from "@/lib/push";

export type SimpleResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = { ok: false as const, error: "You're signed out — please sign in again." };

async function me() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

// Save reminder settings. Every field is validated; anything odd falls back
// to what's already saved rather than being written.
export async function saveNotifyPrefs(input: NotifyPrefs): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  const row: Record<string, unknown> = { user_id: s.userId, updated_at: new Date().toISOString() };
  for (const k of BOOL_KEYS) if (typeof input?.[k] === "boolean") row[k] = input[k];
  for (const k of TIME_KEYS) {
    const t = validStep(input?.[k]);
    if (t) row[k] = t;
  }
  const q = QUIET_OPTIONS.find((o) => o.start === (input?.quiet_start ?? null) && o.end === (input?.quiet_end ?? null));
  if (q) {
    row.quiet_start = q.start;
    row.quiet_end = q.end;
  }
  const { error } = await s.supabase.from("notification_prefs").upsert(row, { onConflict: "user_id" });
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

type SubInput = { endpoint: string; keys: { p256dh: string; auth: string } };

// Save this device's push subscription. One device endpoint belongs to one
// user, so this writes with the service role, always for the signed-in id.
export async function savePushSubscription(sub: SubInput, userAgent: string | null): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!/^https:\/\/[^\s]{1,990}$/.test(endpoint) || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth))
    return { ok: false, error: "This device sent an odd subscription. Try again." };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Notifications aren't set up on the server yet." };
  }
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: s.userId,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof userAgent === "string" ? userAgent.slice(0, 300) : null,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, error: "Couldn't turn notifications on. Try again." };
  await s.supabase
    .from("notification_prefs")
    .upsert({ user_id: s.userId, enabled: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string | null): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  if (typeof endpoint === "string" && endpoint) {
    await s.supabase.from("push_subscriptions").delete().eq("user_id", s.userId).eq("endpoint", endpoint);
  }
  const { error } = await s.supabase
    .from("notification_prefs")
    .upsert({ user_id: s.userId, enabled: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

export async function sendTestPush(): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  if (!pushConfigured()) return { ok: false, error: "Notifications aren't set up on the server yet." };
  try {
    const sent = await pushToUser(createAdminClient(), s.userId, {
      title: "Xclr",
      body: "Notifications are on. Reminders will look like this.",
      url: "/profile/notifications",
      tag: "test",
    });
    return sent > 0 ? { ok: true } : { ok: false, error: "No device got it. Turn the switch off and on again." };
  } catch {
    return { ok: false, error: "Couldn't send a test right now." };
  }
}

// ---- Inbox (the bell on Today) ----

export async function markNotificationsRead(ids: string[] | "all"): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  let q = s.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", s.userId)
    .is("read_at", null);
  if (ids !== "all") {
    const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 100);
    if (!clean.length) return { ok: true };
    q = q.in("id", clean);
  }
  const { error } = await q;
  if (error) return { ok: false, error: "Couldn't update. Try again." };
  return { ok: true };
}

// One-tap action on a reminder ("Log usual lunch"). The action is read from
// the saved notification, never from the browser.
export async function runNotificationAction(id: string): Promise<SimpleResult> {
  const s = await me();
  if (!s) return SIGNED_OUT;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "That reminder is gone." };
  const { data: n } = await s.supabase
    .from("notifications")
    .select("id, action")
    .eq("id", id)
    .eq("user_id", s.userId)
    .maybeSingle();
  const action = n?.action as { type?: string; library_id?: string; meal?: string } | null | undefined;
  if (!n || action?.type !== "log_library" || typeof action.library_id !== "string")
    return { ok: false, error: "That reminder has no quick action." };
  const r = await quickAddFromLibrary(action.library_id, typeof action.meal === "string" ? action.meal : null);
  if (!r.ok) return r;
  await s.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", s.userId);
  return { ok: true };
}
