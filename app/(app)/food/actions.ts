"use server";

import { createClient } from "@/lib/supabase/server";
import { upsertFoodLibrary } from "@/lib/food";
import { MEALS } from "@/lib/parse-schema";

export type SimpleResult = { ok: true } | { ok: false; error: string };

function cleanMeal(meal: string | null): string | null {
  return meal && MEALS.includes(meal as (typeof MEALS)[number]) ? meal : null;
}
function nnum(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v >= 0 ? v : null;
}

// Tap-to-edit: correct a logged food. Confirming an edit marks it non-estimate
// AND upserts the confirmed numbers into the personal library, so future logs
// of the same dish use the user's own values (Spec §7 food_library).
export async function saveFoodEdit(
  id: string,
  patch: {
    name: string;
    serving: string | null;
    meal: string | null;
    kcal: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  }
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const name = (patch.name ?? "").trim();
  if (!name) return { ok: false, error: "Give the food a name." };

  const macros = {
    name,
    serving: patch.serving?.trim() || null,
    kcal: nnum(patch.kcal),
    protein_g: nnum(patch.protein_g),
    carbs_g: nnum(patch.carbs_g),
    fat_g: nnum(patch.fat_g),
  };

  const { error } = await supabase
    .from("food_logs")
    .update({
      ...macros,
      meal: cleanMeal(patch.meal),
      is_estimate: false,
      source: "manual",
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't save that edit." };

  await upsertFoodLibrary(supabase, user.id, macros);
  return { ok: true };
}

export async function removeFoodLog(id: string): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const { error } = await supabase
    .from("food_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't remove that." };
  return { ok: true };
}

// Quick-add a dish from the personal library into today's log.
export async function quickAddFromLibrary(
  libraryId: string,
  meal: string | null
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const { data: lib } = await supabase
    .from("food_library")
    .select("name, serving, kcal, protein_g, carbs_g, fat_g, times_logged")
    .eq("id", libraryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!lib) return { ok: false, error: "That dish is gone." };

  const { error } = await supabase.from("food_logs").insert({
    user_id: user.id,
    logged_at: new Date().toISOString(),
    meal: cleanMeal(meal),
    name: lib.name as string,
    serving: (lib.serving as string | null) ?? null,
    kcal: lib.kcal as number | null,
    protein_g: lib.protein_g as number | null,
    carbs_g: lib.carbs_g as number | null,
    fat_g: lib.fat_g as number | null,
    source: "library",
    is_estimate: false,
  });
  if (error) return { ok: false, error: "Couldn't add that." };

  await supabase
    .from("food_library")
    .update({ times_logged: ((lib.times_logged as number) ?? 1) + 1 })
    .eq("id", libraryId);
  return { ok: true };
}
