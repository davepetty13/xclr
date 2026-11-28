// Small URL checks shared by the bell, Web Push and the server actions.
// (public/sw.js can't import this, so it repeats INTERNAL_PATH inline.)

// An in-app path: starts with one "/" and is not "//host" or "/\host",
// which browsers treat as another site.
export const INTERNAL_PATH = /^\/(?![/\\])/;

export function isInternalPath(v: unknown): v is string {
  return typeof v === "string" && v.length <= 200 && INTERNAL_PATH.test(v);
}

// Web Push endpoints Xclr accepts: Google/Chrome (FCM), Apple, Mozilla and
// Windows. Matches the push_subscriptions_known_host CHECK in migration 008.
const PUSH_HOST = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)+push\.apple\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com)$/;

export function isKnownPushEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 1000 || /\s/.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    u.port === "" &&
    PUSH_HOST.test(u.hostname) &&
    v.startsWith(`https://${u.hostname}/`)
  );
}
