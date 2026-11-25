import { createClient } from "@/lib/supabase/server";
import { ChatTab, type Msg, type QuickChip } from "@/components/app/chat-tab";
import type { CoachPersona } from "@/lib/chat-prompts";
import { readMeta } from "@/lib/chat-library";
import { getUserTz } from "@/lib/goal-change";
import { todayWindow } from "@/lib/time";

// sendChatMessage can make two sequential Anthropic calls (parse + coach) with
// retries on 429/529. Route-segment maxDuration on the page governs the Server
// Actions it invokes; it can't go on the "use server" action module. Must match
// AI_BUDGET_SECONDS.chat in lib/anthropic.ts.
export const maxDuration = 120;

export default async function ChatPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, coach_persona, weight_unit")
    .eq("id", user.id)
    .single();
  const persona = (profile?.coach_persona as CoachPersona) ?? {};

  const tz = await getUserTz(supabase, user.id);
  const win = todayWindow(tz);

  // Quick-log chips: the user's most-logged dishes (tap = log, no AI).
  const { data: lib } = await supabase
    .from("food_library")
    .select("id, name, serving")
    .eq("user_id", user.id)
    .order("times_logged", { ascending: false })
    .limit(4);
  const chips: QuickChip[] = (lib ?? []).map((r) => ({
    id: r.id as string,
    label: `${r.name as string}${r.serving ? ` ${r.serving as string}` : ""}`,
  }));

  const { data: todayFoods } = await supabase
    .from("food_logs")
    .select("kcal, protein_g")
    .eq("user_id", user.id)
    .gte("logged_at", win.start)
    .lt("logged_at", win.end);
  const totals = {
    kcal: (todayFoods ?? []).reduce((s, r) => s + (Number(r.kcal) || 0), 0),
    protein: (todayFoods ?? []).reduce((s, r) => s + (Number(r.protein_g) || 0), 0),
  };

  // Last ~50 turns, oldest-first, with their cards (messages.meta).
  const { data: history } = await supabase
    .from("messages")
    .select("id, role, content, meta")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const initialMessages: Msg[] = (history ?? [])
    .slice()
    .reverse()
    .map((r) =>
      r.role === "coach"
        ? {
            role: "coach" as const,
            id: r.id as string,
            text: r.content as string,
            cards: readMeta(r.meta).cards,
          }
        : { role: "user" as const, text: r.content as string }
    );

  return (
    <ChatTab
      userId={user.id}
      coachName={persona.coach_name || "Xclr"}
      firstName={(profile?.display_name ?? "").split(" ")[0] || "there"}
      quickChips={chips}
      initialMessages={initialMessages}
      today={win.date}
      initialTotals={totals}
      unit={profile?.weight_unit === "lbs" ? "lbs" : "kg"}
    />
  );
}
