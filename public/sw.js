// Xclr service worker: shows Web Push reminders and opens the right screen
// when one is tapped. No caching / offline logic on purpose.

// An in-app path only: "/x", never "//host" or "/\host" (same rule as lib/safe-url.ts).
const INTERNAL_PATH = /^\/(?![\/\\])/;
const internal = (v) => typeof v === "string" && INTERNAL_PATH.test(v);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Xclr", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Xclr";
  const url = internal(data.url) ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(internal(path) ? path : "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
