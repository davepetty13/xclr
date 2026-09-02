import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { PRIMARY_GOALS } from "@/lib/onboarding-options";
import { ProgramBuilder } from "@/components/program/program-builder";

// Program generation calls the Anthropic API (20–30s); raise the serverless
// function limit above Vercel's short default. maxDuration is route-segment
// config — it must live on the page, not the "use server" action module (which
// may only export async functions), and it governs the Server Actions this page
// invokes.
export const maxDuration = 60;

export default async function ProgramPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, height_cm, primary_goal, training_notes")
    .eq("id", user.id)
    .single();

  // Must have finished onboarding to have inputs to generate from.
  if (!isOnboarded(profile)) redirect("/onboarding");

  const goalLabel =
    PRIMARY_GOALS.find((g) => g.value === profile?.primary_goal)?.label ??
    "your goal";

  return (
    <ProgramBuilder
      displayName={profile?.display_name ?? ""}
      goalLabel={goalLabel}
      initialNotes={(profile?.training_notes as string | null) ?? ""}
    />
  );
}
