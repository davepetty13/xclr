"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setWeightUnit } from "@/app/(app)/goals/actions";

export function UnitToggle({ unit }: { unit: "kg" | "lbs" }) {
  const router = useRouter();
  const [value, setValue] = useState<"kg" | "lbs">(unit);
  const [busy, setBusy] = useState(false);

  async function choose(next: "kg" | "lbs") {
    if (next === value || busy) return;
    setValue(next);
    setBusy(true);
    const r = await setWeightUnit(next);
    setBusy(false);
    if (r.ok) router.refresh();
    else setValue(unit);
  }

  return (
    <div className="flex gap-1 rounded-chip border border-line bg-paper p-1">
      {(["kg", "lbs"] as const).map((u) => (
        <button
          key={u}
          type="button"
          disabled={busy}
          onClick={() => void choose(u)}
          aria-pressed={value === u}
          className={`flex-1 rounded-tile px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
            value === u ? "bg-card text-ink shadow-card" : "text-muted"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
