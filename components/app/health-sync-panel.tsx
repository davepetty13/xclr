"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { makeSyncLink, saveHealthFields, saveShareWithCoach, turnOffSync } from "@/app/(app)/profile/health-sync/actions";
import type { HealthFields } from "@/lib/health";

const FIELD_ROWS: { keys: (keyof HealthFields)[]; title: string; hint: string }[] = [
  { keys: ["steps"], title: "Steps", hint: "Daily total" },
  { keys: ["active"], title: "Active calories", hint: "Feeds 'Burned' on Today" },
  { keys: ["workouts"], title: "Workouts", hint: "Show in Train as extra activity" },
  { keys: ["sleep", "resting_hr"], title: "Sleep & resting heart rate", hint: "Shown on Today. Sleep can go to your coach; resting heart rate never does." },
  { keys: ["weight"], title: "Weight", hint: "Only from a smart scale" },
];

// The ready-made "Xclr Sync" shortcut (iCloud link). Override with
// NEXT_PUBLIC_XCLR_SHORTCUT_URL if the shortcut is re-shared.
const DEFAULT_SHORTCUT_URL = "https://www.icloud.com/shortcuts/b308b8caeac64ec7bca080522d224f6d";
const SHORTCUT_URL = process.env.NEXT_PUBLIC_XCLR_SHORTCUT_URL || DEFAULT_SHORTCUT_URL;

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
  shareWithCoach: initialShare,
  syncsToday,
  nowMin,
}: {
  endpoint: string;
  hasLink: boolean;
  fields: HealthFields;
  shareWithCoach: boolean;
  syncsToday: number;
  nowMin: number;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [share, setShare] = useState(initialShare);
  const [fieldMsg, setFieldMsg] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // One in-app confirm for both "new link" buttons, and one for "Turn off sync".
  const [confirming, setConfirming] = useState<"new" | "off" | null>(null);
  // Which card the confirm / messages show in: the quick setup or "manage".
  const [where, setWhere] = useState<"setup" | "manage">("setup");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => setShare(initialShare), [initialShare]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function ask(kind: "new" | "off", opener: HTMLElement, at: "setup" | "manage") {
    openerRef.current = opener;
    setWhere(at);
    setError(null);
    setNotice(null);
    setConfirming(kind);
  }
  function cancelConfirm() {
    setConfirming(null);
    openerRef.current?.focus();
  }

  async function toggleShare(on: boolean) {
    setShare(on);
    setFieldMsg(null);
    const r = await saveShareWithCoach(on).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
    if (!r.ok) {
      setShare(!on);
      setFieldMsg(r.error);
    } else setFieldMsg("Saved");
  }

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

  // A first link is made straight away; replacing one asks first (in-app).
  function requestNewLink(opener: HTMLElement, at: "setup" | "manage") {
    if (busy) return;
    setWhere(at);
    if (hasLink || token) ask("new", opener, at);
    else void newLink();
  }

  async function newLink() {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    setNotice(null);
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

  async function turnOff() {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      const r = await turnOffSync();
      if (!r.ok) setError(r.error);
      else {
        setToken(null);
        setNotice("Sync is off. Your shortcut won't send anything now. Numbers already synced stay.");
        router.refresh();
      }
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // "Copy my key": the key is only usable right after making a link. With a
  // fresh key on screen, copy it; otherwise make a new link first (replacing
  // an existing one asks in-app), which copies the new key straight away.
  function copyMyKey(opener: HTMLElement) {
    if (token) void copyBit("token");
    else requestNewLink(opener, "setup");
  }

  async function copyBit(what: "url" | "token") {
    const text = what === "url" ? endpoint : token ?? "";
    setCopied((await copy(text)) ? what : null);
  }

  // A time is ticked once it has passed and enough syncs arrived today.
  const passed = SYNC_TIMES.map((t) => nowMin >= t.min);
  const ticked = passed.map((p, i) => p && passed.slice(0, i + 1).filter(Boolean).length <= syncsToday);

  const confirmAndMessages = (
    <>
      {confirming ? (
        <div role="group" aria-labelledby="sync-confirm-h" className="flex flex-col gap-2 rounded-tile bg-field p-3">
          <p id="sync-confirm-h" className="text-[13px] font-semibold text-ink">
            {confirming === "new"
              ? "Make a new key? The old one stops working right away, so paste the new key into your shortcut after."
              : "Turn off sync? Your shortcut stops working right away. Numbers already synced stay."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={cancelConfirm} className="btn-secondary min-h-10 text-[13px]">
              Keep it
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => void (confirming === "new" ? newLink() : turnOff())}
              className={`min-h-10 text-[13px] ${confirming === "off" ? "btn-secondary text-ember-text" : "btn-primary btn-primary-green"}`}
            >
              {confirming === "new" ? "Make a new key" : "Turn off sync"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-ember-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs font-semibold text-green">
          {notice}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      <section aria-labelledby="setup-h" className="glass flex flex-col gap-2.5 px-[15px] py-[13px]">
        <h2 id="setup-h" className="text-xs font-bold text-muted">
          Set up in about a minute
        </h2>
        <ol className="flex list-decimal flex-col gap-1.5 pl-[18px] text-sm leading-normal text-ink">
          <li>
            <strong>Copy your key</strong>
          </li>
          <li>
            <strong>Add the Xclr shortcut</strong> and paste the key when it asks
          </li>
          <li>
            Run it once and tap <strong>Allow</strong>
          </li>
          <li>Add the 3 automations (steps below)</li>
        </ol>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={(e) => copyMyKey(e.currentTarget)}
            disabled={busy}
            className="btn-secondary min-h-[46px] text-sm font-bold"
          >
            {busy ? "Making…" : copied === "token" ? "Key copied" : "Copy my key"}
          </button>
          <a href={SHORTCUT_URL} target="_blank" rel="noreferrer" className="btn-primary btn-primary-green min-h-[46px] text-sm">
            Add the shortcut
          </a>
        </div>
        {!token ? (
          <p className="text-[11px] text-muted">
            {hasLink
              ? "For safety Xclr shows a key only once. Copy my key makes a new one — the old one stops working."
              : "Copy my key makes your private sync key and copies it."}
          </p>
        ) : null}

        {token ? (
          <div className="flex flex-col gap-2 rounded-tile bg-field p-3" aria-live="polite">
            <p className="text-xs font-bold text-ink">Your key — shown only now</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-ink">{token}</code>
              <button type="button" onClick={() => void copyBit("token")} className="btn-secondary min-h-10 shrink-0 px-3 text-xs">
                {copied === "token" ? "Copied" : "Copy key"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-muted">{endpoint}</code>
              <button type="button" onClick={() => void copyBit("url")} className="btn-secondary min-h-10 shrink-0 px-3 text-xs">
                {copied === "url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Paste the key when the Xclr shortcut asks. The URL is only for building it by hand or Android. Xclr
              can&apos;t show this key again.
            </p>
          </div>
        ) : null}

        {where === "setup" ? confirmAndMessages : null}
      </section>

      <section aria-labelledby="garmin-h" className="glass flex flex-col gap-1.5 px-[15px] py-[13px]">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-ink text-[13px] font-extrabold text-card">
            G
          </span>
          <h2 id="garmin-h" className="text-[15px] font-bold text-ink">
            Wear a Garmin?
          </h2>
        </div>
        <p className="text-[13px] leading-[1.45] text-band-secondary">
          Do this once first: open <strong>Garmin Connect</strong> → <strong>More</strong> → <strong>Settings</strong> →{" "}
          <strong>Connected Apps</strong> → <strong>Apple Health</strong>, and turn everything on. Garmin then fills
          Apple Health, and the Xclr shortcut picks it up.
        </p>
        <p className="text-[11px] text-muted">Menu names can differ slightly by app version.</p>
      </section>

      <section aria-labelledby="auto-h" className="glass flex flex-col gap-1.5 px-[15px] py-[13px]">
        <h2 id="auto-h" className="text-xs font-bold text-muted">
          Make it run on its own
        </h2>
        <p className="text-[13px] text-band-secondary">
          Shortcuts → <strong>Automation</strong> → <strong>+</strong> · each set to <strong>Run Immediately</strong> →{" "}
          <em>Xclr Sync</em> (turn off <em>Notify When Run</em>):
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-normal text-band-secondary">
          <li>
            <strong>App</strong> → Messenger or Instagram → <em>Is Opened</em>. Syncs whenever your phone is unlocked.
          </li>
          <li>
            <strong>Sleep</strong> → <em>Wake Up</em>. Last night&apos;s sleep arrives first thing.
          </li>
          <li>
            <strong>Time of Day</strong> → 9:30 PM, Daily. An end-of-day catch-up.
          </li>
        </ul>
      </section>

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
                className="h-5 w-5 shrink-0 accent-green"
              />
              <span className="flex-1 py-1.5">
                <span className="block text-sm font-semibold text-ink">{row.title}</span>
                <span className="block text-[11px] text-muted">{row.hint}</span>
              </span>
            </label>
          );
        })}
        <label className="flex min-h-[48px] items-center gap-2.5 border-t border-hairline">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => void toggleShare(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-green"
          />
          <span className="flex-1 py-1.5">
            <span className="block text-sm font-semibold text-ink">Share with my coach</span>
            <span className="block text-[11px] text-muted">
              Weekly steps, burn, sleep and Watch workouts go into your weekly review. Resting heart rate never does.
            </span>
          </span>
        </label>
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

        <p className="text-[11px] text-muted">
          {hasLink
            ? "You have a key set up. For safety Xclr only shows it once. "
            : "The link is private to you. "}
          If it leaks, tap{" "}
          <button
            type="button"
            onClick={(e) => requestNewLink(e.currentTarget, "manage")}
            className="min-h-10 font-semibold text-ink underline"
          >
            Make a new key
          </button>{" "}
          and the old one stops working.
        </p>
        {hasLink || token ? (
          <button
            type="button"
            onClick={(e) => ask("off", e.currentTarget, "manage")}
            disabled={busy}
            className="btn-secondary self-start text-[13px] text-ember-text"
          >
            Turn off sync
          </button>
        ) : null}
        {where === "manage" ? confirmAndMessages : null}
      </section>

      <ShortcutSteps endpoint={endpoint} />

      <details className="glass px-3.5 py-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm font-bold text-ink">Using Android?</summary>
        <div className="flex flex-col gap-2 pb-1 text-[13px] leading-relaxed text-ink">
          <p>
            Android phones keep Watch and phone data in <strong>Health Connect</strong>. Any app that can read Health
            Connect and send it to a web link works with the same sync link — no Google Fit needed (Google is
            shutting its Fit API down).
          </p>
          <p>
            Point the app at <code className="break-all text-xs">{endpoint}</code> with the Authorization header (Bearer + your key), method POST, and a JSON body like the one in
            the steps. Add <code className="text-xs">&quot;source&quot;: &quot;health_connect&quot;</code> so Xclr
            knows it came from Android.
          </p>
        </div>
      </details>
    </>
  );
}


// By-hand steps (collapsed): for building the shortcut yourself.
function ShortcutSteps({ endpoint }: { endpoint: string }) {
  return (
    <details id="shortcut-steps" className="glass px-3.5 py-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-bold text-ink">Build the shortcut by hand</summary>
      <div className="flex flex-col gap-3 pt-1 text-[13px] leading-relaxed text-ink">
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
            → <em>Sum</em>. Call it &ldquo;Sleep&rdquo;. Shortcuts gives this in seconds, so it goes in the body as{" "}
            <code className="text-xs">sleep_seconds</code>.
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
            <strong>Get Contents of URL</strong> → <code className="break-all text-xs">{endpoint}</code>. Tap <em>Show More</em>: Method <em>POST</em>;
            Headers: add <em>Authorization</em> = the word <em>Bearer</em>, a space, then your key; Request Body <em>JSON</em> with:
            <code className="mt-1 block whitespace-pre-wrap rounded-lg bg-field p-2 text-xs">
              {`date = Today
steps = Steps
active_kcal = Active
resting_hr = Resting
sleep_seconds = Sleep
weight_kg = Weight
workouts = Workouts   (type: Array)`}
            </code>
          </li>
        </ol>
        <p className="mt-1.5">
          Sleep in another unit? Use <code className="text-xs">sleep_minutes</code> for minutes or{" "}
          <code className="text-xs">sleep_hours</code> for hours instead. Xclr never guesses the unit.
        </p>
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
    </details>
  );
}
