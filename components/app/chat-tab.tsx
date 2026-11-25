"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logFromLibrary, sendChatMessage, type ChatMode, type ChatResult } from "@/app/(app)/chat/actions";
import { ChatCards, type WeightUnit } from "@/components/app/chat-cards";
import type { ChatCard } from "@/lib/chat-library";

export type Msg =
  | { role: "user"; text: string }
  | { role: "coach"; id: string | null; text: string; cards: ChatCard[] };

export type QuickChip = { id: string; label: string };

export function ChatTab({
  userId,
  coachName,
  firstName,
  quickChips,
  initialMessages = [],
  today,
  initialTotals,
  unit = "kg",
}: {
  userId: string;
  coachName: string;
  firstName: string;
  quickChips: QuickChip[];
  initialMessages?: Msg[];
  today: string;
  initialTotals: { kcal: number; protein: number };
  unit?: WeightUnit;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("log");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState(initialTotals);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Server totals win after a refresh (e.g. an Undo on a card).
  useEffect(() => {
    setTotals(initialTotals);
  }, [initialTotals.kcal, initialTotals.protein]); // eslint-disable-line react-hooks/exhaustive-deps

  // Composer draft survives a mobile reload / tab switch until sent.
  const draftKey = `xclr-draft-chat-${userId}`;
  const persistReady = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) setInput(raw);
    } catch {
      // ignore
    }
  }, [draftKey]);

  useEffect(() => {
    if (!persistReady.current) {
      persistReady.current = true;
      return;
    }
    try {
      if (input) localStorage.setItem(draftKey, input);
      else localStorage.removeItem(draftKey);
    } catch {
      // storage unavailable — non-fatal
    }
  }, [draftKey, input]);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, []);

  function scrollDown() {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function run(userText: string, call: () => Promise<ChatResult>) {
    setError(null);
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setBusy(true);
    scrollDown();
    let result: ChatResult;
    try {
      result = await call();
    } catch (err) {
      // The server action itself failed (function timeout / 5xx / dropped
      // connection) — surface it instead of leaving the chat hanging.
      console.error("[chat] action failed", err);
      setBusy(false);
      setError(
        "That took too long and didn't finish. Check Today before resending — your entry may already be logged."
      );
      return;
    }
    setBusy(false);
    if (result.ok) {
      setMessages((m) => [
        ...m,
        { role: "coach", id: result.messageId, text: result.reply, cards: result.cards },
      ]);
      setTotals({ kcal: result.kcal_today, protein: result.protein_today });
      router.refresh();
      scrollDown();
    } else {
      setError(result.error);
    }
  }

  function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    void run(clean, () => sendChatMessage(clean, mode));
  }

  function logChip(chip: QuickChip) {
    if (busy) return;
    void run(chip.label, () => logFromLibrary(chip.id, null));
  }

  return (
    <main className="flex min-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] flex-col">
      <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">{coachName}</h1>
          <p className="mt-0.5 text-xs text-muted">Logs save instantly. Questions go to your coach.</p>
        </div>
        <span className="mark mark-neutral tnum mt-1 shrink-0">
          {Math.round(totals.kcal).toLocaleString("en-US")} kcal · {Math.round(totals.protein)} g P
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-1.5">
        {messages.length === 0 ? (
          <div className="glass p-4">
            <p className="text-sm font-medium text-ink">
              Hey {firstName}, tell me what you ate, your weight, or how you slept, in plain words.
            </p>
            <p className="mt-1 text-sm text-muted">
              e.g. &ldquo;weight 71.75, brunch: 1 cup adobo and 2 eggs&rdquo;. Switch to Ask for questions.
            </p>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[78%] whitespace-pre-wrap rounded-[18px_18px_6px_18px] bg-ink px-3.5 py-2.5 text-sm text-card">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2.5">
              <ChatCards cards={m.cards} messageId={m.id} today={today} unit={unit} />
              {m.text ? (
                <div className="glass max-w-[86%] self-start !rounded-[18px_18px_18px_6px] px-3.5 py-2.5 text-sm leading-[1.45] text-ink shadow-[inset_3px_0_0_var(--green),var(--shadow-card)]">
                  <p className="mb-0.5 text-[11px] font-bold text-green">{coachName}</p>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ) : null}
            </div>
          )
        )}
        {busy ? (
          <div className="flex justify-start" aria-live="polite">
            <p className="glass !rounded-[18px_18px_18px_6px] px-3.5 py-2.5 text-sm font-medium text-muted">
              {coachName} is on it…
            </p>
          </div>
        ) : null}
        <div ref={endRef} />

        {error ? (
          <p role="alert" className="pop px-4 py-3 text-sm font-medium text-ink shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]">
            {error}
          </p>
        ) : null}
      </div>

      {/* Composer: solid bar pinned right above the bottom nav (nav is h-20 + safe area). */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 bg-card px-4 py-2.5 shadow-[0_-1px_0_var(--hairline)]">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {quickChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              disabled={busy}
              onClick={() => logChip(chip)}
              aria-label={`Log ${chip.label}`}
              className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-control-border bg-card px-2.5 text-xs font-semibold text-ink disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setMode("log");
              setInput("weight ");
              inputRef.current?.focus();
            }}
            className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-control-border bg-card px-2.5 text-xs font-semibold text-ink"
          >
            Weight
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2"
        >
          <div role="radiogroup" aria-label="Message type" className="flex shrink-0 rounded-control bg-segment p-0.5">
            {(["log", "ask"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-[44px] rounded-lg px-3 text-xs transition-colors ${
                  mode === m ? "bg-ink font-bold text-card" : "font-semibold text-muted"
                }`}
              >
                {m === "log" ? "Log" : "Ask"}
              </button>
            ))}
          </div>
          <Link
            href="/photo"
            aria-label="Add a photo"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-control-border bg-card text-ink"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </Link>
          <label className="field flex min-w-0 flex-1 items-center gap-1 !pl-3 !pr-0.5 focus-within:border-green">
            <span className="sr-only">Message</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "log" ? "What did you eat?" : "Ask your coach anything"}
              className="tnum min-h-[42px] min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={busy || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] bg-green text-card disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </label>
        </form>
      </div>
    </main>
  );
}
