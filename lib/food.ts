import type { createClient } from "@/lib/supabase/server";

type Supa = ReturnType<typeof createClient>;

export type FoodMacros = {
  name: string;
  serving: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

// Upsert into the personal food library (the accuracy engine). The unique index
// is on lower(name) — an expression index PostgREST can't target via onConflict —
// so we select-then-insert/update by case-insensitive name instead.
export async function upsertFoodLibrary(
  supabase: Supa,
  userId: string,
  m: FoodMacros
): Promise<void> {
  const name = m.name.trim();
  if (!name) return;
  const { data: existing } = await supabase
    .from("food_library")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("food_library")
      .update({
        serving: m.serving,
        kcal: m.kcal,
        protein_g: m.protein_g,
        carbs_g: m.carbs_g,
        fat_g: m.fat_g,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
  } else {
    await supabase.from("food_library").insert({
      user_id: userId,
      name,
      serving: m.serving,
      kcal: m.kcal,
      protein_g: m.protein_g,
      carbs_g: m.carbs_g,
      fat_g: m.fat_g,
    });
  }
}
