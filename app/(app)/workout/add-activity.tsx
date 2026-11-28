"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logActivity } from "./actions";
import { ACTIVITY_DAYS_BACK, ACTIVITY_TYPES, EFFORTS } from "@/lib/day-edits";
import { addDays, prettyDate } from "@/lib/time";
import { ErrorLine, Sheet, SheetField, sheetInput } from "./sheet";

type Effort = (typeof EFFORTS)[number]["value"];

// "+ Add activity" on Train: a manual extra workout (badminton, a run…) for
// today or a recent day. Saved as its own session; no AI, nothing estimated.
export function AddActivity({ today, startOpen = false }: { today: string; startOpen?: boolean }) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(startOpen);
  const [type, setType] = useState<string>(ACTIVITY_TYPES[0]);
  const [other, setOther] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [effort, setEffort] = useState<Effort>("moderate");
  const [date, setDate] = useState(today);
  const [kcal, setKcal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const days = Array.from({ length: ACTIVITY_DAYS_BACK + 1 }, (_, i) => addDays(today, -i));
  const dayLabel = (d: string, i: number) =>
    i === 0 ? `Today · ${prettyDate(d)}` : i === 1 ? `Yesterday · ${prettyDate(d)}` : prettyDate(d);

  function close() {
    setOpen(false);
    setError(null);
    if (startOpen) router.replace("/workout", { scroll: false });
  }

  async function save() {
    const name = type === "Other" ? other.trim() : type;
    const mins = Number(minutes);
    const cal = kcal.trim() === "" ? null : Number(kcal);
    if (!name) return setError("Type what you did.");
    if (!Number.isFinite(mins) || mins < 1 || mins > 1440) return setError("Minutes should be between 1 and 1440.");
    if (cal != null && (!Number.isFinite(cal) || cal < 0 || cal > 10000))
      return setError("Calories should be a number, or left blank.");
    setBusy(true);
    setError(null);
    try {
      const r = await logActivity({ name, minutes: Math.round(mins), effort, kcal: cal, note, date });
      if (r.ok) {
        setSaved(`${name} · ${Math.round(mins)} min saved${date === today ? "" : ` for ${prettyDate(date)}`}.`);
        setNote("");
        setKcal("");
        close();
        router.refresh();
      } else setError(r.error);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setSaved(null);
            setOpen(true);
          }}
          className="btn-secondary px-4 text-[13px]"
        >
          + Add activity
        </button>
        {saved ? (
          <p role="status" className="text-xs font-semibold text-green">
            {saved}
          </p>
        ) : null}
      </div>
      {open ? (
        <Sheet title="Add activity" onClose={close} returnFocus={btnRef}>
          <SheetField label="What did you do?">
            <select value={type} onChange={(e) => setType(e.target.value)} className={sheetInput}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="Other">Other…</option>
            </select>
          </SheetField>
          {type === "Other" ? (
            <SheetField label="Name">
              <input
                value={other}
                maxLength={60}
                onChange={(e) => setOther(e.target.value)}
                placeholder="e.g. Pickleball"
                className={sheetInput}
                autoFocus
              />
            </SheetField>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <SheetField label="Minutes">
              <input
                value={minutes}
                inputMode="numeric"
                onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                className={`${sheetInput} tnum`}
              />
            </SheetField>
            <SheetField label="Effort">
              <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)} className={sheetInput}>
                {EFFORTS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </SheetField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SheetField label="Day">
              <select value={date} onChange={(e) => setDate(e.target.value)} className={sheetInput}>
                {days.map((d, i) => (
                  <option key={d} value={d}>
                    {dayLabel(d, i)}
                  </option>
                ))}
              </select>
            </SheetField>
            <SheetField label="Calories" hint="(if you know)">
              <input
                value={kcal}
                inputMode="numeric"
                onChange={(e) => setKcal(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                placeholder="e.g. 410"
                className={`${sheetInput} tnum`}
              />
            </SheetField>
          </div>
          <SheetField label="Note" hint="(optional)">
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. doubles, 3 games"
              className={sheetInput}
            />
          </SheetField>
          <p className="rounded-[14px] bg-field px-3 py-2.5 text-xs leading-snug text-muted">
            Counts toward this week. Your coach sees it in the weekly review. If your Watch already logged it, it
            shows up on its own — no need to add it twice.
          </p>
          <ErrorLine error={error} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="btn-primary btn-primary-green w-full text-[15px]"
          >
            {busy ? "Saving…" : "Save activity"}
          </button>
        </Sheet>
      ) : null}
    </>
  );
}
