"use server";

// Approve / reject a change the coach proposed (from chat or a photo).
// AI proposes, the user approves: nothing in pending_changes touches the
// profile or health notes until one of these runs from a tap.
//
// Payload contracts:
//   goal   → TargetPreview (lib/goal-change) + { goal_weight_kg: number | null }
//   health → { condition: string, notes: string | null, action: "add"|"update"|"resolve" }

import { createClient } from "@/lib/supabase/server";
import { applyGoalChange, isGoal, type TargetPreview } from "@/lib/goal-change";
import { patchCard, type CardRef } from "@/lib/chat-library";

export type DecideResult =
  | { ok: true; programChanges: boolean }
  | { ok: false; error: string };

type Supa = ReturnType<typeof createClient>;

async function applyHealth(
  supabase: Supa,
  userId: string,
  payload: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("health_data_consent_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.health_data_consent_at)
    return { ok: false, error: "Health notes need your consent first — turn it on in your profile." };

  const condition = typeof payload.condition === "string" ? payload.condition.trim().slice(0, 200) : "";
  if (!condition) return { ok: false, error: "That health note is empty." };
  const notes = typeof payload.notes === "string" && payload.notes.trim() ? payload.notes.trim().slice(0, 1000) : null;
  const action = payload.action === "update" || payload.action === "resolve" ? payload.action : "add";
  const now = new Date().toISOString();

  // Find an existing active note with the same name (case-insensitive).
  const { data: existing } = await supabase
    .from("medical_conditions")
    .select("id, notes")
    .eq("user_id", userId)
    .eq("active", true)
    .ilike("condition", condition.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();

  if (action === "resolve") {
    if (!existing) return { ok: false, error: `Couldn't find "${condition}" in your health notes.` };
    const { error } = await supabase
      .from("medical_conditions")
      .update({ active: false, updated_at: now })
      .eq("id", existing.id as string)
      .eq("user_id", userId);
    if (error) {
      console.error(`[pending health resolve] ${error.message}`);
      return { ok: false, error: "Couldn't update your health notes." };
    }
    return { ok: true };
  }

  if (existing) {
    const { error } = await supabase
      .from("medical_conditions")
      .update({ notes: notes ?? (existing.notes as string | null) ?? null, updated_at: now })
      .eq("id", existing.id as string)
      .eq("user_id", userId);
    if (error) {
      console.error(`[pending health update] ${error.message}`);
      return { ok: false, error: "Couldn't update your health notes." };
    }
    return { ok: true };
  }

  const { error } = await supabase.from("medical_conditions").insert({
    user_id: userId,
    condition,
    notes,
    active: true,
    source: "chat",
    updated_at: now,
  });
  if (error) {
    console.error(`[pending health insert] ${error.message}`);
    return { ok: false, error: "Couldn't save to your health notes." };
  }
  return { ok: true };
}

export async function approvePendingChange(id: string, ref?: CardRef | null): Promise<DecideResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in again." };

  const { data: row } = await supabase
    .from("pending_changes")
    .select("id, kind, payload, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That change is gone." };
  if (row.status !== "pending")
    return { ok: false, error: row.status === "approved" ? "Already approved." : "That change was skipped." };

  // Claim it first so a double tap can't apply twice.
  const { data: claimed } = await supabase
    .from("pending_changes")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "That change was already handled." };

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  let result: { ok: true } | { ok: false; error: string };
  let programChanges = false;

  if (row.kind === "goal") {
    const preview = payload as unknown as TargetPreview & { goal_weight_kg?: number | null };
    const to = preview?.to;
    if (!to || !isGoal(to.goal)) {
      result = { ok: false, error: "That goal change looks broken." };
    } else {
      programChanges = !!preview.programChanges;
      result = await applyGoalChange(supabase, user.id, {
        goal: to.goal,
        kcal: Number(to.kcal),
        protein: Number(to.protein),
        goal_weight_kg: typeof preview.goal_weight_kg === "number" ? preview.goal_weight_kg : undefined,
      });
    }
  } else if (row.kind === "health") {
    result = await applyHealth(supabase, user.id, payload);
  } else {
    result = { ok: false, error: "That kind of change isn't supported yet." };
  }

  if (!result.ok) {
    // Put it back so the user can try again; nothing was applied.
    await supabase
      .from("pending_changes")
      .update({ status: "pending", decided_at: null })
      .eq("id", id)
      .eq("user_id", user.id);
    return result;
  }

  await patchCard(supabase, user.id, ref, { status: "approved" });
  return { ok: true, programChanges };
}

export async function rejectPendingChange(id: string, ref?: CardRef | null): Promise<DecideResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in again." };

  const { data, error } = await supabase
    .from("pending_changes")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error(`[pending reject] ${error.message}`);
    return { ok: false, error: "Couldn't skip that. Try again." };
  }
  if (!data?.length) return { ok: false, error: "That change was already handled." };

  await patchCard(supabase, user.id, ref, { status: "rejected" });
  return { ok: true, programChanges: false };
}
