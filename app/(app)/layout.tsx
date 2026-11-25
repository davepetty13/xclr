import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { hasActiveProgram } from "@/lib/programs";
import { BottomNav } from "@/components/app/bottom-nav";

// The 5-tab app shell. Gating lives here so every tab is protected once:
// signed in → onboarded → has an active program → into the app.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, height_cm")
    .eq("id", user.id)
    .single();

  if (!isOnboarded(profile)) redirect("/onboarding");
  if (!(await hasActiveProgram(supabase, user.id))) redirect("/program");

  return (
    // No page fill: body paints the paper backdrop. Bottom padding = nav height
    // (h-20 + safe area) so the last content and the chat composer clear it.
    <div className="mx-auto min-h-screen w-full max-w-md pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav />
    </div>
  );
}
