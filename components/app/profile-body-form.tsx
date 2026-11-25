"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SEX_OPTIONS } from "@/lib/onboarding-options";
import { cmToFtIn, ftInToCm } from "@/lib/units";
import { saveBody } from "@/app/(app)/profile/actions";
import { Chip, ChipGroup, FieldTitle, ProfileSection, SaveRow, inputClass } from "@/components/app/profile-ui";

export type BodyValues = {
  display_name: string;
  height_cm: number | null;
  sex: string | null;
  birthdate: string | null;
};

function initFtIn(cm: number | null): { ft: string; inch: string } {
  if (cm == null) return { ft: "", inch: "" };
  const { feet, inches } = cmToFtIn(cm);
  const r = Math.round(inches);
  return r === 12 ? { ft: String(feet + 1), inch: "0" } : { ft: String(feet), inch: String(r) };
}

export function ProfileBodyForm({ initial }: { initial: BodyValues }) {
  const router = useRouter();
  const [name, setName] = useState(initial.display_name);
  const [mode, setMode] = useState<"cm" | "ftin">("cm");
  const [cm, setCm] = useState(initial.height_cm != null ? String(initial.height_cm) : "");
  const [ftin, setFtin] = useState(initFtIn(initial.height_cm));
  const [sex, setSex] = useState<string | null>(initial.sex);
  const [birthdate, setBirthdate] = useState(initial.birthdate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function switchMode(next: "cm" | "ftin") {
    if (next === mode) return;
    if (next === "ftin") {
      const n = Number(cm);
      setFtin(Number.isFinite(n) && n > 0 ? initFtIn(n) : { ft: "", inch: "" });
    } else {
      const f = Number(ftin.ft);
      const i = Number(ftin.inch || 0);
      if (Number.isFinite(f) && f > 0 && Number.isFinite(i)) setCm(String(Math.round(ftInToCm(f, i))));
    }
    setMode(next);
  }

  async function save() {
    if (busy) return;
    setError(null);
    setSaved(false);
    let heightCm: number;
    if (mode === "cm") heightCm = Number(cm);
    else {
      const f = Number(ftin.ft);
      const i = Number(ftin.inch || 0);
      if (!Number.isFinite(f) || !Number.isFinite(i) || f <= 0) {
        setError("Enter your height in feet and inches.");
        return;
      }
      heightCm = Math.round(ftInToCm(f, i) * 10) / 10;
    }
    setBusy(true);
    const r = await saveBody({ display_name: name, height_cm: heightCm, sex, birthdate: birthdate || null });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <ProfileSection title="Body" id="profile-body">
      <label className="block">
        <FieldTitle>Display name</FieldTitle>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink" id="height-label">
            Height
          </span>
          <div className="flex gap-1" role="group" aria-label="Height units">
            <Chip role="radio" on={mode === "cm"} onClick={() => switchMode("cm")}>
              cm
            </Chip>
            <Chip role="radio" on={mode === "ftin"} onClick={() => switchMode("ftin")}>
              ft / in
            </Chip>
          </div>
        </div>
        {mode === "cm" ? (
          <input
            className={inputClass}
            inputMode="decimal"
            aria-labelledby="height-label"
            value={cm}
            onChange={(e) => setCm(e.target.value)}
          />
        ) : (
          <div className="flex gap-2">
            <input
              className={inputClass}
              inputMode="numeric"
              aria-label="Feet"
              placeholder="ft"
              value={ftin.ft}
              onChange={(e) => setFtin({ ...ftin, ft: e.target.value })}
            />
            <input
              className={inputClass}
              inputMode="numeric"
              aria-label="Inches"
              placeholder="in"
              value={ftin.inch}
              onChange={(e) => setFtin({ ...ftin, inch: e.target.value })}
            />
          </div>
        )}
        <p className="mt-1 text-xs font-medium text-muted">Xclr stores height in cm.</p>
      </div>

      <ChipGroup label="Sex (optional)">
        {SEX_OPTIONS.map((o) => (
          <Chip key={o.value} role="radio" on={sex === o.value} onClick={() => setSex(o.value)}>
            {o.label}
          </Chip>
        ))}
        <Chip role="radio" on={sex == null} onClick={() => setSex(null)}>
          Prefer not to say
        </Chip>
      </ChipGroup>

      <label className="block">
        <FieldTitle>Birthdate (optional)</FieldTitle>
        <input
          type="date"
          className={inputClass}
          value={birthdate}
          onChange={(e) => setBirthdate(e.target.value)}
        />
      </label>

      <SaveRow busy={busy} error={error} saved={saved} onSave={() => void save()} />
    </ProfileSection>
  );
}
