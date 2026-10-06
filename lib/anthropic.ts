import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Program generation + coaching model. Per the claude-api guidance: default to
// the latest, most capable Claude model unless a specific one is requested.
export const PROGRAM_MODEL = "claude-opus-5";

// Wall-clock budget (seconds) for each AI-calling route. These MUST match the
// literal `export const maxDuration` on the page that invokes the action
// (Next needs that value as a literal, so it can't import these):
//   app/program/page.tsx            → program
//   app/(app)/workout/review/page.tsx → review
//   app/(app)/chat/page.tsx         → chat
export const AI_BUDGET_SECONDS = {
  program: 300,
  review: 300,
  chat: 120,
} as const;

// Thrown when ANTHROPIC_API_KEY isn't set in the running environment (e.g. the
// Vercel project is missing it), so the failure is named, not a vague SDK error.
export class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set in this environment");
    this.name = "MissingApiKeyError";
  }
}

let cached: Anthropic | null = null;

// Server-only Anthropic client. Reads ANTHROPIC_API_KEY from the environment —
// the key never leaves the server (this module is import-guarded by server-only).
// SDK auto-retry is off: lib/ai-call.ts owns retries so they fit the route's
// time budget instead of the SDK's 10-minute default.
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  if (!cached) cached = new Anthropic({ maxRetries: 0 });
  return cached;
}
