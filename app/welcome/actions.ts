"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// "I understand — continue": stamp privacy_accepted_at on the user's own
// profile row (the sign-in callback always seeds that row), then on to
// onboarding / the app. RLS-scoped to the caller.
export async function acceptPrivacy(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, privacy_accepted_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) {
    console.error(`[welcome] save acceptance failed: ${error.message}`);
    redirect("/welcome?error=1");
  }
  redirect("/");
}
