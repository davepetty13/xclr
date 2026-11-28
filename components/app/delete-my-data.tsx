"use client";

import { useEffect, useRef, useState } from "react";
import { deleteMyData } from "@/app/(app)/profile/actions";

// Profile → Your data → "Delete my data and leave Xclr", with an in-app typed
// confirm. Everything goes: logs, program, photos, Watch data, the account.
export function DeleteMyData() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setText("");
    setError(null);
    openerRef.current?.focus();
  }

  async function run() {
    if (busy || text.trim() !== "DELETE") return;
    setBusy(true);
    setError(null);
    try {
      const r = await deleteMyData(text);
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
      window.location.assign("/login");
    } catch {
      setError("That didn't go through. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="glass flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Remove everything you&apos;ve logged and your account.</p>
        {!open ? (
          <button
            ref={openerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            className="btn-secondary shrink-0 px-3 text-[13px] text-ember-text"
          >
            Delete my data
          </button>
        ) : null}
      </div>
      {open ? (
        <div role="group" aria-labelledby="del-h" className="flex flex-col gap-2 rounded-tile bg-field p-3">
          <p id="del-h" className="text-[13px] font-semibold text-ink">
            Delete my data and leave Xclr? Food, workouts, weight, sleep, Watch data, photos and coach chats are
            deleted for good. This can&apos;t be undone — download your data first if you want a copy.
          </p>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Type DELETE to confirm
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="field text-base font-semibold"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={close} disabled={busy} className="btn-secondary min-h-10 text-[13px]">
              Keep my data
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || text.trim() !== "DELETE"}
              className="btn-primary min-h-10 text-[13px]"
            >
              {busy ? "Deleting…" : "Delete and leave"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-xs font-semibold text-ember-text">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
