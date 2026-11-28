// The owner's auth user id (Dave). Hard-coded so the owner can never be
// deleted, locked out or skipped because of a database blip; the env var
// OWNER_USER_ID overrides it (e.g. a staging project). Server-side only by
// convention, but not a secret — it's safe in the middleware bundle.
export const OWNER_USER_ID: string =
  (process.env.OWNER_USER_ID || "").trim() || "b560932b-3eb2-4679-923b-af8c71c87b94";

export function isOwnerId(id: string | null | undefined): boolean {
  return !!id && id === OWNER_USER_ID;
}
