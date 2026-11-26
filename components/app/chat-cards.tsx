"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addPastFoods,
  saveFoodToLibrary,
  undoFoodFix,
  undoFoodLogs,
  undoSleep,
  undoWeight,
} from "@/app/(app)/chat/actions";
import { approvePendingChange, rejectPendingChange } from "@/lib/pending-changes";
import { fmtInt, mealLabel, type CardFood, type CardRef, type ChatCard } from "@/lib/chat-library";
import { GOAL_LABEL } from "@/lib/goal-change";
import { addDays, prettyDate } from "@/lib/time";
import { kgToLbs } from "@/lib/units";

export type WeightUnit = "kg" | "lbs";

// Storage is always kg; show the user's unit with 2 decimals.
function showWeight(kg: number, unit: WeightUnit): string {
  return `${(unit === "lbs" ? kgToLbs(kg) : kg).toFixed(2)} ${unit}`;
}

// In-card buttons: btn-primary/btn-secondary already give the 44px minimum height.
const BTN_PRIMARY = "btn-primary btn-primary-green px-3 text-xs";
const BTN_APPROVE = "btn-primary px-3 text-xs"; // ember edge: a change that needs your OK
const BTN_SECONDARY = "btn-secondary px-3 text-xs";
const CARD = "glass flex w-[90%] flex-col gap-1.5 self-start !rounded-tile px-3.5 py-3";
// Small saved/undone confirmation (weight, sleep).
const STATUS = "flex max-w-[90%] flex-col self-start rounded-[14px] bg-green-soft px-3 py-2";
const TITLE = "text-[13px] font-bold text-ink";
const UNDO = "min-h-11 shrink-0 rounded-lg px-2 text-xs font-bold text-ink underline disabled:opacity-50";

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-green"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function dayWord(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  return prettyDate(date);
}

function signed(n: number, unit: WeightUnit = "kg"): string {
  const v = Math.abs(unit === "lbs" ? kgToLbs(n) : n).toFixed(2);
  return n < 0 ? `−${v}` : n > 0 ? `+${v}` : "±0.00";
}

function sleepText(min: number | null, quality: number | null): string {
  const parts: string[] = [];
  if (min != null) parts.push(`${Math.floor(min / 60)} h ${min % 60} m`);
  if (quality != null) parts.push(`quality ${quality}/5`);
  return parts.join(" · ") || "saved";
}

function FoodRows({ items }: { items: CardFood[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((f, i) => (
        <li key={f.id ?? i} className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink">
            {f.name}
            {f.serving ? <span>, {f.serving}</span> : null}
          </span>
          <span className="tnum shrink-0 text-[13px] text-muted">
            {f.kcal != null ? fmtInt(f.kcal) : "—"}
            {f.protein_g != null ? ` · P${Math.round(f.protein_g)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        onOk();
        router.refresh();
      } else setError(r.error ?? "That didn't work. Try again.");
    } catch (err) {
      console.error("[chat card action]", err);
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function CardError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-1 text-sm font-medium text-ember-text">
      {error}
    </p>
  ) : null;
}

function FoodCardView({ card, cref }: { card: Extract<ChatCard, { kind: "food" }>; cref: CardRef | null }) {
  const [status, setStatus] = useState(card.status);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const { busy, error, run } = useAction();
  const meal = mealLabel(card.meal);
  const estimate = card.items.some((f) => f.is_estimate);
  const ids = card.items.map((f) => f.id).filter((x): x is string => !!x);
  const toSave = card.items.filter((f) => f.is_estimate && !f.library_id && f.id);

  return (
    <section aria-label={meal ? `Logged ${meal}` : "Logged food"} className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <span className={TITLE}>
          {status === "undone" ? "Removed" : `Logged${meal ? ` · ${meal}` : ""}`}
        </span>
        <span
          className={`mark ${card.via === "library" ? "mark-green" : estimate ? "mark-amber" : "mark-neutral"}`}
        >
          {card.via === "library" ? "Library · no AI" : estimate ? "Quick parse · estimate" : "Quick parse"}
        </span>
      </div>
      <div className={status === "undone" ? "opacity-50 line-through" : ""}>
        <FoodRows items={card.items} />
      </div>
      {status === "logged" ? (
        <>
          <p className="tnum border-t border-hairline pt-1.5 text-xs text-muted">
            Today <strong className="font-display text-ink">{fmtInt(card.kcal_today)}</strong> kcal ·{" "}
            <strong className="font-display text-ink">{fmtInt(card.protein_today)}</strong> g protein
          </p>
          <div className="mt-0.5 flex flex-wrap gap-2">
            {toSave.map((f) =>
              saved[f.id!] ? (
                <span key={f.id} className="flex min-h-9 items-center text-xs font-bold text-green">
                  {toSave.length > 1 ? `${f.name} saved to library` : "Saved to library"}
                </span>
              ) : (
                <button
                  key={f.id}
                  type="button"
                  disabled={busy}
                  className={BTN_PRIMARY}
                  onClick={() =>
                    run(
                      () => saveFoodToLibrary(f.id!),
                      () => setSaved((s) => ({ ...s, [f.id!]: true }))
                    )
                  }
                >
                  {toSave.length > 1 ? `Save ${f.name} to library` : "Save to library"}
                </button>
              )
            )}
            <Link href="/food" className={BTN_SECONDARY}>
              Edit
            </Link>
            {ids.length ? (
              <button
                type="button"
                disabled={busy}
                className={BTN_SECONDARY}
                onClick={() => run(() => undoFoodLogs(ids, cref), () => setStatus("undone"))}
              >
                Undo
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <CardError error={error} />
    </section>
  );
}

function FixedFoodCardView({
  card,
  cref,
}: {
  card: Extract<ChatCard, { kind: "food_fixed" }>;
  cref: CardRef | null;
}) {
  const [status, setStatus] = useState(card.status);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const prev = card.previous;
  return (
    <section aria-label={`Fixed ${card.item.name}`} className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <span className={TITLE}>{status === "undone" ? "Fix undone" : "Fixed"}</span>
        <span className={`mark ${card.item.is_estimate ? "mark-amber" : "mark-neutral"}`}>
          {card.item.is_estimate ? "Updated · estimate" : "Your numbers"}
        </span>
      </div>
      <div className={status === "undone" ? "opacity-50 line-through" : ""}>
        <FoodRows items={[card.item]} />
      </div>
      <p className="tnum text-xs text-muted">
        Was: {prev.name}
        {prev.serving ? `, ${prev.serving}` : ""} · {prev.kcal != null ? fmtInt(prev.kcal) : "—"} kcal
        {prev.protein_g != null ? ` · P${Math.round(prev.protein_g)}` : ""}
      </p>
      {status === "fixed" ? (
        <>
          <p className="tnum border-t border-hairline pt-1.5 text-xs text-muted">
            Today <strong className="font-display text-ink">{fmtInt(card.kcal_today)}</strong> kcal ·{" "}
            <strong className="font-display text-ink">{fmtInt(card.protein_today)}</strong> g protein
          </p>
          <div className="mt-0.5 flex flex-wrap gap-2">
            {saved ? (
              <span className="flex min-h-9 items-center text-xs font-bold text-green">Saved to library</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                className={BTN_PRIMARY}
                onClick={() => run(() => saveFoodToLibrary(card.item.id), () => setSaved(true))}
              >
                Save to library
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={BTN_SECONDARY}
              onClick={() => run(() => undoFoodFix(card.item.id, prev, cref), () => setStatus("undone"))}
            >
              Undo
            </button>
          </div>
        </>
      ) : null}
      <CardError error={error} />
    </section>
  );
}

function PastFoodCardView({
  card,
  cref,
  today,
}: {
  card: Extract<ChatCard, { kind: "food_past" }>;
  cref: CardRef | null;
  today: string;
}) {
  const [status, setStatus] = useState(card.status);
  const [addedDate, setAddedDate] = useState(card.added_date ?? null);
  const [picking, setPicking] = useState(false);
  const [other, setOther] = useState(card.date);
  const { busy, error, run } = useAction();
  const meal = mealLabel(card.meal);

  function add(date: string) {
    void run(
      () => addPastFoods(card.items, date, card.meal, cref),
      () => {
        setStatus("added");
        setAddedDate(date);
        setPicking(false);
      }
    );
  }

  return (
    <section aria-label={`Add to ${dayWord(card.date, today)}`} className={CARD}>
      <span className={TITLE}>
        {status === "added" && addedDate ? (
          <>
            Added to <span className="mark mark-neutral">{prettyDate(addedDate)}</span>
          </>
        ) : (
          <>
            Add to <span className="mark mark-neutral">{prettyDate(card.date)}</span>
            {meal ? ` · ${meal}` : ""}
          </>
        )}
      </span>
      <FoodRows items={card.items} />
      {status === "pending" ? (
        <>
          <div className="mt-0.5 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => add(card.date)}>
              Add to {dayWord(card.date, today)}
            </button>
            <button
              type="button"
              disabled={busy}
              className={BTN_SECONDARY}
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              Other day
            </button>
          </div>
          {picking ? (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs font-semibold text-muted">
                Day
                <input
                  type="date"
                  value={other}
                  max={today}
                  min={addDays(today, -366)}
                  onChange={(e) => setOther(e.target.value)}
                  className="field mt-1 text-sm font-medium"
                />
              </label>
              <button
                type="button"
                disabled={busy || !other || other > today}
                className={BTN_PRIMARY}
                onClick={() => add(other)}
              >
                Add
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <CardError error={error} />
    </section>
  );
}

function WeightCardView({
  card,
  cref,
  today,
  unit,
}: {
  card: Extract<ChatCard, { kind: "weight" }>;
  cref: CardRef | null;
  today: string;
  unit: WeightUnit;
}) {
  const [status, setStatus] = useState(card.status);
  const { busy, error, run } = useAction();
  const when = card.date === today ? "" : ` for ${dayWord(card.date, today)}`;
  return (
    <div role="status" className={STATUS}>
      <div className="flex min-h-9 items-center gap-2.5">
        {status === "undone" ? (
          <span className="text-[13px] font-medium text-muted">Weight change undone{when}.</span>
        ) : (
          <span className="tnum flex items-center gap-2 text-[13px] text-ink">
            <CheckIcon />
            <span>
              Weight saved{when} · <strong className="font-display">{showWeight(card.kg, unit)}</strong>
              {card.delta != null ? (
                <span className="ml-1 font-bold text-muted">{signed(card.delta, unit)}</span>
              ) : null}
            </span>
          </span>
        )}
        {status === "saved" ? (
          <button
            type="button"
            disabled={busy}
            className={UNDO}
            onClick={() => run(() => undoWeight(card.date, card.previous_kg, cref), () => setStatus("undone"))}
          >
            Undo
          </button>
        ) : null}
      </div>
      <CardError error={error} />
    </div>
  );
}

function SleepCardView({
  card,
  cref,
  today,
}: {
  card: Extract<ChatCard, { kind: "sleep" }>;
  cref: CardRef | null;
  today: string;
}) {
  const [status, setStatus] = useState(card.status);
  const { busy, error, run } = useAction();
  const when = card.date === today ? "" : ` for ${dayWord(card.date, today)}`;
  return (
    <div role="status" className={STATUS}>
      <div className="flex min-h-9 items-center gap-2.5">
        {status === "undone" ? (
          <span className="text-[13px] font-medium text-muted">Sleep change undone{when}.</span>
        ) : (
          <span className="tnum flex items-center gap-2 text-[13px] text-ink">
            <CheckIcon />
            <span>
              Sleep saved{when} · <strong className="font-display">{sleepText(card.duration_min, card.quality)}</strong>
            </span>
          </span>
        )}
        {status === "saved" ? (
          <button
            type="button"
            disabled={busy}
            className={UNDO}
            onClick={() => run(() => undoSleep(card.date, card.previous, cref), () => setStatus("undone"))}
          >
            Undo
          </button>
        ) : null}
      </div>
      <CardError error={error} />
    </div>
  );
}

function GoalCardView({
  card,
  cref,
  unit,
}: {
  card: Extract<ChatCard, { kind: "goal" }>;
  cref: CardRef | null;
  unit: WeightUnit;
}) {
  const [status, setStatus] = useState(card.status);
  const { busy, error, run } = useAction();
  const { from, to, programChanges } = card.preview;
  return (
    <section
      aria-label="Goal change proposal"
      className={`${CARD} ${status === "pending" ? "shadow-[inset_3px_0_0_var(--ember),var(--shadow-card)]" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={TITLE}>
          {status === "approved" ? "Goal updated" : status === "rejected" ? "Kept your current goal" : "Change goal?"}
        </span>
        {status === "pending" ? <span className="mark mark-neutral">Needs your OK</span> : null}
      </div>
      <p className="text-sm font-bold text-ink">
        {GOAL_LABEL[from.goal]} → {GOAL_LABEL[to.goal]}
      </p>
      <dl className="tnum flex flex-col gap-1 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-ink">Calories</dt>
          <dd>
            <span className="text-muted">{fmtInt(from.kcal)} →</span> <strong className="font-display text-ink">{fmtInt(to.kcal)}</strong>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink">Protein</dt>
          <dd>
            <span className="text-muted">{fmtInt(from.protein)} →</span>{" "}
            <strong className="font-display text-ink">{fmtInt(to.protein)} g</strong>
          </dd>
        </div>
        {card.goal_weight_kg != null ? (
          <div className="flex justify-between">
            <dt className="text-ink">Goal weight</dt>
            <dd>
              <strong className="font-display text-ink">{showWeight(card.goal_weight_kg, unit)}</strong>
            </dd>
          </div>
        ) : null}
      </dl>
      {status === "pending" ? (
        <>
          {programChanges ? (
            <p className="text-xs text-muted">A new program gets proposed next. You approve it before it starts.</p>
          ) : null}
          <div className="mt-0.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={BTN_APPROVE}
              onClick={() => run(() => approvePendingChange(card.pending_id, cref), () => setStatus("approved"))}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              className={BTN_SECONDARY}
              onClick={() => run(() => rejectPendingChange(card.pending_id, cref), () => setStatus("rejected"))}
            >
              Not now
            </button>
            <Link href={`/goals/change?goal=${encodeURIComponent(to.goal)}`} className={BTN_SECONDARY}>
              Edit numbers
            </Link>
          </div>
        </>
      ) : null}
      {status === "approved" && programChanges ? (
        <Link href="/program" className={`${BTN_PRIMARY} mt-1 self-start`}>
          Build my new program
        </Link>
      ) : null}
      <CardError error={error} />
    </section>
  );
}

function HealthCardView({ card, cref }: { card: Extract<ChatCard, { kind: "health" }>; cref: CardRef | null }) {
  const [status, setStatus] = useState(card.status);
  const { busy, error, run } = useAction();
  const verb = card.action === "resolve" ? "Mark as resolved" : card.action === "update" ? "Update note" : "New note";
  return (
    <section aria-label="Health note proposal" className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <span className={TITLE}>
          {status === "approved"
            ? "Saved to your health notes"
            : status === "rejected"
              ? "Not saved"
              : "Save to health notes?"}
        </span>
        <span className="mark mark-neutral">{verb}</span>
      </div>
      <p className="text-sm font-bold text-ink">{card.condition}</p>
      {card.notes ? <p className="text-[13px] text-muted">{card.notes}</p> : null}
      {status === "pending" ? (
        <div className="mt-0.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className={BTN_PRIMARY}
            onClick={() => run(() => approvePendingChange(card.pending_id, cref), () => setStatus("approved"))}
          >
            Save to health notes
          </button>
          <button
            type="button"
            disabled={busy}
            className={BTN_SECONDARY}
            onClick={() => run(() => rejectPendingChange(card.pending_id, cref), () => setStatus("rejected"))}
          >
            Skip
          </button>
        </div>
      ) : null}
      <CardError error={error} />
    </section>
  );
}

export function ChatCards({
  cards,
  messageId,
  today,
  unit = "kg",
}: {
  cards: ChatCard[];
  messageId: string | null;
  today: string;
  unit?: WeightUnit;
}) {
  if (!cards.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {cards.map((card) => {
        const cref: CardRef | null = messageId ? { messageId, key: card.key } : null;
        switch (card.kind) {
          case "food":
            return <FoodCardView key={card.key} card={card} cref={cref} />;
          case "food_fixed":
            return <FixedFoodCardView key={card.key} card={card} cref={cref} />;
          case "food_past":
            return <PastFoodCardView key={card.key} card={card} cref={cref} today={today} />;
          case "weight":
            return <WeightCardView key={card.key} card={card} cref={cref} today={today} unit={unit} />;
          case "sleep":
            return <SleepCardView key={card.key} card={card} cref={cref} today={today} />;
          case "goal":
            return <GoalCardView key={card.key} card={card} cref={cref} unit={unit} />;
          case "health":
            return <HealthCardView key={card.key} card={card} cref={cref} />;
          case "health_consent":
            return (
              <div key={card.key} className={CARD}>
                <p className="text-[13px] text-ink">Health notes are off, so nothing was saved.</p>
                <Link href="/profile" className={`${BTN_SECONDARY} mt-0.5 self-start`}>
                  Turn on health notes
                </Link>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
