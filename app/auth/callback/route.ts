import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Seed the profile row on first login only (ignoreDuplicates keeps
      // onboarding edits intact on subsequent logins).
      const meta = data.user.user_metadata;
      await supabase.from("profiles").upsert(
        {
          id: data.user.id,
          display_name: meta.full_name ?? meta.name ?? null,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
