import { createClient } from "@/lib/supabase/server";
import { FoodTab } from "@/components/app/food-tab";
import { getUserTz } from "@/lib/goal-change";
import { todayWindow } from "@/lib/time";
import { getCurrentUser } from "@/lib/session";

export default async function FoodPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  // Local midnight in the user's timezone (not UTC — that reset at 8 AM Manila).
  const tz = await getUserTz(supabase, user.id);
  const win = todayWindow(tz);

  const { data: profile } = await supabase
    .from("profiles")
    .select("daily_calorie_target, daily_protein_target")
    .eq("id", user.id)
    .maybeSingle();

  const { data: foods, error: foodsError } = await supabase
    .from("food_logs")
    .select("id, name, serving, meal, kcal, protein_g, carbs_g, fat_g, is_estimate")
    .eq("user_id", user.id)
    .gte("logged_at", win.start)
    .order("logged_at", { ascending: true });

  const { data: library } = await supabase
    .from("food_library")
    .select("id, name, serving, kcal, protein_g")
    .eq("user_id", user.id)
    .order("times_logged", { ascending: false })
    .limit(12);

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });

  return (
    <FoodTab
      dateLabel={dateLabel}
      loadError={!!foodsError}
      calTarget={Number(profile?.daily_calorie_target) || 2200}
      proteinTarget={Number(profile?.daily_protein_target) || 150}
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
