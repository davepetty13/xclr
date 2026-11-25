import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// v3 model plan (approved by Dave, Nov 2026). Cheap Haiku for everything that
// happens many times a day; Sonnet for the two rare, long, exact jobs.
// Pricing source: https://platform.claude.com/docs/en/about-claude/pricing
export const MODELS = {
  parse: "claude-haiku-5-5", // reading a log message
  coach: "claude-haiku-5-5", // answering a question
  vision: "claude-haiku-5-5", // reading a photo
  program: "claude-sonnet-5-5", // building a training program (~monthly)
  review: "claude-sonnet-5-5", // weekly progression review
} as const;

export type ModelJob = keyof typeof MODELS;

// USD per million tokens. Haiku 5.5's price is for prompts under 100k tokens —
// Xclr prompts are ~3–8k, so the higher tier never applies.
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};

export function costUsd(model: string, usage: Anthropic.Usage | null | undefined): number {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens * p.in +
      usage.output_tokens * p.out +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

// Wall-clock budget (seconds) for each AI-calling route. These MUST match the
// literal `export const maxDuration` on the page that invokes the action
// (Next needs that value as a literal, so it can't import these):
//   app/program/page.tsx              → program
//   app/(app)/workout/review/page.tsx → review
//   app/(app)/workout/page.tsx        → review (review can be generated there)
//   app/(app)/chat/page.tsx           → chat
//   app/(app)/photo/page.tsx          → chat (photo reads share the chat budget)
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
