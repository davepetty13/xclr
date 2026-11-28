import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteSelf } from "@/lib/delete-user";

// POST /leave/delete — "Delete my data and leave Xclr" for a paused member
// (middleware lets paused people reach only /leave and this route). Does one
// thing: deletes the signed-in person's own data. Same-origin JSON only.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "You're signed out — please sign in again." }, { status: 401 });

  const r = await deleteSelf(user, confirm);
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  await supabase.auth.signOut().catch(() => undefined);
  return NextResponse.json({ ok: true });
}
