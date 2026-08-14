import type { createClient } from "@/lib/supabase/server";

type Supa = ReturnType<typeof createClient>;

export type ProgramRow = {
  id: string;
  name: string | null;
  goal: string | null;
  active: boolean;
};

// The user's current active program, if any (newest wins). RLS scopes the query
// to the caller, and we also filter by user_id explicitly.
export async function getActiveProgram(
  supabase: Supa,
  userId: string
): Promise<ProgramRow | null> {
  const { data } = await supabase
    .from("programs")
    .select("id, name, goal, active")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ProgramRow | null) ?? null;
}

export async function hasActiveProgram(
  supabase: Supa,
  userId: string
): Promise<boolean> {
  return (await getActiveProgram(supabase, userId)) != null;
}
