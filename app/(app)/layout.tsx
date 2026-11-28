import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { hasActiveProgram } from "@/lib/programs";
import { BottomNav } from "@/components/app/bottom-nav";
import { ServiceWorkerRegister } from "@/components/app/sw-register";
import { getCurrentUser } from "@/lib/session";

// The 5-tab app shell. Gating lives here so every tab is protected once:
// signed in → onboarded → has an active program → into the app.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Both checks at once instead of one after the other.
  const [{ data: profile }, hasProgram] = await Promise.all([
    supabase.from("profiles").select("display_name, height_cm").eq("id", user.id).single(),
    hasActiveProgram(supabase, user.id),
  ]);

  if (!isOnboarded(profile)) redirect("/onboarding");
  if (!hasProgram) redirect("/program");

  return (
    // No page fill: body paints the paper backdrop. Bottom padding = nav height
    // (h-20 + safe area) so the last content and the chat composer clear it.
    <div className="mx-auto min-h-screen w-full max-w-md pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav />
      <ServiceWorkerRegister />
    </div>
  );
}
