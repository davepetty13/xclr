"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EQUIPMENT_ACCESS,
  PREFERRED_TIMES,
  SESSION_MINUTE_OPTIONS,
  SPORTS,
  TRAINING_EXPERIENCE,
  WEEKDAYS,
} from "@/lib/onboarding-options";
import { saveTraining } from "@/app/(app)/profile/actions";
import { Chip, ChipGroup, FieldTitle, ProfileSection, SaveRow } from "@/components/app/profile-ui";

export type TrainingValues = {
  training_days_per_week: number;
  session_minutes: number;
  preferred_days: string[];
  preferred_time: string | null;
  sports: string[];
  training_experience: string;
  equipment_access: string;
  training_notes: string;
};

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function ProfileTrainingForm({ initial }: { initial: TrainingValues }) {
  const router = useRouter();
  const [v, setV] = useState<TrainingValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const minuteOptions: number[] = Array.from(
    new Set<number>([...SESSION_MINUTE_OPTIONS, initial.session_minutes])
  ).sort((a, b) => a - b);

  function set<K extends keyof TrainingValues>(k: K, val: TrainingValues[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
    setSaved(false);
  }

  async function save() {
    if (busy) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    const r = await saveTraining(v);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <ProfileSection title="Training" id="profile-training">
      <ChipGroup label="Days per week">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <Chip key={n} role="radio" on={v.training_days_per_week === n} onClick={() => set("training_days_per_week", n)}>
            {n}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Minutes per session">
        {minuteOptions.map((m) => (
          <Chip key={m} role="radio" on={v.session_minutes === m} onClick={() => set("session_minutes", m)}>
            {m}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Preferred days (optional)">
        {WEEKDAYS.map((d) => (
          <Chip key={d.value} on={v.preferred_days.includes(d.value)} onClick={() => set("preferred_days", toggle(v.preferred_days, d.value))}>
            {d.label}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Preferred time (optional)">
        {PREFERRED_TIMES.map((t) => (
          <Chip
            key={t.value}
            role="radio"
            on={v.preferred_time === t.value}
            onClick={() => set("preferred_time", v.preferred_time === t.value ? null : t.value)}
          >
            {t.label}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Sports">
        {SPORTS.map((s) => (
          <Chip key={s.value} on={v.sports.includes(s.value)} onClick={() => set("sports", toggle(v.sports, s.value))}>
            {s.label}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Experience">
        {TRAINING_EXPERIENCE.map((o) => (
          <Chip key={o.value} role="radio" on={v.training_experience === o.value} onClick={() => set("training_experience", o.value)}>
            {o.label}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Equipment">
        {EQUIPMENT_ACCESS.map((o) => (
          <Chip key={o.value} role="radio" on={v.equipment_access === o.value} onClick={() => set("equipment_access", o.value)}>
            {o.label}
          </Chip>
        ))}
      </ChipGroup>

      <label className="block">
        <FieldTitle>Training notes (optional)</FieldTitle>
        <textarea
          rows={3}
          maxLength={1000}
          value={v.training_notes}
          placeholder="e.g. I like supersets, no early mornings"
          onChange={(e) => set("training_notes", e.target.value)}
          className="field w-full py-3 text-base font-medium outline-none placeholder:text-muted focus:border-green"
        />
        <span className="mt-1 block text-xs font-medium text-muted">
          Your next program uses these. The current one stays until you build a new one.
        </span>
      </label>

      <SaveRow busy={busy} error={error} saved={saved} onSave={() => void save()} />
    </ProfileSection>
  );
}
