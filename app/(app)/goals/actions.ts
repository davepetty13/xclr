"use server";

import { createClient } from "@/lib/supabase/server";

export type SimpleResult = { ok: true } | { ok: false; error: string };

// Units preference is display-only (Spec §6) — stored weights stay in kg.
export async function setWeightUnit(unit: "kg" | "lbs"): Promise<SimpleResult> {
  if (unit !== "kg" && unit !== "lbs")
    return { ok: false, error: "Unknown unit." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };
  const { error } = await supabase
    .from("profiles")
    .update({ weight_unit: unit, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't update your preference." };
  return { ok: true };
}
