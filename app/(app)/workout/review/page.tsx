import { formatLoad, type LoadType } from "@/lib/program-schema";
import { createClient } from "@/lib/supabase/server";
import { getWeekStatus } from "@/lib/programs";
import { getUserTz } from "@/lib/goal-change";
import { localDayStartISO, localDate, prettyDate } from "@/lib/time";
import { countPRs, type PrSet } from "@/lib/training";
import { getCurrentUser } from "@/lib/session";
import { loadShareContext, weekShare } from "@/lib/share-data";
import { ShareButton } from "@/components/app/share-sheet";
import {
  WeekReview,
  type PendingProposal,
  type ReviewItem,
  type ReviewSummary,
} from "@/components/app/week-review";

// generateWeeklyReview calls the Anthropic API (up to 8k output tokens plus
// thinking, with retries on 429/529). Route-segment maxDuration on the page
// governs the Server Actions it invokes. Must match AI_BUDGET_SECONDS.review.
export const maxDuration = 300;

export default async function WorkoutReviewPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  const program = status?.program ?? null;
  let proposal: PendingProposal = null;
  let loadError = false;
  let windowStart: string | null = status?.weekStartISO ?? null;
  let windowEnd: string | null = null; // null = now

  if (program && status) {
    const { data: prop, error: propError } = await supabase
      .from("progression_proposals")
      .select("id, summary, week_start, created_at")
      .eq("user_id", user.id)
      .eq("program_id", program.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (propError) loadError = true;

    if (prop) {
      const { data: items } = await supabase
        .from("proposal_items")
        .select("id, program_exercise_id, field, old_value, new_value, rationale")
        .eq("user_id", user.id)
        .eq("proposal_id", prop.id as string);

      // Resolve program_exercise_id → exercise name.
      const peIds = (items ?? []).map((it) => it.program_exercise_id as string);
      const nameByPe = new Map<string, string>();
      const loadTypeByPe = new Map<string, LoadType | null>();
      if (peIds.length) {
        const { data: pes } = await supabase
          .from("program_exercises")
          .select("id, exercise_id, suggested_load_type")
          .eq("user_id", user.id)
          .in("id", peIds);
        const exIds = (pes ?? []).map((p) => p.exercise_id as string);
        const { data: exRows } = await supabase
          .from("exercises")
          .select("id, name")
          .eq("user_id", user.id)
          .in("id", exIds);
        const nameByEx = new Map<string, string>();
        for (const e of exRows ?? []) nameByEx.set(e.id as string, e.name as string);
        for (const p of pes ?? [])
          loadTypeByPe.set(p.id as string, (p.suggested_load_type as LoadType | null) ?? null);
        for (const p of pes ?? [])
          nameByPe.set(
            p.id as string,
            nameByEx.get(p.exercise_id as string) ?? "Exercise"
          );
      }

      const reviewItems: ReviewItem[] = (items ?? []).map((it) => {
        const field = it.field as string;
        const oldV = (it.old_value as string | null) ?? "";
        const newV = (it.new_value as string | null) ?? "";
        const lt = loadTypeByPe.get(it.program_exercise_id as string) ?? null;
        // Loads always carry their type: "62.5 kg", "20 kg assist", "20 kg/side".
        const show = (v: string) =>
          field === "suggested_load_value" && v !== "" && Number.isFinite(Number(v))
            ? formatLoad(Number(v), lt) || v
            : v;
        const o = Number(oldV);
        const n = Number(newV);
        const isLoad = field === "suggested_load_value" && Number.isFinite(o) && Number.isFinite(n) && oldV !== "";
        return {
          id: it.id as string,
          exercise: nameByPe.get(it.program_exercise_id as string) ?? "Exercise",
          field,
          old_value: oldV,
          new_value: newV,
          old_display: show(oldV),
          new_display: show(newV),
          // Less assist = stronger, so it reads as progress too.
          progress: isLoad && (lt === "assist_kg" ? n < o : n > o),
          rationale: (it.rationale as string | null) ?? "",
        };
      });

      // Was this review for the week still in progress, or one already behind us?
      const reviewedStart = (prop.week_start as string | null) ?? status.weekStartedOn;
      const currentWeek = reviewedStart === status.weekStartedOn;
      if (!currentWeek) {
        windowStart = localDayStartISO(reviewedStart, tz);
        windowEnd = status.weekStartISO;
      }

      proposal = {
        id: prop.id as string,
        summary: (prop.summary as string | null) ?? "",
        items: reviewItems,
        currentWeek,
        preparedOn: prop.created_at
          ? prettyDate(localDate(tz, new Date(prop.created_at as string)))
          : null,
      };
    }
  }

  // Summary strip: sessions, PRs, average RPE for the reviewed week.
  let summary: ReviewSummary | null = null;
  if (windowStart) {
    let q = supabase
      .from("workout_sessions")
      .select("id, performed_at")
      .eq("user_id", user.id)
      .gte("performed_at", windowStart);
    if (windowEnd) q = q.lt("performed_at", windowEnd);
    const { data: sess } = await q;
    const inWindow = new Set((sess ?? []).map((x) => x.id as string));

    // PRs compare this week's best against everything before it, so read all
    // sets up to the window's end.
    let endQ = supabase
      .from("workout_sessions")
      .select("id, performed_at")
      .eq("user_id", user.id);
    if (windowEnd) endQ = endQ.lt("performed_at", windowEnd);
    const { data: allSess } = await endQ;
    const atBySession = new Map<string, string>();
    for (const x of allSess ?? []) atBySession.set(x.id as string, x.performed_at as string);

    const { data: sets } = await supabase
      .from("set_logs")
      .select("session_id, exercise_id, actual_load_value, actual_load_type, actual_reps, actual_rpe, is_pr")
      .eq("user_id", user.id);
    const prSets: PrSet[] = [];
    const rpes: number[] = [];
    for (const st of sets ?? []) {
      const at = atBySession.get(st.session_id as string);
      if (!at) continue;
      prSets.push({
        exercise_id: st.exercise_id as string,
        load_value: st.actual_load_value as number | null,
        load_type: st.actual_load_type as string | null,
        reps: st.actual_reps as number | null,
        at,
        is_pr: st.is_pr as boolean | null,
      });
      const rpe = Number(st.actual_rpe);
      if (inWindow.has(st.session_id as string) && st.actual_rpe != null && rpe > 0) rpes.push(rpe);
    }
    summary = {
      sessions: inWindow.size,
      prs: countPRs(prSets, windowStart),
      avgRpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
    };
  }

  // "Share my week": card numbers from this week's own rows (plain data).
  const share = status ? weekShare(await loadShareContext(supabase, user.id)) : null;

  return (
    <div className="space-y-3">
      <WeekReview
        proposal={proposal}
        week={status?.week ?? 1}
        weekComplete={status?.weekComplete ?? false}
        summary={summary}
        loadError={loadError}
      />
      {share ? (
        <ShareButton
          bundle={share}
          initialTab="week"
          label="Share my week"
          className="btn-secondary w-full text-sm"
        />
      ) : null}
    </div>
  );
}
