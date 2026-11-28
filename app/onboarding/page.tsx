import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getCurrentUser } from "@/lib/session";

export default async function OnboardingPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, height_cm, privacy_accepted_at")
    .eq("id", user.id)
    .single();

  if (!profile?.privacy_accepted_at) redirect("/welcome");
  // Already onboarded → nothing to do here.
  if (isOnboarded(profile)) redirect("/");

  const initialName =
    profile?.display_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  return <OnboardingWizard initialName={initialName} />;
}
