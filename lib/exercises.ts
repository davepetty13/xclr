import type { createClient } from "@/lib/supabase/server";

type Supa = ReturnType<typeof createClient>;

// Resolve exercise names → ids for a user, inserting any that don't exist yet.
// Names are unique per user, case-insensitive (exercises_uniq on lower(name)).
// Returns a map keyed by lowercased name.
export async function resolveExerciseIds(
  supabase: Supa,
  userId: string,
  wanted: { name: string; category?: string | null }[]
): Promise<Map<string, string>> {
  const byLower = new Map<string, { name: string; category: string | null }>();
  for (const w of wanted) {
    const lo = w.name.toLowerCase();
    if (!byLower.has(lo)) byLower.set(lo, { name: w.name, category: w.category ?? null });
  }

  const idByLower = new Map<string, string>();
  const { data: existing } = await supabase
    .from("exercises")
    .select("id, name")
    .eq("user_id", userId);
  for (const row of existing ?? [])
    idByLower.set((row.name as string).toLowerCase(), row.id as string);

  const missing = Array.from(byLower.entries()).filter(([lo]) => !idByLower.has(lo));
  if (missing.length) {
    const { data: inserted } = await supabase
      .from("exercises")
      .insert(missing.map(([, v]) => ({ user_id: userId, name: v.name, category: v.category })))
      .select("id, name");
    for (const row of inserted ?? [])
      idByLower.set((row.name as string).toLowerCase(), row.id as string);
  }
  return idByLower;
}
