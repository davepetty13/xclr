"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { inviteMember, removeMember, setMemberLimit, setMemberPaused, type PeopleResult } from "@/app/(app)/profile/people/actions";
import { useFocusTrap } from "@/components/app/a11y";

export type PersonRow = {
  email: string;
  name: string;
  status: "owner" | "active" | "invited" | "paused";
  isYou: boolean;
  spend: number | null; // null = hasn't signed in yet
  limit: number;
};

const MARK: Record<PersonRow["status"], { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "mark-neutral" },
  active: { label: "Active", cls: "mark-green" },
  invited: { label: "Invited", cls: "mark-amber" },
  paused: { label: "Paused", cls: "bg-ember-soft text-ember-text" },
};

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

const APP_LINK = "xclr.vercel.app";

export function PeopleAdmin({
  rows,
  limitOptions,
  defaultLimit,
  full,
}: {
  rows: PersonRow[];
  limitOptions: number[];
  defaultLimit: number;
  full: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<PersonRow | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const r = await inviteMember(email).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection." }));
    setBusy(false);
    if (r.ok) {
      setEmail("");
      setMsg({ ok: true, text: r.message ?? "Added." });
      router.refresh();
    } else setMsg({ ok: false, text: r.error });
  }

  function closeSheet(result?: PeopleResult) {
    setOpen(null);
    if (result?.ok && result.message) setMsg({ ok: true, text: result.message });
    if (result) router.refresh();
    openerRef.current?.focus();
  }

  return (
    <>
      <form onSubmit={(e) => void invite(e)} className="glass flex flex-col gap-2 px-3.5 py-3" aria-labelledby="invite-h">
        <label id="invite-h" htmlFor="invite-email" className="text-xs font-bold text-muted">
          Invite a friend
        </label>
        <div className="flex gap-2">
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={254}
            placeholder="friend@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={full}
            className="field min-w-0 flex-1 bg-card text-[15px]"
          />
          <button type="submit" disabled={busy || full || !email.trim()} className="btn-primary btn-primary-green text-sm">
            {busy ? "Adding…" : "Invite"}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          {full
            ? "Xclr is full. Remove someone to invite another person."
            : `They sign in with this Google account. Send them ${APP_LINK} — nothing is emailed automatically.`}
        </p>
        <p aria-live="polite" className="text-xs font-semibold empty:hidden">
          {msg ? <span className={msg.ok ? "text-green" : "text-ember-text"}>{msg.text}</span> : null}
        </p>
      </form>

      <section aria-label="People on Xclr" className="glass px-3.5 py-0.5">
        <ul>
          {rows.map((p, i) => (
            <li
              key={p.email}
              className={`flex min-h-[60px] items-center gap-2.5 py-1.5 ${i < rows.length - 1 ? "border-b border-hairline" : ""}`}
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-soft text-sm font-bold uppercase text-green"
              >
                {p.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                  <span className={`mark ${MARK[p.status].cls} whitespace-nowrap !text-[10px]`}>{MARK[p.status].label}</span>
                </div>
                <p className="truncate text-[11px] text-muted">{p.isYou ? "you · owner" : p.email}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum font-display text-sm font-bold text-ink">{p.spend == null ? "—" : `$${p.spend.toFixed(2)}`}</p>
                <p className="text-[10px] text-muted">this month</p>
              </div>
              <button
                type="button"
                aria-label={`Options for ${p.name}`}
                onClick={(e) => {
                  openerRef.current = e.currentTarget;
                  setOpen(p);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-control-border bg-card text-ink"
              >
                ⋯
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="px-1 text-xs text-muted">
        New invites get {money(defaultLimit)} of AI a month. ⋯ lets you change one person&apos;s limit, pause them, or remove
        them (their data is deleted).
      </p>

      {open ? <PersonSheet person={open} limitOptions={limitOptions} onClose={closeSheet} /> : null}
    </>
  );
}

function PersonSheet({
  person,
  limitOptions,
  onClose,
}: {
  person: PersonRow;
  limitOptions: number[];
  onClose: (result?: PeopleResult) => void;
}) {
  const headingId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(String(person.limit));
  const [removing, setRemoving] = useState(false);
  const [confirm, setConfirm] = useState("");
  const isOwner = person.status === "owner";
  const options = limitOptions.includes(person.limit) ? limitOptions : [...limitOptions, person.limit].sort((a, b) => a - b);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);
  useFocusTrap(sheetRef, mounted);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  async function act(call: () => Promise<PeopleResult>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call().catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection." }));
    setBusy(false);
    if (r.ok) onClose(r);
    else setError(r.error);
  }

  if (!mounted) return null;
  return createPortal(
    <>
      <div aria-hidden="true" onClick={() => onClose()} className="fixed inset-0 z-30 bg-scrim" />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto !rounded-b-none px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-2.5"
      >
        <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-sm bg-line" />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="truncate font-display text-xl font-bold tracking-[-0.02em] text-ink">
              {person.name}
            </h2>
            <p className="truncate text-xs text-muted">{person.email}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onClose()}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-segment text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {isOwner ? (
          <p className="text-sm text-muted">That&apos;s you. The owner has no AI limit and can&apos;t be paused or removed.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Monthly AI limit for this person
              <div className="flex gap-2">
                <select
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  disabled={busy}
                  className="field min-w-0 flex-1 bg-card text-sm font-semibold"
                >
                  {options.map((o) => (
                    <option key={o} value={String(o)}>
                      {money(o)} a month
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || Number(limit) === person.limit}
                  onClick={() => void act(() => setMemberLimit(person.email, Number(limit)))}
                  className="btn-primary btn-primary-green text-sm"
                >
                  Save
                </button>
              </div>
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => setMemberPaused(person.email, person.status !== "paused"))}
              className="btn-secondary w-full text-sm"
            >
              {person.status === "paused" ? "Resume" : "Pause"}
            </button>
            <p className="-mt-1.5 text-[11px] text-muted">
              {person.status === "paused"
                ? "Resuming lets them open Xclr again. Their data was kept."
                : "Paused people can't open Xclr. Their data is kept."}
            </p>

            {!removing ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(true)}
                className="btn-secondary w-full text-sm text-ember-text"
              >
                Remove
              </button>
            ) : (
              <div role="group" aria-labelledby="remove-h" className="flex flex-col gap-2 rounded-tile bg-field p-3">
                <p id="remove-h" className="text-[13px] font-semibold text-ink">
                  Remove {person.name}? Their account and everything they logged is deleted for good, and they&apos;re
                  taken off the invite list.
                </p>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Type REMOVE to confirm
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    className="field bg-card text-base font-semibold"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRemoving(false)} disabled={busy} className="btn-secondary min-h-10 text-[13px]">
                    Keep them
                  </button>
                  <button
                    type="button"
                    disabled={busy || confirm.trim() !== "REMOVE"}
                    onClick={() => void act(() => removeMember(person.email, confirm))}
                    className="btn-primary min-h-10 text-[13px]"
                  >
                    {busy ? "Removing…" : "Remove for good"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error ? (
          <p role="alert" className="text-xs font-semibold text-ember-text">
            {error}
          </p>
        ) : null}
      </section>
    </>,
    document.body
  );
}
