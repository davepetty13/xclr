import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Program generation + coaching model. Per the claude-api guidance: default to
// the latest, most capable Claude model unless a specific one is requested.
export const PROGRAM_MODEL = "claude-opus-5";

let cached: Anthropic | null = null;

// Server-only Anthropic client. Reads ANTHROPIC_API_KEY from the environment —
// the key never leaves the server (this module is import-guarded by server-only).
export function anthropic(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}
