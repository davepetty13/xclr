import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Web Push (free; works on iPhone 16.4+ when Xclr is opened from the Home
// Screen icon). Keys come from env only. With no keys, push is simply off:
// nothing crashes and reminders still land in the in-app bell.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
//      NEXT_PUBLIC_VAPID_PUBLIC_KEY (same public key, for the browser).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function pushConfigured(): boolean {
  return !!(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = vapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
    return true;
  } catch {
    console.error("[push] VAPID keys are set but invalid");
    return false;
  }
}

export type PushMessage = { title: string; body?: string | null; url?: string | null; tag?: string };

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

// Send to every subscription of one user. Gone subscriptions (404/410) are
// deleted. Returns how many devices accepted the message.
export async function pushToUser(admin: Supa, userId: string, msg: PushMessage): Promise<number> {
  if (!configure()) return 0;
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .limit(10);
  if (!subs?.length) return 0;

  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body ?? "",
    url: msg.url && msg.url.startsWith("/") ? msg.url : "/",
    tag: msg.tag,
  });
  let ok = 0;
  for (const s of subs as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 4 * 3600, urgency: "normal" }
      );
      ok++;
      await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id).eq("user_id", userId);
      } else {
        console.error(`[push] send failed status=${code ?? "?"}`);
      }
    }
  }
  return ok;
}
