"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage, type FoodCard } from "@/app/(app)/chat/actions";

type Msg =
  | { role: "user"; text: string }
  | { role: "coach"; text: string; cards: FoodCard[] };

export function ChatTab({
  coachName,
  firstName,
  quickChips,
}: {
  coachName: string;
  firstName: string;
  quickChips: string[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<{ kcal: number; protein: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: clean }]);
    setBusy(true);
    const result = await sendChatMessage(clean);
    setBusy(false);
    if (result.ok) {
      setMessages((m) => [
        ...m,
        { role: "coach", text: result.reply, cards: result.cards },
      ]);
      setTotals({ kcal: result.kcal_today, protein: result.protein_today });
      // Refresh Today/Food data behind the scenes.
      router.refresh();
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    } else {
      setError(result.error);
    }
  }

  return (
    <main className="flex min-h-screen flex-col px-5 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-ink">
          {coachName}
        </h1>
        {totals ? (
          <span className="tnum text-xs font-semibold text-muted">
            {Math.round(totals.kcal)} kcal · {Math.round(totals.protein)}g P today
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex-1 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-tile border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">
              Hey {firstName} — tell me what you ate, your weight, or how you
              slept, in plain words.
            </p>
            <p className="mt-1 text-sm text-muted">
              e.g. &ldquo;today weight 71.75, brunch: 1 cup adobo and 2
              eggs&rdquo;
            </p>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[80%] rounded-tile bg-ink px-4 py-2.5 text-sm font-medium text-paper">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.cards.length ? (
                <div className="rounded-tile border border-line bg-card p-3">
                  <ul className="space-y-1.5">
                    {m.cards.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="text-sm font-medium text-ink">
                          {c.name}
                          {c.serving ? (
                            <span className="text-muted"> · {c.serving}</span>
                          ) : null}
                          {c.is_estimate ? (
                            <span className="ml-1 rounded-chip bg-green-soft px-1.5 py-0.5 text-[10px] font-semibold text-green">
                              est
                            </span>
                          ) : null}
                        </span>
                        <span className="tnum shrink-0 text-sm text-muted">
                          {c.protein_g != null ? `P${Math.round(c.protein_g)} · ` : ""}
                          {c.kcal != null ? `${Math.round(c.kcal)} kcal` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex justify-start">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-tile border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink">
                  {m.text}
                </p>
              </div>
            </div>
          )
        )}
        {busy ? (
          <div className="flex justify-start">
            <p className="rounded-tile border border-line bg-card px-4 py-2.5 text-sm font-medium text-faint">
              {coachName} is thinking…
            </p>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-chip border border-ember bg-ember-soft px-4 py-3 text-sm font-medium text-ink"
        >
          {error}
        </p>
      ) : null}

      {quickChips.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {quickChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setInput(chip)}
              className="rounded-chip border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-opacity hover:opacity-80"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Log or ask anything…"
          className="tnum flex-1 rounded-chip border border-line bg-card px-4 py-3 text-sm font-medium text-ink outline-none placeholder:text-faint focus:border-green"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-chip bg-green px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
