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
    <div role="radiogroup" aria-label="Units" className="flex rounded-control bg-segment p-0.5">
      {(["kg", "lbs"] as const).map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          disabled={busy}
          onClick={() => void choose(u)}
          aria-checked={value === u}
          className={`min-h-[44px] rounded-lg px-3.5 text-xs transition-colors disabled:opacity-60 ${
            value === u ? "bg-ink font-bold text-card" : "font-semibold text-muted"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
