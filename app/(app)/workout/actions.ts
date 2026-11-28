"use server";

import { createClient } from "@/lib/supabase/server";
import { generateJson } from "@/lib/ai-json";
import { AI_BUDGET_SECONDS } from "@/lib/anthropic";
import { deadlineAfter } from "@/lib/ai-call";
import { getActiveProgram, getWeekStatus } from "@/lib/programs";
import { getUserTz } from "@/lib/goal-change";
import { addDays, localDate, localDayStartISO, todayLocal } from "@/lib/time";
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
import { healthAverages } from "@/lib/health";

export type SimpleResult = { ok: true } | { ok: false; error: string };

export type SetInput = {
  exercise_id: string;
  set_index: number;
  load_value: number | null;
  load_type: string | null;
  reps: number | null;
  rpe: number | null;
};

export type NewWeekResult =
  | { ok: true; week: number; hasProposal: boolean; reviewFrom: string }
  | { ok: false; error: string };

type Supa = ReturnType<typeof createClient>;

// The active program's week fields, scoped to the caller.
async function loadWeek(supabase: Supa, userId: string, programId: string, tz: string) {
  const { data } = await supabase
    .from("programs")
    .select("current_week, week_started_on, week_start, created_at")
    .eq("id", programId)
    .eq("user_id", userId)
    .maybeSingle();
  // Same fallback chain as getWeekStatus, so skips and reviews agree on the week.
  return {
    week: Number(data?.current_week) || 1,
    startedOn:
      (data?.week_started_on as string | null) ??
      (data?.week_start as string | null) ??
      (data?.created_at ? localDate(tz, new Date(data.created_at as string)) : todayLocal(tz)),
  };
}

// Begin the next training week (local today). Repeat keeps the week number;
// fresh moves to N+1. Unfinished days simply stay unlogged (history shows them
// as skipped). Pending coach changes are NEVER applied here.
async function advanceWeek(
  supabase: Supa,
  userId: string,
  programId: string,
  mode: "repeat" | "fresh",
  tz: string
): Promise<{ ok: true; week: number; previousStart: string } | { ok: false }> {
  const cur = await loadWeek(supabase, userId, programId, tz);
  const week = mode === "fresh" ? cur.week + 1 : cur.week;
  const { error } = await supabase
    .from("programs")
    .update({ current_week: week, week_started_on: todayLocal(tz) })
    .eq("id", programId)
    .eq("user_id", userId);
  if (error) return { ok: false };
  return { ok: true, week, previousStart: cur.startedOn };
}

// "Start a new week" — the user picks Repeat week N or Fresh week N+1.
export async function startNewWeek(mode: "repeat" | "fresh"): Promise<NewWeekResult> {
  if (mode !== "repeat" && mode !== "fresh") return { ok: false, error: "Pick repeat or fresh." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const program = await getActiveProgram(supabase, user.id);
  if (!program) return { ok: false, error: "No active program yet." };
  const tz = await getUserTz(supabase, user.id);

  const r = await advanceWeek(supabase, user.id, program.id, mode, tz);
  if (!r.ok) return { ok: false, error: "Couldn't start the new week." };

  const { count } = await supabase
    .from("progression_proposals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .eq("status", "pending");

  return { ok: true, week: r.week, hasProposal: (count ?? 0) > 0, reviewFrom: r.previousStart };
}

// Log a session's actual sets against a prescribed program day.
export async function logSession(
  programDayId: string,
  type: string | null,
  sets: SetInput[],
  myNote: string
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const note = typeof myNote === "string" ? myNote.trim().slice(0, 1000) : "";
  const sessionType = typeof type === "string" ? type.slice(0, 40) : null;

  // Only keep sets the user actually logged (reps or load present).
  const real = (sets ?? []).filter(
    (s) => s.exercise_id && (s.reps != null || s.load_value != null)
  );
  if (!real.length && !note)
    return { ok: false, error: "Log at least one set first." };

  // The day must belong to the caller's ACTIVE program.
  const program = await getActiveProgram(supabase, user.id);
  if (!program) return { ok: false, error: "No active program yet." };
  const { data: dayRow } = await supabase
    .from("program_days")
    .select("id")
    .eq("id", programDayId)
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .maybeSingle();
  if (!dayRow) return { ok: false, error: "That day isn't in your current program. Refresh and try again." };

  // Sets may only reference the caller's own exercises; numbers are clamped.
  const { data: ownEx } = await supabase
    .from("exercises")
    .select("id")
    .eq("user_id", user.id)
    .in("id", Array.from(new Set(real.map((s) => s.exercise_id))));
  const ownIds = new Set((ownEx ?? []).map((e) => e.id as string));
  const LOAD_TYPES = new Set(["total_kg", "per_side_kg", "assist_kg", "bodyweight", "time_min", "none"]);
  const clamp = (v: number | null, lo: number, hi: number) =>
    v == null || !Number.isFinite(v) ? null : Math.min(hi, Math.max(lo, v));
  const safeSets = real
    .filter((s) => ownIds.has(s.exercise_id))
    .map((s) => ({
      ...s,
      set_index: Math.round(clamp(s.set_index, 1, 50) ?? 1),
      load_value: clamp(s.load_value, 0, 1000),
      load_type: s.load_type && LOAD_TYPES.has(s.load_type) ? s.load_type : null,
      reps: s.reps == null ? null : Math.round(clamp(s.reps, 0, 1000) ?? 0),
      rpe: clamp(s.rpe, 0, 10),
    }));
  if (real.length && !safeSets.length)
    return { ok: false, error: "Those exercises aren't in your program. Refresh and try again." };

  const { data: session, error: sErr } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: user.id,
      program_day_id: programDayId,
      type: sessionType,
      my_note: note || null,
      performed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (sErr || !session) return { ok: false, error: "Couldn't start the session." };

  if (safeSets.length) {
    const rows = safeSets.map((s) => ({
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
    if (setErr) {
      // Don't leave an empty session behind that would mark the day done.
      await supabase
        .from("workout_sessions")
        .delete()
        .eq("id", session.id as string)
        .eq("user_id", user.id);
      return { ok: false, error: "Couldn't save your sets. Nothing was logged — try again." };
    }
  }
  return { ok: true, sessionId: session.id as string };
}

// Generate the week's progression proposal (Doc 02 §4). Never auto-applies —
// it writes a pending proposal + items the user reviews.
//
// Window: the current training week (local midnight of week_started_on → now).
// `reviewFrom` (the previous week's start, handed back by startNewWeek) reviews
// the week that just ended instead: reviewFrom → start of the current week.
export async function generateWeeklyReview(reviewFrom?: string): Promise<SimpleResult> {
  const deadline = deadlineAfter(AI_BUDGET_SECONDS.review);
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const program = await getActiveProgram(supabase, user.id);
  if (!program) return { ok: false, error: "No active program to review." };
  const tz = await getUserTz(supabase, user.id);
  const wk = await loadWeek(supabase, user.id, program.id, tz);

  let fromDate = wk.startedOn;
  let toISO: string | null = null; // null = up to now
  let toDate: string | null = null;
  if (
    typeof reviewFrom === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(reviewFrom) &&
    reviewFrom < wk.startedOn &&
    reviewFrom >= addDays(wk.startedOn, -42)
  ) {
    fromDate = reviewFrom;
    toDate = wk.startedOn;
    toISO = localDayStartISO(wk.startedOn, tz);
  }
  const fromISO = localDayStartISO(fromDate, tz);

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

  // The week's sessions (and their notes), then their sets.
  let sessQ = supabase
    .from("workout_sessions")
    .select("id, my_note")
    .eq("user_id", user.id)
    .gte("performed_at", fromISO);
  if (toISO) sessQ = sessQ.lt("performed_at", toISO);
  const { data: sessRows } = await sessQ;
  const sessionIds = (sessRows ?? []).map((r) => r.id as string);

  // Days skipped in the reviewed week (+ the user's reasons) — the coach weighs these.
  const { data: dayLabels } = await supabase
    .from("program_days")
    .select("id, day_index, label")
    .eq("user_id", user.id)
    .eq("program_id", program.id);
  const labelById = new Map<string, string>();
  for (const d of dayLabels ?? [])
    labelById.set(d.id as string, `Day ${d.day_index}${d.label ? ` (${d.label})` : ""}`);
  const { data: skipRows } = await supabase
    .from("day_skips")
    .select("program_day_id, note")
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .eq("week_started_on", fromDate);
  const skipped = (skipRows ?? []).map((k) => ({
    day: labelById.get(k.program_day_id as string) ?? "A training day",
    note: ((k.note as string | null) ?? "").trim() || null,
  }));

  if (!sessionIds.length && !skipped.length)
    return { ok: false, error: "No sessions logged this week yet. Log a workout first." };

  const { data: setLogs } = await supabase
    .from("set_logs")
    .select("exercise_id, actual_load_value, actual_reps, actual_rpe")
    .eq("user_id", user.id)
    .in("session_id", sessionIds);
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

  const notes = (sessRows ?? [])
    .map((n) => (n.my_note as string | null)?.trim())
    .filter((n): n is string => !!n);

  let sleepQ = supabase
    .from("sleep_logs")
    .select("duration_min")
    .eq("user_id", user.id)
    .gte("slept_on", fromDate);
  if (toDate) sleepQ = sleepQ.lt("slept_on", toDate);
  const { data: sleepRows } = await sleepQ;
  const sleepVals = (sleepRows ?? [])
    .map((s) => Number(s.duration_min))
    .filter((n) => Number.isFinite(n) && n > 0);
  const activity = await healthAverages(supabase, user.id, fromDate, toDate ?? null);
  const avgSleep = sleepVals.length
    ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length
    : activity?.avg_sleep_min ?? null;

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
    skipped,
    avg_sleep_min: avgSleep,
    weight_trend: weightTrend,
    activity,
  };

  const r = await generateJson({
    job: "review",
    system: REVIEW_SYSTEM_PROMPT,
    user: buildReviewUserMessage(ctx),
    schema: PROPOSAL_JSON_SCHEMA,
    toolName: "propose_changes",
    maxTokens: 8000,
    deadline,
    effort: "medium",
    track: { supabase, userId: user.id },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = validateProposal(r.data, exercises.length);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const proposal = parsed.proposal;

  // Save the NEW proposal first. Old pending proposals are only removed once
  // the new one (and all its items) saved — a failure never loses a review.
  const { data: propRow, error: pErr } = await supabase
    .from("progression_proposals")
    .insert({
      user_id: user.id,
      program_id: program.id,
      week_start: fromDate,
      status: "pending",
      summary: proposal.summary,
    })
    .select("id")
    .single();
  if (pErr || !propRow) return { ok: false, error: "Couldn't save the review." };
  const newId = propRow.id as string;

  const itemRows = proposal.items
    .map((it) => {
      const progExId = refToProgExId.get(it.ref);
      if (!progExId) return null;
      return {
        user_id: user.id,
        proposal_id: newId,
        program_exercise_id: progExId,
        field: it.field,
        // The CURRENT value always comes from the program, never the model.
        old_value: currentValue(progEx[it.ref] as Record<string, unknown> | undefined, it.field),
        new_value: it.new_value,
        rationale: it.rationale,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (itemRows.length) {
    const { error: itemErr } = await supabase
      .from("proposal_items")
      .insert(itemRows);
    if (itemErr) {
      await supabase
        .from("progression_proposals")
        .delete()
        .eq("id", newId)
        .eq("user_id", user.id);
      return { ok: false, error: "Couldn't save the review items. Your earlier review is unchanged." };
    }
  }

  await supabase
    .from("progression_proposals")
    .delete()
    .eq("user_id", user.id)
    .eq("program_id", program.id)
    .eq("status", "pending")
    .neq("id", newId);

  return { ok: true };
}

// Apply approved items to the program, mark the proposal decided. Items not in
// approvedItemIds are kept as-is (no change). Nothing auto-applies.
// startNextWeek is kept for call compatibility and ignored: starting a week is
// always the user's separate Repeat / Fresh choice.
function currentValue(row: Record<string, unknown> | undefined, field: string): string {
  if (!row) return "";
  const v = row[field];
  return v == null ? "" : String(v);
}

export async function applyProposal(
  proposalId: string,
  approvedItemIds: string[],
  startNextWeek = false
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // Claim the proposal in ONE conditional update (pending → applying) so a
  // double tap can't apply it twice.
  const { data: claimed } = await supabase
    .from("progression_proposals")
    .update({ status: "applying" })
    .eq("id", proposalId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("status, program_id, week_start");
  const prop = claimed?.[0];
  if (!prop) return { ok: false, error: "That review was already decided, or it's gone." };

  // Load the proposal's items (RLS-scoped) so a client can't apply arbitrary rows.
  const { data: items } = await supabase
    .from("proposal_items")
    .select("id, program_exercise_id, field, new_value")
    .eq("user_id", user.id)
    .eq("proposal_id", proposalId);
  if (!items) {
    await supabase.from("progression_proposals").update({ status: "pending" }).eq("id", proposalId).eq("user_id", user.id);
    return { ok: false, error: "That review is gone." };
  }

  const approved = new Set(approvedItemIds);
  let appliedItems = 0;
  let failedItems = 0;
  for (const it of items) {
    if (!approved.has(it.id as string)) continue;
    const coerced = coerceFieldValue(
      it.field as ProposalField,
      it.new_value as string
    );
    if (!coerced) continue;
    const { error: upErr } = await supabase
      .from("program_exercises")
      .update({ [coerced.column]: coerced.value })
      .eq("id", it.program_exercise_id as string)
      .eq("user_id", user.id);
    if (upErr) {
      console.error(`[applyProposal] item ${it.id}: ${upErr.message}`);
      failedItems++;
    } else appliedItems++;
  }
  if (failedItems) {
    // Leave it pending so the user can try again; say plainly what happened.
    await supabase.from("progression_proposals").update({ status: "pending" }).eq("id", proposalId).eq("user_id", user.id);
    return {
      ok: false,
      error: `${appliedItems} change${appliedItems === 1 ? "" : "s"} saved, ${failedItems} didn't. Try again.`,
    };
  }

  const { error: decErr } = await supabase
    .from("progression_proposals")
    .update({ status: appliedItems ? "approved" : "rejected", decided_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("user_id", user.id);
  if (decErr) return { ok: false, error: "Couldn't finalize the review." };

  // Deciding a review never starts a week by itself: the user picks
  // Repeat or Fresh separately (decision 4). `startNextWeek` is ignored.
  void startNextWeek;

  return { ok: true };
}


// ── Skip a day ──────────────────────────────────────────────────────────────
// Marks a planned training day as skipped for THIS week, with an optional note
// ("sick", "work ran late"). Nothing about the program changes; the weekly
// review reads skips + notes so the coach can adjust kindly.
export async function skipDay(programDayId: string, note?: string): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  if (typeof programDayId !== "string" || !programDayId)
    return { ok: false, error: "Pick a day to skip." };

  const tz = await getUserTz(supabase, user.id);
  const status = await getWeekStatus(supabase, user.id, tz);
  if (!status) return { ok: false, error: "No active program." };
  if (status.weekEnded) return { ok: false, error: "This week has ended. Start a new week first." };
  const day = status.days.find((d) => d.id === programDayId);
  if (!day) return { ok: false, error: "That day isn't in your current program. Refresh and try again." };
  if (day.type === "rest") return { ok: false, error: "Rest days don't need skipping." };
  if (!day.inWeek) return { ok: false, error: "That day isn't planned this week." };
  if (day.done) return { ok: false, error: "You already logged this day." };
  if (day.skipped) return { ok: true };

  // One line, no double quotes: the note is quoted inside the review prompt.
  const clean =
    typeof note === "string"
      ? note.replace(/[\r\n\t]+/g, " ").replace(/"/g, "'").trim().slice(0, 300)
      : "";
  const { error } = await supabase.from("day_skips").insert({
    user_id: user.id,
    program_id: status.program.id,
    program_day_id: programDayId,
    week_started_on: status.weekStartedOn,
    note: clean || null,
  });
  if (error && error.code === "23505") return { ok: true }; // already skipped (double tap)
  if (error) {
    console.error(`[skipDay] ${error.message}`);
    return { ok: false, error: "Couldn't skip that day. Try again." };
  }
  return { ok: true };
}

export async function undoSkip(skipId: string): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  if (typeof skipId !== "string" || !skipId) return { ok: false, error: "Nothing to undo." };
  const { error } = await supabase.from("day_skips").delete().eq("id", skipId).eq("user_id", user.id);
  if (error) {
    console.error(`[undoSkip] ${error.message}`);
    return { ok: false, error: "Couldn't undo the skip. Try again." };
  }
  return { ok: true };
}
