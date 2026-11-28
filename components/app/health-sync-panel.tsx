"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { makeSyncLink, saveHealthFields } from "@/app/(app)/profile/health-sync/actions";
import type { HealthFields } from "@/lib/health";

const FIELD_ROWS: { keys: (keyof HealthFields)[]; title: string; hint: string }[] = [
  { keys: ["steps"], title: "Steps", hint: "Daily total" },
  { keys: ["active"], title: "Active calories", hint: "Feeds 'Burned' on Today" },
  { keys: ["workouts"], title: "Workouts", hint: "Show in Train as extra activity" },
  { keys: ["sleep", "resting_hr"], title: "Sleep & resting heart rate", hint: "For your weekly review" },
  { keys: ["weight"], title: "Weight", hint: "Only from a smart scale" },
];

const SYNC_TIMES = [
  { label: "12:00 PM", min: 12 * 60 },
  { label: "6:00 PM", min: 18 * 60 },
  { label: "9:30 PM", min: 21 * 60 + 30 },
];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function HealthSyncPanel({
  endpoint,
  hasLink,
  fields: initialFields,
  syncsToday,
  nowMin,
}: {
  endpoint: string;
  hasLink: boolean;
  fields: HealthFields;
  syncsToday: number;
  nowMin: number;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [fieldMsg, setFieldMsg] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  async function toggle(keys: (keyof HealthFields)[], on: boolean) {
    const next = { ...fields };
    for (const k of keys) next[k] = on;
    setFields(next);
    setFieldMsg(null);
    const r = await saveHealthFields(next).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
    if (!r.ok) {
      setFields(fields);
      setFieldMsg(r.error);
    } else setFieldMsg("Saved");
  }

  async function newLink() {
    if (busy) return;
    if (hasLink && !token && !confirm("Make a new link? The old one stops working right away, so update your shortcut after.")) return;
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      const r = await makeSyncLink();
      if (!r.ok) setError(r.error);
      else {
        setToken(r.token);
        if (await copy(r.token)) setCopied("token");
        router.refresh();
      }
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyBit(what: "url" | "token") {
    const text = what === "url" ? endpoint : `Bearer ${token ?? ""}`;
    setCopied((await copy(text)) ? what : null);
  }

  // A time is ticked once it has passed and enough syncs arrived today.
  const passed = SYNC_TIMES.map((t) => nowMin >= t.min);
  const ticked = passed.map((p, i) => p && passed.slice(0, i + 1).filter(Boolean).length <= syncsToday);

  return (
    <>
      <section aria-labelledby="fields-h" className="glass px-3.5 py-1">
        <h2 id="fields-h" className="pt-2.5 text-xs font-bold text-muted">
          What Xclr receives
        </h2>
        {FIELD_ROWS.map((row, i) => {
          const on = row.keys.every((k) => fields[k]);
          return (
            <label
              key={row.title}
              className={`flex min-h-[48px] items-center gap-2.5 ${i < FIELD_ROWS.length - 1 ? "border-b border-hairline" : ""}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => void toggle(row.keys, e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[var(--green)]"
              />
              <span className="flex-1 py-1.5">
                <span className="block text-sm font-semibold text-ink">{row.title}</span>
                <span className="block text-[11px] text-muted">{row.hint}</span>
              </span>
            </label>
          );
        })}
        <p aria-live="polite" className="pb-2 text-xs font-semibold empty:hidden">
          {fieldMsg ? <span className={fieldMsg === "Saved" ? "text-green" : "text-ember-text"}>{fieldMsg}</span> : null}
        </p>
      </section>

      <section aria-labelledby="times-h" className="glass flex flex-col gap-2 px-3.5 py-3">
        <h2 id="times-h" className="text-xs font-bold text-muted">
          Sync times (iPhone Shortcuts)
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {SYNC_TIMES.map((t, i) => {
            const done = ticked[i];
            return (
              <span
                key={t.label}
                className={`tnum inline-flex min-h-9 items-center rounded-lg px-2.5 text-[13px] ${
                  done ? "bg-green-soft font-bold text-green" : "bg-segment font-semibold text-muted"
                }`}
              >
                {t.label}
                {done ? " ✓" : ""}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Same shortcut, three automations. Syncing more often is fine — numbers update, never double.
        </p>

        {token ? (
          <div className="flex flex-col gap-2 rounded-tile bg-field p-3" aria-live="polite">
            <p className="text-xs font-bold text-ink">Your sync link — shown only now</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-ink">{endpoint}</code>
              <button type="button" onClick={() => void copyBit("url")} className="btn-secondary min-h-10 shrink-0 px-3 text-xs">
                {copied === "url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-ink">Bearer {token}</code>
              <button type="button" onClick={() => void copyBit("token")} className="btn-secondary min-h-10 shrink-0 px-3 text-xs">
                {copied === "token" ? "Copied" : "Copy key"}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Paste the URL into &ldquo;Get Contents of URL&rdquo;, and the key (with the word Bearer) as the
              Authorization header. Xclr can&apos;t show this key again.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void newLink()} disabled={busy} className="btn-primary btn-primary-green text-sm">
            {busy ? "Making…" : hasLink || token ? "Copy a new link" : "Copy my sync link"}
          </button>
          <button
            type="button"
            onClick={() => setShowSteps((s) => !s)}
            aria-expanded={showSteps}
            aria-controls="shortcut-steps"
            className="btn-secondary text-sm"
          >
            {showSteps ? "Hide the steps" : "Show the steps"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-ember-text">
            {error}
          </p>
        ) : null}
        <p className="text-[11px] text-muted">
          {hasLink
            ? "You have a link set up. For safety Xclr only shows it once. "
            : "The link is private to you. "}
          If it leaks, tap{" "}
          <button type="button" onClick={() => void newLink()} className="min-h-10 font-semibold text-ink underline">
            Make a new link
          </button>{" "}
          and the old one stops working.
        </p>

        {showSteps ? <ShortcutSteps /> : null}
      </section>

      <details className="glass px-3.5 py-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm font-bold text-ink">Using Android?</summary>
        <div className="flex flex-col gap-2 pb-1 text-[13px] leading-relaxed text-ink">
          <p>
            Android phones keep Watch and phone data in <strong>Health Connect</strong>. Any app that can read Health
            Connect and send it to a web link works with the same sync link — no Google Fit needed (Google is
            shutting its Fit API down).
          </p>
          <p>
            Point the app at the URL above with the Authorization header, method POST, and a JSON body like the one in
            the steps. Add <code className="text-xs">&quot;source&quot;: &quot;health_connect&quot;</code> so Xclr
            knows it came from Android.
          </p>
        </div>
      </details>
    </>
  );
}

function ShortcutSteps() {
  return (
    <div id="shortcut-steps" className="flex flex-col gap-3 border-t border-hairline pt-3 text-[13px] leading-relaxed text-ink">
      <div>
        <p className="text-xs font-bold text-muted">1 · Build the shortcut (once)</p>
        <p className="mt-1">
          Open <strong>Shortcuts</strong> → tap <strong>+</strong> → name it &ldquo;Xclr sync&rdquo;. Add these actions
          in order. After each one, tap its result and rename it to the word in quotes.
        </p>
        <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-5">
          <li>
            <strong>Find Health Samples</strong> where Type is <em>Steps</em> and Start Date is <em>Today</em>. Then{" "}
            <strong>Calculate Statistics</strong> → <em>Sum</em>. Call it &ldquo;Steps&rdquo;.
          </li>
          <li>
            <strong>Find Health Samples</strong> → <em>Active Energy</em>, Today. Then <strong>Calculate Statistics</strong>{" "}
            → <em>Sum</em>. Call it &ldquo;Active&rdquo;.
          </li>
          <li>
            <strong>Find Health Samples</strong> → <em>Resting Heart Rate</em>, sorted latest first, limit 1. Call it
            &ldquo;Resting&rdquo;.
          </li>
          <li>
            <strong>Find Health Samples</strong> → <em>Sleep Analysis</em>, Start Date in the last 1 day, Value is{" "}
            <em>Asleep</em> (or <em>In Bed</em> if your Watch doesn&apos;t track sleep stages). Then{" "}
            <strong>Get Details of Health Sample</strong> → <em>Duration</em>, and <strong>Calculate Statistics</strong>{" "}
            → <em>Sum</em>. Call it &ldquo;Sleep&rdquo; (minutes or seconds both work).
          </li>
          <li>
            <strong>Find Health Samples</strong> → <em>Weight</em>, Today, latest first, limit 1. Call it
            &ldquo;Weight&rdquo;. Skip this if you don&apos;t use a smart scale.
          </li>
          <li>
            <strong>Find Workouts</strong> where Start Date is <em>Today</em>. Then <strong>Repeat with Each</strong>:
            inside it add a <strong>Dictionary</strong> with <em>start</em> = Start Date, <em>end</em> = End Date (both
            formatted as ISO 8601), <em>kind</em> = Workout Type, <em>kcal</em> = Active Energy, then{" "}
            <strong>Add to Variable</strong> &ldquo;Workouts&rdquo;.
          </li>
          <li>
            <strong>Format Date</strong> → Current Date, custom format <code className="text-xs">yyyy-MM-dd</code>. Call
            it &ldquo;Today&rdquo;.
          </li>
          <li>
            <strong>Get Contents of URL</strong> → paste your sync URL. Tap <em>Show More</em>: Method <em>POST</em>;
            Headers: add <em>Authorization</em> = your key (starts with Bearer); Request Body <em>JSON</em> with:
            <code className="mt-1 block whitespace-pre-wrap rounded-lg bg-field p-2 text-xs">
              {`date = Today
steps = Steps
active_kcal = Active
resting_hr = Resting
sleep_minutes = Sleep
weight_kg = Weight
workouts = Workouts   (type: Array)`}
            </code>
          </li>
        </ol>
        <p className="mt-1.5">Tap ▶ once to test. You should see &ldquo;ok&rdquo; and a sync count.</p>
      </div>

      <div>
        <p className="text-xs font-bold text-muted">2 · Run it three times a day</p>
        <ol className="mt-1 flex list-decimal flex-col gap-1.5 pl-5">
          <li>
            In Shortcuts, tap <strong>Automation</strong> → <strong>+</strong> → <strong>Time of Day</strong> →{" "}
            <em>12:00 PM</em>, <em>Daily</em>.
          </li>
          <li>
            Choose <strong>Run Immediately</strong> (not &ldquo;Ask Before Running&rdquo;), then pick &ldquo;Xclr
            sync&rdquo;.
          </li>
          <li>
            Do the same for <em>6:00 PM</em> and <em>9:30 PM</em> — same shortcut each time.
          </li>
        </ol>
      </div>

      <p className="rounded-lg bg-amber-soft p-2.5 text-xs text-amber-text">
        Heads up: iPhone keeps Health data locked while the phone is locked. If an automation runs while your iPhone is
        locked, that sync may send nothing. The next one after you unlock catches up, which is why three a day helps.
      </p>
    </div>
  );
}
