import { createClient } from "@/lib/supabase/server";
import { ChatTab, type Msg } from "@/components/app/chat-tab";
import type { CoachPersona } from "@/lib/chat-prompts";

// sendChatMessage makes two sequential Anthropic calls (parse + coach) with
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
    .select("display_name, coach_persona")
    .eq("id", user.id)
    .single();

  const { data: lib } = await supabase
    .from("food_library")
    .select("name, serving")
    .eq("user_id", user.id)
    .order("times_logged", { ascending: false })
    .limit(4);

  const chips = (lib ?? []).map(
    (r) => `${r.name as string}${r.serving ? ` ${r.serving as string}` : ""}`
  );
  const persona = (profile?.coach_persona as CoachPersona) ?? {};

  // Last ~50 turns, oldest-first, as text bubbles.
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const initialMessages: Msg[] = (history ?? [])
    .slice()
    .reverse()
    .map((r) =>
      r.role === "coach"
        ? { role: "coach" as const, text: r.content as string, cards: [] }
        : { role: "user" as const, text: r.content as string }
    );

  return (
    <ChatTab
      userId={user.id}
      coachName={persona.coach_name || "Xclr"}
      firstName={(profile?.display_name ?? "").split(" ")[0] || "there"}
      quickChips={chips}
      initialMessages={initialMessages}
    />
  );
}
