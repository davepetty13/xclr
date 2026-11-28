import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalPath } from "@/lib/safe-url";
import { isEmail, normEmail } from "@/lib/access";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-site paths: "/x" yes; "//evil.com", "/\\evil", "@evil.com" no.
  const raw = searchParams.get("next");
  const next = isInternalPath(raw) ? raw : "/";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const user = data.user;
      const email = normEmail(user.email);
      const admin = createAdminClient();

      // Invite-only gate (app_members, migration 010).
      const cols = "email, role, status, user_id";
      let { data: member, error: mErr } = await admin
        .from("app_members")
        .select(cols)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!member && !mErr && email) {
        ({ data: member, error: mErr } = await admin
          .from("app_members")
          .select(cols)
          .eq("email", email)
          .maybeSingle());
      }
      if (mErr) {
        console.error(`[auth/callback] member lookup failed: ${mErr.message}`);
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=auth`);
      }

      if (!member || (member.role !== "owner" && member.status === "paused")) {
        await supabase.auth.signOut();
        if (!member) {
          // A stranger: if Xclr holds nothing for this account, remove the
          // auth user Supabase just made, so nothing about them is saved.
          const { data: prof } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
          if (!prof) {
            const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
            if (delErr) console.error(`[auth/callback] delete stranger failed: ${delErr.message}`);
          }
        }
        const qs = new URLSearchParams();
        if (email && isEmail(email)) qs.set("e", email);
        if (member) qs.set("p", "1");
        const q = qs.toString() ? `?${qs.toString()}` : "";
        return NextResponse.redirect(`${origin}/not-invited${q}`);
      }

      // First sign-in of an invite → active and linked to this auth user.
      if (member.status === "invited" || !member.user_id) {
        const { error: upErr } = await admin
          .from("app_members")
          .update({
            user_id: user.id,
            ...(member.status === "invited" ? { status: "active", joined_at: new Date().toISOString() } : {}),
          })
          .eq("email", member.email as string);
        if (upErr) console.error(`[auth/callback] activate invite failed: ${upErr.message}`);
      }

      // Seed the profile row on first login only (ignoreDuplicates keeps
      // onboarding edits intact on subsequent logins). privacy_accepted_at
      // stays null here, so /welcome shows once before onboarding.
      const meta = user.user_metadata;
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          display_name: meta.full_name ?? meta.name ?? null,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
