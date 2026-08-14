import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboarded } from "@/lib/onboarding";
import { hasActiveProgram } from "@/lib/programs";

export default async function Home() {
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

  // Fresh account (profile seeded with only a name) → send through onboarding.
  if (!isOnboarded(profile)) redirect("/onboarding");

  // Onboarded but no program yet → build one (also the existing-user path).
  if (!(await hasActiveProgram(supabase, user.id))) redirect("/program");

  const name = profile?.display_name ?? user.email;

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-8 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
          Xclr
        </p>
        <h1 className="mt-1 font-serif text-3xl font-medium tracking-tight">
          Signed in as <em className="italic text-green">{name}</em>
        </h1>
        <p className="mt-3 text-sm font-medium text-muted">
          You&apos;re all set. Your Today dashboard arrives in a later session.
        </p>
        <form action="/auth/signout" method="post" className="mt-8">
          <button
            type="submit"
            className="w-full rounded-chip border border-line bg-paper px-4 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
