import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/session";
import { acceptPrivacy } from "@/app/welcome/actions";

export const metadata = { title: "Welcome · Xclr" };

const POINTS: { title: string; body: string }[] = [
  {
    title: "What you log",
    body: "food, workouts, weight, and Watch data if you connect it. Only you see it in the app.",
  },
  {
    title: "Dave runs Xclr",
    body: "and can technically see the database. He won't look unless you ask him to fix something.",
  },
  {
    title: "The AI coach",
    body: "(Anthropic's Claude) reads what it needs to answer you. It isn't used to train AI.",
  },
  {
    title: "Photos",
    body: "are deleted after 48 hours. Health details stay off unless you turn them on.",
  },
  {
    title: "Leave any time",
    body: "Profile → Delete my data removes everything.",
  },
];

// The privacy welcome — shown once after sign-in, before onboarding, while
// profiles.privacy_accepted_at is null.
export default async function WelcomePage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("privacy_accepted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.privacy_accepted_at) redirect("/");

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-3 px-[18px] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[22px]">
      <p className="text-xs font-bold uppercase tracking-[0.04em] text-green">Welcome to Xclr</p>
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink">Before you start: what Xclr keeps</h1>
      <section aria-label="What Xclr keeps" className="glass px-4 py-3.5">
        <ul className="flex flex-col gap-[11px] text-sm leading-[1.45] text-ink">
          {POINTS.map((p) => (
            <li key={p.title} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-green-soft text-xs font-extrabold text-green"
              >
                ✓
              </span>
              <span>
                <strong>{p.title}</strong> — {p.body}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs leading-[1.45] text-muted">
        Xclr is a personal project, not a medical service. The coach never diagnoses; see a doctor for health concerns.
      </p>
      {searchParams.error ? (
        <p role="alert" className="text-xs font-semibold text-ember-text">
          Couldn&apos;t save that. Check your connection and try again.
        </p>
      ) : null}
      <div className="mt-auto flex flex-col gap-2">
        <form action={acceptPrivacy}>
          <button type="submit" className="btn-primary btn-primary-green min-h-[50px] w-full text-[15px]">
            I understand — continue
          </button>
        </form>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex min-h-10 w-full items-center justify-center text-[13px] font-semibold text-ink underline"
          >
            Not now — sign out
          </button>
        </form>
      </div>
    </main>
  );
}
