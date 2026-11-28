"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Signs out, then opens Google's account chooser (prompt=select_account), so
// the next sign-in can use a different Google account.
export function SwitchAccountButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => undefined);
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (oauthErr) {
      setBusy(false);
      setError("Couldn't open Google sign-in. Try again.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => void run()} disabled={busy} className="btn-secondary min-h-[50px] w-full text-[15px] font-bold">
        {busy ? "Opening Google…" : "Try a different Google account"}
      </button>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-ember-text">
          {error}
        </p>
      ) : null}
    </>
  );
}
