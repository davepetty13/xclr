"use client";

import { useEffect, useRef, useState } from "react";
import {
  removePushSubscription,
  savePushSubscription,
  saveNotifyPrefs,
  sendTestPush,
} from "@/app/(app)/profile/notifications/actions";
import { QUIET_OPTIONS, TIME_OPTIONS, quietValue, type NotifyPrefs } from "@/lib/notify-prefs";
import { Switch } from "@/components/app/switch";

type BoolKey =
  | "breakfast_on"
  | "lunch_on"
  | "dinner_on"
  | "calories_on"
  | "session_on"
  | "workout_reminder_on"
  | "review_on"
  | "nudges_on"
  | "steps_on"
  | "sleep_on"
  | "sync_check_on";
type TimeKey =
  | "breakfast_time"
  | "lunch_time"
  | "dinner_time"
  | "calories_time"
  | "session_time"
  | "workout_reminder_time"
  | "steps_time"
  | "sync_check_time";

const FOOD_ROWS: { on: BoolKey; time?: TimeKey; title: string; hint?: string }[] = [
  { on: "breakfast_on", time: "breakfast_time", title: "Breakfast not logged", hint: "Only if nothing's logged by then" },
  { on: "lunch_on", time: "lunch_time", title: "Lunch not logged" },
  { on: "dinner_on", time: "dinner_time", title: "Dinner not logged" },
  { on: "calories_on", time: "calories_time", title: "Calories off track", hint: "Too low (under half) or over target" },
];
const TRAIN_ROWS: { on: BoolKey; time?: TimeKey; title: string; hint?: string }[] = [
  { on: "session_on", time: "session_time", title: "Today's session", hint: "Not on rest days" },
  { on: "workout_reminder_on", time: "workout_reminder_time", title: "No workout logged yet", hint: "Training days only · tap Skip day if needed" },
  { on: "review_on", title: "Weekly review ready", hint: "When it's waiting for you" },
  { on: "nudges_on", title: "Nudges", hint: "Weigh-in, protein short, photo deleting" },
];
const WATCH_ROWS: { on: BoolKey; time?: TimeKey; title: string; hint?: string }[] = [
  { on: "steps_on", time: "steps_time", title: "Low steps", hint: "Under half your step goal" },
  { on: "sleep_on", title: "Short sleep", hint: "Under 6 h last night · training advice only" },
  { on: "sync_check_on", time: "sync_check_time", title: "Watch hasn't synced", hint: "Nothing from your Watch today" },
];

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "unknown" | "unsupported" | "needs-home" | "on" | "off" | "blocked";

export function NotifySettingsForm({
  initial,
  pushReady,
  publicKey,
  devices,
}: {
  initial: NotifyPrefs;
  pushReady: boolean;
  publicKey: string | null;
  devices: number;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [push, setPush] = useState<PushState>("unknown");
  const [busy, setBusy] = useState(false);
  const saveSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      let state: PushState;
      if (!supported) state = ios && !standalone ? "needs-home" : "unsupported";
      else if (Notification.permission === "denied") state = "blocked";
      else {
        try {
          const reg = await navigator.serviceWorker.getRegistration("/");
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          state = sub && Notification.permission === "granted" && initial.enabled ? "on" : "off";
        } catch {
          state = "off";
        }
      }
      if (!cancelled) setPush(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [initial.enabled]);

  // Last settings the server confirmed, so a failed save can be undone on screen.
  const savedRef = useRef(initial);

  async function save(next: NotifyPrefs) {
    setPrefs(next);
    const seq = ++saveSeq.current;
    const r = await saveNotifyPrefs(next).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
    if (r.ok) savedRef.current = next;
    if (seq !== saveSeq.current) return;
    if (r.ok) setMsg({ text: "Saved" });
    else {
      // Put the switch / time back to what's really saved.
      setPrefs((p) => ({ ...savedRef.current, enabled: p.enabled }));
      setMsg({ text: `${r.error} Your change was undone.`, bad: true });
    }
  }

  async function turnOn() {
    if (!pushReady || !publicKey) {
      setMsg({ text: "Notifications aren't set up on the server yet.", bad: true });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPush(permission === "denied" ? "blocked" : "off");
      setMsg({ text: "This phone didn't allow notifications. You can still see every reminder in the bell.", bad: true });
      return;
    }
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const r = await savePushSubscription(json, navigator.userAgent);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    setPrefs((p) => ({ ...p, enabled: true }));
    setPush("on");
    setMsg({ text: "On. Reminders come to this phone and the bell." });
  }

  async function turnOff() {
    let endpoint: string | null = null;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      endpoint = sub?.endpoint ?? null;
      await sub?.unsubscribe();
    } catch {
      // Still turn it off on the server.
    }
    const r = await removePushSubscription(endpoint);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    setPrefs((p) => ({ ...p, enabled: false }));
    setPush("off");
    setMsg({ text: "Off on this phone. Reminders still land in the bell." });
  }

  async function togglePush(on: boolean) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (on) await turnOn();
      else await turnOff();
    } catch {
      setMsg({ text: "That didn't work. Try again from the Home Screen icon.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (busy) return;
    setBusy(true);
    const r = await sendTestPush().catch(() => ({ ok: false as const, error: "Couldn't send a test right now." }));
    setBusy(false);
    setMsg(r.ok ? { text: "Test sent. It should arrive in a few seconds." } : { text: r.error, bad: true });
  }

  const pushLine = !pushReady
    ? "Not set up yet · reminders still land in the bell"
    : push === "on"
      ? "On · also saved in the bell inside Xclr"
      : push === "needs-home"
        ? "Open Xclr from the Home Screen icon to allow this"
        : push === "unsupported"
          ? "This browser can't show notifications · the bell still works"
          : push === "blocked"
            ? "Blocked in this phone's Settings → Notifications → Xclr"
            : devices > 0
              ? "Off on this phone · on for another device"
              : "Off · reminders still land in the bell";
  const canSwitch = pushReady && (push === "on" || push === "off");

  const row = (r: { on: BoolKey; time?: TimeKey; title: string; hint?: string }, last: boolean) => (
    <div key={r.on} className={`flex min-h-[56px] items-center gap-2.5 py-2 ${last ? "" : "border-b border-hairline"}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{r.title}</p>
        {r.hint ? <p className="text-[11px] text-muted">{r.hint}</p> : null}
      </div>
      {r.time ? (
        <select
          aria-label={`${r.title} time`}
          value={prefs[r.time]}
          disabled={!prefs[r.on]}
          onChange={(e) => void save({ ...prefs, [r.time as TimeKey]: e.target.value })}
          className="tnum min-h-10 rounded-control border border-control-border bg-card px-1.5 text-xs font-semibold text-ink disabled:opacity-55"
        >
          {TIME_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      ) : null}
      <Switch on={prefs[r.on]} label={r.title} onChange={(v) => void save({ ...prefs, [r.on]: v })} />
    </div>
  );

  const quiet = quietValue(prefs);

  return (
    <>
      <section className="flex items-center gap-2.5 rounded-tile bg-green-soft px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink">Allow on this phone</p>
          <p className="text-[11px] text-muted">{pushLine}</p>
        </div>
        <Switch
          on={push === "on"}
          label="Allow notifications"
          disabled={!canSwitch}
          busy={busy}
          onChange={(v) => void togglePush(v)}
        />
      </section>
      {push === "needs-home" ? (
        <p className="px-1 text-xs text-muted">
          iPhone only allows notifications for web apps opened from the Home Screen (iOS 16.4 or later). In Safari, tap
          Share → Add to Home Screen, then open Xclr from that icon and come back here.
        </p>
      ) : null}
      {push === "on" ? (
        <button type="button" onClick={() => void test()} disabled={busy} className="btn-secondary self-start text-[13px]">
          Send a test
        </button>
      ) : null}

      <section aria-labelledby="food-h" className="glass px-3.5 py-1">
        <h2 id="food-h" className="pt-2.5 text-xs font-bold text-muted">
          Food
        </h2>
        {FOOD_ROWS.map((r, i) => row(r, i === FOOD_ROWS.length - 1))}
      </section>

      <section aria-labelledby="train-h" className="glass px-3.5 py-1">
        <h2 id="train-h" className="pt-2.5 text-xs font-bold text-muted">
          Training &amp; coach
        </h2>
        {TRAIN_ROWS.map((r, i) => row(r, i === TRAIN_ROWS.length - 1))}
      </section>

      <section aria-labelledby="watch-h" className="glass px-3.5 py-1">
        <h2 id="watch-h" className="pt-2.5 text-xs font-bold text-muted">
          Watch &amp; activity
        </h2>
        {WATCH_ROWS.map((r, i) => row(r, i === WATCH_ROWS.length - 1))}
        <p className="pb-2.5 text-[11px] text-muted">
          These need Watch &amp; phone sync. Each goes out once a day at most, and only if it&apos;s still true.
        </p>
      </section>

      <label className="flex items-center gap-2 px-1 text-[13px] font-semibold text-muted">
        Quiet hours
        <select
          value={quiet}
          onChange={(e) => {
            const o = QUIET_OPTIONS.find((x) => x.value === e.target.value);
            if (o) void save({ ...prefs, quiet_start: o.start, quiet_end: o.end });
          }}
          className="field min-h-10 flex-1 text-[13px] text-ink"
        >
          {quiet === "custom" ? <option value="custom">Custom</option> : null}
          {QUIET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="-mt-1 px-1 text-xs text-muted">
        In quiet hours nothing buzzes your phone; reminders still land in the bell. Each one only fires if it&apos;s
        still true.
      </p>

      <p aria-live="polite" className="px-1 text-xs font-semibold empty:hidden">
        {msg ? <span className={msg.bad ? "text-ember-text" : "text-green"}>{msg.text}</span> : null}
      </p>
    </>
  );
}
