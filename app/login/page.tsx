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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-sm p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Welcome to
        </p>
        <h1 className="mt-1 font-display text-5xl font-bold tracking-[-0.02em] text-ink">
          Xclr
        </h1>
        <p className="mt-3 text-sm font-medium text-muted">
          Your health, one place. Food, workouts, sleep — with a coach who
          remembers.
        </p>
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="btn-primary mt-8 w-full text-sm"
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </main>
  );
}
