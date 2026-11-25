import { WorkoutNav } from "@/components/app/workout-nav";
import { createClient } from "@/lib/supabase/server";

export default async function WorkoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pending coach reviews → a small count on the Review tab.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let pending = 0;
  if (user) {
    const { count } = await supabase
      .from("progression_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending");
    pending = count ?? 0;
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <h1 className="mx-1 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
        Train
      </h1>
      <div className="mt-3">
        <WorkoutNav pendingReviews={pending} />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
