import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // /api/cron/* is called by Vercel Cron / Supabase pg_cron without a session;
  // each route checks its own CRON_SECRET bearer token. /api/health/sync is
  // called by an iPhone Shortcut and checks its own sync-link token.
  const isPublic =
    path === "/login" ||
    path === "/not-invited" ||
    path.startsWith("/auth/") ||
    path === "/api/cron/photo-cleanup" ||
    path === "/api/cron/notify" ||
    path === "/api/health/sync";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Invite-only: a signed-in user must be the owner or an active member
  // (app_members, migration 010). Read through RLS — a user can only see their
  // own row — so this is one small query per request and needs no secret key.
  // Paused / removed people lose access on their very next request.
  if (user && !isPublic) {
    const { data: rows, error } = await supabase
      .from("app_members")
      .select("role, status")
      .limit(1);
    if (error) {
      // Fail open on a database hiccup so the owner isn't locked out by a
      // blip; every AI call still requires a member row (lib/ai-limit.ts).
      console.error(`[middleware] member check failed: ${error.message}`);
    } else {
      const row = rows?.[0];
      const allowed = !!row && (row.role === "owner" || row.status === "active");
      if (!allowed) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return NextResponse.json({ error: "Not invited" }, { status: 403 });
        }
        const url = request.nextUrl.clone();
        url.pathname = "/not-invited";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Icons, the web-app manifest and the service worker must load without a
    // session (iPhone fetches them on its own, signed out), so they skip the
    // sign-in check.
    "/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|apple-touch-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
