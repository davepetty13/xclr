"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/app/(app)/profile/actions";
import { Chip, ChipGroup, FieldTitle, ProfileSection, SaveRow, inputClass } from "@/components/app/profile-ui";

const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Manila", label: "Manila (GMT+8)" },
  { value: "Asia/Singapore", label: "Singapore (GMT+8)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (GMT+8)" },
  { value: "Asia/Tokyo", label: "Tokyo (GMT+9)" },
  { value: "Asia/Seoul", label: "Seoul (GMT+9)" },
  { value: "Asia/Bangkok", label: "Bangkok (GMT+7)" },
  { value: "Asia/Jakarta", label: "Jakarta (GMT+7)" },
  { value: "Asia/Dubai", label: "Dubai (GMT+4)" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin / Central Europe" },
  { value: "America/New_York", label: "New York (US Eastern)" },
  { value: "America/Chicago", label: "Chicago (US Central)" },
  { value: "America/Denver", label: "Denver (US Mountain)" },
  { value: "America/Los_Angeles", label: "Los Angeles (US Pacific)" },
  { value: "Pacific/Honolulu", label: "Honolulu" },
  { value: "UTC", label: "UTC" },
];

export function ProfileSettingsForm({
  initial,
}: {
  initial: { weight_unit: "kg" | "lbs"; timezone: string };
}) {
  const router = useRouter();
  const [unit, setUnit] = useState(initial.weight_unit);
  const [tz, setTz] = useState(initial.timezone || "Asia/Manila");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const options = TIMEZONES.some((t) => t.value === tz) ? TIMEZONES : [{ value: tz, label: tz }, ...TIMEZONES];

  async function save() {
    if (busy) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    const r = await saveSettings({ weight_unit: unit, timezone: tz });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <ProfileSection title="Settings" id="profile-settings">
      <ChipGroup label="Weight unit">
        {(["kg", "lbs"] as const).map((u) => (
          <Chip key={u} role="radio" on={unit === u} onClick={() => setUnit(u)}>
            {u}
          </Chip>
        ))}
      </ChipGroup>
      <p className="-mt-2 text-xs font-medium text-muted">Display only — Xclr always stores kilograms.</p>

      <label className="block">
        <FieldTitle>Timezone</FieldTitle>
        <select className={inputClass} value={tz} onChange={(e) => setTz(e.target.value)}>
          {options.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-medium text-muted">
          Sets when your day starts for food, sleep and training.
        </span>
      </label>

      <SaveRow busy={busy} error={error} saved={saved} onSave={() => void save()} />
    </ProfileSection>
  );
}
