import { createClient } from "@/lib/supabase/server";
import { getActiveProgram } from "@/lib/programs";
import {
  WeekReview,
  type PendingProposal,
  type ReviewItem,
} from "@/components/app/week-review";

// generateWeeklyReview calls the Anthropic API (20–30s). Route-segment
// maxDuration on the page governs the Server Actions it invokes.
export const maxDuration = 60;

export default async function WorkoutReviewPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const program = await getActiveProgram(supabase, user.id);
  let proposal: PendingProposal = null;

  if (program) {
    const { data: prop } = await supabase
      .from("progression_proposals")
      .select("id, summary")
      .eq("user_id", user.id)
      .eq("program_id", program.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prop) {
      const { data: items } = await supabase
        .from("proposal_items")
        .select("id, program_exercise_id, field, old_value, new_value, rationale")
        .eq("user_id", user.id)
        .eq("proposal_id", prop.id as string);

      // Resolve program_exercise_id → exercise name.
      const peIds = (items ?? []).map((it) => it.program_exercise_id as string);
      const nameByPe = new Map<string, string>();
      if (peIds.length) {
        const { data: pes } = await supabase
          .from("program_exercises")
          .select("id, exercise_id")
          .in("id", peIds);
        const exIds = (pes ?? []).map((p) => p.exercise_id as string);
        const { data: exRows } = await supabase
          .from("exercises")
          .select("id, name")
          .in("id", exIds);
        const nameByEx = new Map<string, string>();
        for (const e of exRows ?? []) nameByEx.set(e.id as string, e.name as string);
        for (const p of pes ?? [])
          nameByPe.set(
            p.id as string,
            nameByEx.get(p.exercise_id as string) ?? "Exercise"
          );
      }

      const reviewItems: ReviewItem[] = (items ?? []).map((it) => ({
        id: it.id as string,
        exercise: nameByPe.get(it.program_exercise_id as string) ?? "Exercise",
        field: it.field as string,
        old_value: (it.old_value as string | null) ?? "",
        new_value: (it.new_value as string | null) ?? "",
        rationale: (it.rationale as string | null) ?? "",
      }));

      proposal = {
        id: prop.id as string,
        summary: (prop.summary as string | null) ?? "",
        items: reviewItems,
      };
    }
  }

  return <WeekReview proposal={proposal} />;
}
