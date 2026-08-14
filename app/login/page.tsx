"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);

  const signInWithGoogle = async () => {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setBusy(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-8 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
          Welcome to
        </p>
        <h1 className="mt-1 font-serif text-5xl font-medium tracking-tight">
          Xclr
        </h1>
        <p className="mt-3 text-sm font-medium text-muted">
          Your health, one place. Food, workouts, sleep — with a coach who
          remembers.
        </p>
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-8 w-full rounded-chip border border-line bg-paper px-4 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </main>
  );
}
