import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localDate } from "@/lib/time";
import { isInternalPath } from "@/lib/safe-url";
import type { InboxItem } from "@/components/app/notify-bell";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

function whenLabel(iso: string, tz: string, today: string): string {
  const at = new Date(iso);
  const day = localDate(tz, at);
  if (day === today) return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  if (day === addDays(today, -1)) return "Yesterday";
  if (day >= addDays(today, -6)) return at.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
}

// The newest 30 reminders for the bell (RLS + user_id filter).
export async function loadInbox(supabase: Supa, userId: string, tz: string, today: string): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, url, action, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return data.map((r) => {
    const a = r.action as { type?: string; label?: string; href?: string } | null;
    const label = typeof a?.label === "string" ? a.label.slice(0, 40) : null;
    let action: InboxItem["action"] = null;
    if (a?.type === "log_library" && label) action = { type: "log_library", label };
    else if (a?.type === "link" && label && isInternalPath(a.href))
      action = { type: "link", label, href: a.href };
    return {
      id: r.id as string,
      kind: r.kind as string,
      title: r.title as string,
      body: (r.body as string | null) ?? null,
      url: isInternalPath(r.url) ? r.url : null,
      when: whenLabel(r.created_at as string, tz, today),
      unread: r.read_at == null,
      action,
    };
  });
}
