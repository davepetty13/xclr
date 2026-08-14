import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user!.id)
    .single();

  const name = profile?.display_name ?? user!.email;

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
          Foundation checkpoint — onboarding arrives in Session B.
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
