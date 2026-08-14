import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { PRIMARY_GOALS } from "@/lib/onboarding-options";
import { ProgramBuilder } from "@/components/program/program-builder";

export default async function ProgramPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, height_cm, primary_goal")
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
    />
  );
}
