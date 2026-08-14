import { createClient } from "@/lib/supabase/server";
import { ChatTab } from "@/components/app/chat-tab";
import type { CoachPersona } from "@/lib/chat-prompts";

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

  return (
    <ChatTab
      coachName={persona.coach_name || "Xclr"}
      firstName={(profile?.display_name ?? "").split(" ")[0] || "there"}
      quickChips={chips}
    />
  );
}
