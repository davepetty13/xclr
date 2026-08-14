import { createClient } from "@/lib/supabase/server";
import { FoodTab } from "@/components/app/food-tab";

function startOfTodayISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function FoodPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: foods } = await supabase
    .from("food_logs")
    .select("id, name, serving, meal, kcal, protein_g, carbs_g, fat_g, is_estimate")
    .eq("user_id", user.id)
    .gte("logged_at", startOfTodayISO())
    .order("logged_at", { ascending: true });

  const { data: library } = await supabase
    .from("food_library")
    .select("id, name, serving, kcal, protein_g")
    .eq("user_id", user.id)
    .order("times_logged", { ascending: false })
    .limit(12);

  return (
    <FoodTab
      foods={(foods ?? []).map((f) => ({
        id: f.id as string,
        name: f.name as string,
        serving: (f.serving as string | null) ?? null,
        meal: (f.meal as string | null) ?? null,
        kcal: (f.kcal as number | null) ?? null,
        protein_g: (f.protein_g as number | null) ?? null,
        carbs_g: (f.carbs_g as number | null) ?? null,
        fat_g: (f.fat_g as number | null) ?? null,
        is_estimate: (f.is_estimate as boolean) ?? true,
      }))}
      library={(library ?? []).map((l) => ({
        id: l.id as string,
        name: l.name as string,
        serving: (l.serving as string | null) ?? null,
        kcal: (l.kcal as number | null) ?? null,
        protein_g: (l.protein_g as number | null) ?? null,
      }))}
    />
  );
}
