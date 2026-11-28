"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markNotificationsRead, runNotificationAction } from "@/app/(app)/profile/notifications/actions";
import { MEAL_KINDS, TRAINING_KINDS } from "@/lib/notify-prefs";
import { useFocusTrap } from "@/components/app/a11y";
import { isInternalPath } from "@/lib/safe-url";

export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  when: string; // "2:00 PM", "Yesterday", "Fri", …
  unread: boolean;
  action: { type: "log_library"; label: string } | { type: "link"; label: string; href: string } | null;
};

type Tab = "all" | "meals" | "training";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "meals", label: "Meals" },
  { key: "training", label: "Training" },
];

// Bell on Today + the inbox sheet. Every reminder lands here even when
// iPhone notifications are off.
export function NotifyBell({ items: initial }: { items: InboxItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<Tab>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const listId = useId();

  useEffect(() => setItems(initial), [initial]);

  const close = useCallback(() => {
    setOpen(false);
    bellRef.current?.focus();
  }, []);

  // Focus in, Escape closes (focus back on the bell), no page scroll behind.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);
  useFocusTrap(sheetRef, open);

  const unread = items.filter((i) => i.unread).length;
  const shown = items.filter((i) =>
    tab === "all" ? true : tab === "meals" ? MEAL_KINDS.has(i.kind) : TRAINING_KINDS.has(i.kind)
  );

  function markLocal(ids: string[] | "all") {
    setItems((list) => list.map((i) => (ids === "all" || ids.includes(i.id) ? { ...i, unread: false } : i)));
  }

  async function markAll() {
    markLocal("all");
    const r = await markNotificationsRead("all").catch(() => null);
    if (!r?.ok) setMsg({ text: "Couldn't update. Try again.", bad: true });
    else router.refresh();
  }

  function openItem(i: InboxItem) {
    if (i.unread) {
      markLocal([i.id]);
      void markNotificationsRead([i.id]).catch(() => null);
    }
    setOpen(false);
    if (isInternalPath(i.url)) router.push(i.url);
  }

  async function act(i: InboxItem) {
    if (busyId) return;
    setBusyId(i.id);
    setMsg(null);
    try {
      const r = await runNotificationAction(i.id);
      if (r.ok) {
        markLocal([i.id]);
        setMsg({ text: r.message });
        router.refresh();
      } else {
        markLocal([i.id]);
        setMsg({ text: r.error, bad: true });
      }
    } catch {
      setMsg({ text: "That didn't go through. Check your connection and try again.", bad: true });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        onClick={() => {
          setMsg(null);
          setOpen(true);
        }}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="dialog"
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-card text-ink shadow-[inset_0_0_0_1px_var(--hairline)]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread ? <span aria-hidden className="absolute right-[7px] top-1.5 h-2 w-2 rounded-full bg-ember-text" /> : null}
      </button>

      {open
        ? createPortal(
            <>
              <div aria-hidden="true" onClick={close} className="fixed inset-0 z-30 bg-scrim" />
              <section
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="inbox-h"
                className="pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[88dvh] w-full max-w-md flex-col gap-2 overflow-y-auto !rounded-b-none px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] pt-2.5"
              >
                <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-sm bg-line" />
                <div className="flex items-center justify-between gap-3">
                  <h2 id="inbox-h" className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
                    Notifications
                  </h2>
                  <div className="flex items-center gap-1">
                    {unread ? (
                      <button type="button" onClick={() => void markAll()} className="min-h-10 px-2 text-[13px] font-semibold text-green">
                        Mark all read
                      </button>
                    ) : null}
                    <button
                      ref={closeRef}
                      type="button"
                      onClick={close}
                      aria-label="Close"
                      className="flex h-10 w-10 items-center justify-center rounded-control bg-segment text-ink"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div role="tablist" aria-label="Show" className="flex gap-5 border-b border-hairline">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.key}
                      aria-controls={listId}
                      onClick={() => setTab(t.key)}
                      className="tab"
                    >
                      {t.label}
                      {t.key === "all" && unread ? <span className="tnum text-[11px] font-bold text-ember-text">{unread}</span> : null}
                    </button>
                  ))}
                </div>

                {shown.length === 0 ? (
                  <p id={listId} className="py-6 text-center text-sm text-muted">
                    {items.length ? "Nothing here." : "No reminders yet. They show up here, even if phone notifications are off."}
                  </p>
                ) : (
                  <ul id={listId} className="flex flex-col">
                    {shown.map((i) => (
                      <li key={i.id} className="flex gap-2.5 border-b border-hairline py-2.5 last:border-b-0">
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.unread ? "bg-ember-text" : "bg-transparent"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => openItem(i)} className="block w-full min-h-10 text-left">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className={`text-sm text-ink ${i.unread ? "font-bold" : "font-semibold"}`}>
                                {i.unread ? <span className="sr-only">New: </span> : null}
                                {i.title}
                              </span>
                              <span className="tnum shrink-0 text-[11px] text-muted">{i.when}</span>
                            </span>
                            {i.body ? <span className="mt-0.5 block text-[13px] text-muted">{i.body}</span> : null}
                          </button>
                          {i.action?.type === "log_library" ? (
                            <button
                              type="button"
                              disabled={busyId != null}
                              onClick={() => void act(i)}
                              className="btn-primary btn-primary-green mt-1.5 min-h-10 px-3 text-xs"
                            >
                              {busyId === i.id ? "Logging…" : i.action.label}
                            </button>
                          ) : i.action?.type === "link" ? (
                            <button
                              type="button"
                              onClick={() => openItem({ ...i, url: i.action && i.action.type === "link" ? i.action.href : i.url })}
                              className="btn-primary btn-primary-green mt-1.5 min-h-10 px-3 text-xs"
                            >
                              {i.action.label}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <p aria-live="polite" className="text-xs font-semibold empty:hidden">
                  {msg ? <span className={msg.bad ? "text-ember-text" : "text-green"}>{msg.text}</span> : null}
                </p>
                <Link href="/profile/notifications" onClick={() => setOpen(false)} className="btn-secondary text-[13px]">
                  Notification settings
                </Link>
              </section>
            </>,
            document.body
          )
        : null}
    </>
  );
}
