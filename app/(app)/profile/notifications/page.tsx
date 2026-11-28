import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/session";
import { readPrefs } from "@/lib/notify-prefs";
import { pushConfigured, vapidPublicKey } from "@/lib/push";
import { NotifySettingsForm } from "@/components/app/notify-settings-form";

export default async function NotificationSettingsPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ data: row }, { count }] = await Promise.all([
    supabase.from("notification_prefs").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3.5">
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          aria-label="Back to You"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-card text-ink shadow-card"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <div>
          <h1 className="font-display text-[21px] font-bold tracking-[-0.02em] text-ink">Notifications</h1>
          <p className="text-xs text-muted">On this phone, from the Home Screen app</p>
        </div>
      </div>

      <NotifySettingsForm
        initial={readPrefs(row as Record<string, unknown> | null)}
        pushReady={pushConfigured()}
        publicKey={vapidPublicKey()}
        devices={count ?? 0}
      />
    </main>
  );
}
