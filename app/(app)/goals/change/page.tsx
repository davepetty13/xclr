import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GoalChangeForm } from "@/components/app/goal-change-form";
import { getCurrentUser } from "@/lib/session";

export default async function ChangeGoalPage({
  searchParams,
}: {
  searchParams?: { goal?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ data: profile }, { data: latest }] = await Promise.all([
    supabase
      .from("profiles")
      .select("primary_goal, daily_calorie_target, daily_protein_target, goal_weight_kg, weight_unit")
      .eq("id", user.id)
      .single(),
    supabase
      .from("weights")
      .select("kg")
      .eq("user_id", user.id)
      .order("measured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Presented as a bottom sheet over a scrim (GoalEditGlass). Solid surface, no blur.
  return (
    <>
      <Link href="/goals" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-30 bg-scrim" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-change-h"
        className="pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto !rounded-b-none px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2.5"
      >
        <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-sm bg-line" />
        <div className="flex items-center justify-between gap-3">
          <h1 id="goal-change-h" className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
            Change your goal
          </h1>
          <Link
            href="/goals"
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-control bg-segment text-ink"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>
        <GoalChangeForm
          initialGoal={searchParams?.goal ?? null}
          currentGoal={(profile?.primary_goal as string | null) ?? null}
          currentKcal={profile?.daily_calorie_target != null ? Number(profile.daily_calorie_target) : null}
          currentProtein={profile?.daily_protein_target != null ? Number(profile.daily_protein_target) : null}
          goalWeightKg={profile?.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null}
          latestWeightKg={latest?.kg != null ? Number(latest.kg) : null}
          unit={profile?.weight_unit === "lbs" ? "lbs" : "kg"}
        />
      </section>
    </>
  );
}
