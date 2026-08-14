"use server";

import { createClient } from "@/lib/supabase/server";
import { anthropic, PROGRAM_MODEL } from "@/lib/anthropic";
import { getActiveProgram } from "@/lib/programs";
import {
  PROPOSAL_JSON_SCHEMA,
  validateProposal,
  coerceFieldValue,
  type ProposalField,
} from "@/lib/proposal-schema";
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserMessage,
  type ReviewContext,
  type ReviewExercise,
} from "@/lib/review-prompt";

export type SimpleResult = { ok: true } | { ok: false; error: string };

export type SetInput = {
  exercise_id: string;
  set_index: number;
  load_value: number | null;
  load_type: string | null;
  reps: number | null;
  rpe: number | null;
};

function weekStartISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString();
}

// Log a session's actual sets against a prescribed program day.
export async function logSession(
  programDayId: string,
  type: string | null,
  sets: SetInput[],
  myNote: string
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // Only keep sets the user actually logged (reps or load present).
  const real = (sets ?? []).filter(
    (s) => s.exercise_id && (s.reps != null || s.load_value != null)
  );
  if (!real.length && !myNote.trim())
    return { ok: false, error: "Log at least one set first." };

  const { data: session, error: sErr } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: user.id,
      program_day_id: programDayId,
      type,
      my_note: myNote.trim() || null,
      performed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (sErr || !session) return { ok: false, error: "Couldn't start the session." };

  if (real.length) {
    const rows = real.map((s) => ({
      user_id: user.id,
      session_id: session.id as string,
      exercise_id: s.exercise_id,
      set_index: s.set_index,
      actual_load_value: s.load_value,
      actual_load_type: s.load_type,
      actual_reps: s.reps,
      actual_rpe: s.rpe,
    }));
    const { error: setErr } = await supabase.from("set_logs").insert(rows);
    if (setErr) return { ok: false, error: "Couldn't save your sets." };
  }
  return { ok: true };
}

// Generate this week's progression proposal (Doc 02 §4). Never auto-applies —
// it writes a pending proposal + items the user reviews.
export async function generateWeeklyReview(): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const program = await getActiveProgram(supabase, user.id);
  if (!program) return { ok: false, error: "No active program to review." };

  const { data: days } = await supabase
    .from("program_days")
    .select("id")
    .eq("user_id", user.id)
    .eq("program_id", program.id);
  const dayIds = (days ?? []).map((d) => d.id as string);
  if (!dayIds.length) return { ok: false, error: "Your program has no days." };

  const { data: progEx } = await supabase
    .from("program_exercises")
    .select(
      "id, exercise_id, prescribed_sets, rep_scheme, rep_high, target_rpe_high, suggested_load_value, suggested_load_type, coach_note"
    )
    .eq("user_id", user.id)
    .in("program_day_id", dayIds);
  if (!progEx || !progEx.length)
    return { ok: false, error: "Your program has no exercises." };

  const { data: exRows } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", user.id);
  const nameById = new Map<string, string>();
  for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);

  // This week's actuals by exercise_id.
  const { data: setLogs } = await supabase
    .from("set_logs")
    .select("exercise_id, actual_load_value, actual_reps, actual_rpe")
    .eq("user_id", user.id)
    .gte("created_at", weekStartISO());
  const actualsByEx = new Map<
    string,
    { load_value: number | null; reps: number | null; rpe: number | null }[]
  >();
  for (const s of setLogs ?? []) {
    const key = s.exercise_id as string;
    const list = actualsByEx.get(key) ?? [];
    list.push({
      load_value: s.actual_load_value as number | null,
      reps: s.actual_reps as number | null,
      rpe: s.actual_rpe as number | null,
    });
    actualsByEx.set(key, list);
  }

  const refToProgExId = new Map<number, string>();
  const exercises: ReviewExercise[] = progEx.map((pe, i) => {
    refToProgExId.set(i, pe.id as string);
    return {
      ref: i,
      name: nameById.get(pe.exercise_id as string) ?? "Exercise",
      prescribed_sets: pe.prescribed_sets as number | null,
      rep_scheme: pe.rep_scheme as string | null,
      rep_high: pe.rep_high as number | null,
      target_rpe_high: pe.target_rpe_high as number | null,
      suggested_load_value: pe.suggested_load_value as number | null,
      suggested_load_type: pe.suggested_load_type as string | null,
      coach_note: pe.coach_note as string | null,
      actuals: actualsByEx.get(pe.exercise_id as string) ?? [],
    };
  });

  const { data: notesRows } = await supabase
    .from("workout_sessions")
    .select("my_note")
    .eq("user_id", user.id)
    .gte("performed_at", weekStartISO())
    .not("my_note", "is", null);
  const notes = (notesRows ?? [])
    .map((n) => (n.my_note as string | null)?.trim())
    .filter((n): n is string => !!n);

  const { data: sleepRows } = await supabase
    .from("sleep_logs")
    .select("duration_min")
    .eq("user_id", user.id)
    .gte("slept_on", weekStartISO().slice(0, 10));
  const sleepVals = (sleepRows ?? [])
    .map((s) => Number(s.duration_min))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgSleep = sleepVals.length
    ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length
    : null;

  const { data: weightRows } = await supabase
    .from("weights")
    .select("kg, measured_on")
    .eq("user_id", user.id)
    .order("measured_on", { ascending: false })
    .limit(8);
  let weightTrend = "no recent weigh-ins";
  if (weightRows && weightRows.length >= 2) {
    const newest = Number(weightRows[0].kg);
    const oldest = Number(weightRows[weightRows.length - 1].kg);
    const diff = newest - oldest;
    weightTrend = `${newest}kg now, ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}kg over ${weightRows.length} readings`;
  }

  const ctx: ReviewContext = {
    exercises,
    notes,
    avg_sleep_min: avgSleep,
    weight_trend: weightTrend,
  };

  let proposal;
  try {
    const message = await anthropic().messages.create({
      model: PROGRAM_MODEL,
      max_tokens: 8000,
      system: REVIEW_SYSTEM_PROMPT,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PROPOSAL_JSON_SCHEMA },
      },
      messages: [{ role: "user", content: buildReviewUserMessage(ctx) }],
    });
    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens")
      return { ok: false, error: "Couldn't build the review — try again." };
    const t = message.content.find((b) => b.type === "text");
    if (!t || t.type !== "text")
      return { ok: false, error: "Couldn't build the review — try again." };
    const parsed = validateProposal(JSON.parse(t.text), exercises.length);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    proposal = parsed.proposal;
  } catch {
    return { ok: false, error: "Couldn't reach the coach — try again in a moment." };
  }

  // Replace any existing pending proposal for this program.
  await supabase
    .from("progression_proposals")
    .delete()
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .eq("status", "pending");

  const { data: propRow, error: pErr } = await supabase
    .from("progression_proposals")
    .insert({
      user_id: user.id,
      program_id: program.id,
      week_start: weekStartISO().slice(0, 10),
      status: "pending",
      summary: proposal.summary,
    })
    .select("id")
    .single();
  if (pErr || !propRow) return { ok: false, error: "Couldn't save the review." };

  const itemRows = proposal.items
    .map((it) => {
      const progExId = refToProgExId.get(it.ref);
      if (!progExId) return null;
      return {
        user_id: user.id,
        proposal_id: propRow.id as string,
        program_exercise_id: progExId,
        field: it.field,
        old_value: it.old_value,
        new_value: it.new_value,
        rationale: it.rationale,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (itemRows.length) {
    const { error: itemErr } = await supabase
      .from("proposal_items")
      .insert(itemRows);
    if (itemErr) return { ok: false, error: "Couldn't save the review items." };
  }

  return { ok: true };
}

// Apply approved items to the program, mark the proposal decided. Items not in
// approvedItemIds are kept as-is (no change). Nothing auto-applies.
export async function applyProposal(
  proposalId: string,
  approvedItemIds: string[]
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // Only a still-pending proposal can be decided (guards double-apply).
  const { data: prop } = await supabase
    .from("progression_proposals")
    .select("status")
    .eq("id", proposalId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!prop) return { ok: false, error: "That review is gone." };
  if (prop.status !== "pending")
    return { ok: false, error: "That review was already decided." };

  // Load the proposal's items (RLS-scoped) so a client can't apply arbitrary rows.
  const { data: items } = await supabase
    .from("proposal_items")
    .select("id, program_exercise_id, field, new_value")
    .eq("user_id", user.id)
    .eq("proposal_id", proposalId);
  if (!items) return { ok: false, error: "That review is gone." };

  const approved = new Set(approvedItemIds);
  for (const it of items) {
    if (!approved.has(it.id as string)) continue;
    const coerced = coerceFieldValue(
      it.field as ProposalField,
      it.new_value as string
    );
    if (!coerced) continue;
    await supabase
      .from("program_exercises")
      .update({ [coerced.column]: coerced.value })
      .eq("id", it.program_exercise_id as string)
      .eq("user_id", user.id);
  }

  const { error: decErr } = await supabase
    .from("progression_proposals")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("user_id", user.id);
  if (decErr) return { ok: false, error: "Couldn't finalize the review." };

  return { ok: true };
}
