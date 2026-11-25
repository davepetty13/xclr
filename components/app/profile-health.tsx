"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addCondition,
  resolveCondition,
  turnHealthOff,
  turnHealthOn,
  updateCondition,
} from "@/app/(app)/profile/actions";
import { FieldTitle, ProfileSection, inputClass } from "@/components/app/profile-ui";

export type HealthItem = {
  id: string;
  condition: string;
  notes: string | null;
  sourceLine: string; // e.g. "Added from chat · Wed, Nov 25"
};

const COPY =
  "Used only to adjust your training and food. Xclr never diagnoses. You can also just tell your coach in chat.";

const btnPrimary = "btn-primary btn-primary-green px-5 text-sm";
const btnQuiet = "btn-secondary px-4 text-sm";

function ConditionEditor({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { condition: string; notes: string };
  busy: boolean;
  submitLabel: string;
  onSubmit: (v: { condition: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState(initial.condition);
  const [notes, setNotes] = useState(initial.notes);
  return (
    <div className="space-y-3 rounded-2xl bg-field p-4">
      <label className="block">
        <FieldTitle>Condition, injury or medication</FieldTitle>
        <input
          className={`${inputClass} bg-card`}
          value={condition}
          maxLength={120}
          onChange={(e) => setCondition(e.target.value)}
        />
      </label>
      <label className="block">
        <FieldTitle>Notes (optional)</FieldTitle>
        <textarea
          rows={2}
          maxLength={1000}
          value={notes}
          placeholder="e.g. left wrist, flares on heavy presses"
          onChange={(e) => setNotes(e.target.value)}
          className="field w-full bg-card py-3 text-base font-medium outline-none placeholder:text-muted focus:border-green"
        />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => onSubmit({ condition, notes })}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" disabled={busy} className={btnQuiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ProfileHealth({ consentOn, items }: { consentOn: boolean; items: HealthItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // condition id or "new"
  const [askOff, setAskOff] = useState(false);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    after?.();
    router.refresh();
  }

  const errorLine = error ? (
    <p role="alert" className="text-sm font-semibold text-ember-text">
      {error}
    </p>
  ) : null;

  if (!consentOn) {
    return (
      <ProfileSection title="Health" id="profile-health" accent="violet">
        <p className="text-sm font-medium text-ink">
          Want Xclr to work around an injury, a condition or a medication? Turn on health notes and add them here,
          or just mention them to your coach in chat.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm font-medium text-muted">
          <li>Notes are used only to adjust your training and food.</li>
          <li>Xclr never diagnoses or prescribes. For anything medical, check with a professional.</li>
          <li>You can turn this off any time and choose to delete what you saved.</li>
        </ul>
        {errorLine}
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => void run(turnHealthOn)}>
          {busy ? "Turning on…" : "Turn on health notes"}
        </button>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection
      title="Health"
      id="profile-health"
      accent="violet"
      badge={<span className="mark mark-green">Consent on</span>}
    >
      {items.length === 0 ? (
        <p className="text-sm font-medium text-muted">No health notes yet.</p>
      ) : (
        <ul className="-my-2 divide-y divide-hairline">
          {items.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="py-3">
                <ConditionEditor
                  initial={{ condition: c.condition, notes: c.notes ?? "" }}
                  busy={busy}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) => void run(() => updateCondition(c.id, v), () => setEditing(null))}
                />
              </li>
            ) : (
              <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{c.condition}</p>
                  {c.notes ? <p className="mt-0.5 text-xs text-muted">{c.notes}</p> : null}
                  <p className="mt-0.5 text-[11px] text-muted">{c.sourceLine}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-[44px] px-2 text-sm font-semibold text-green disabled:opacity-50"
                    onClick={() => {
                      setError(null);
                      setEditing(c.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-[44px] px-2 text-sm font-semibold text-muted disabled:opacity-50"
                    onClick={() => void run(() => resolveCondition(c.id))}
                  >
                    Resolved
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {editing === "new" ? (
        <ConditionEditor
          initial={{ condition: "", notes: "" }}
          busy={busy}
          submitLabel="Add"
          onCancel={() => setEditing(null)}
          onSubmit={(v) => void run(() => addCondition(v), () => setEditing(null))}
        />
      ) : (
        <button
          type="button"
          className="min-h-[44px] w-full text-left text-[13px] font-bold text-green"
          onClick={() => {
            setError(null);
            setEditing("new");
          }}
        >
          + Add condition, injury or medication
        </button>
      )}

      {errorLine}

      <p className="text-[11px] leading-[1.4] text-muted">{COPY}</p>

      {askOff ? (
        <div className="space-y-3 rounded-2xl bg-field p-4" role="group" aria-label="Turn health consent off">
          <p className="text-sm font-semibold text-ink">
            Turn health notes off. Also delete the notes you saved?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn-primary px-4 text-sm"
              onClick={() => void run(() => turnHealthOff(true), () => setAskOff(false))}
            >
              Delete notes
            </button>
            <button
              type="button"
              disabled={busy}
              className={btnQuiet}
              onClick={() => void run(() => turnHealthOff(false), () => setAskOff(false))}
            >
              Keep, just stop using them
            </button>
            <button type="button" disabled={busy} className="min-h-[44px] px-3 text-sm font-semibold text-muted" onClick={() => setAskOff(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary w-full text-[13px]"
          onClick={() => {
            setError(null);
            setEditing(null);
            setAskOff(true);
          }}
        >
          Turn health consent off
        </button>
      )}
    </ProfileSection>
  );
}
