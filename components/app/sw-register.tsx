"use client";

import { useEffect } from "react";

// Registers /sw.js once per load so Web Push can reach this device.
// Silent when the browser has no service workers.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: reminders still land in the in-app bell.
    });
  }, []);
  return null;
}
