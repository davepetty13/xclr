import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, costUsd, MissingApiKeyError } from "@/lib/anthropic";
import type { createClient } from "@/lib/supabase/server";
import { getCoachUse } from "@/lib/ai-limit";

// Optional: record this call's tokens + cost in ai_usage (Goals → AI usage).
// Best-effort — a failed usage write never fails the AI call.
export type UsageTrack = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  label: string; // parse|coach|vision|program|review
};

async function recordUsage(track: UsageTrack, model: string, message: Anthropic.Message) {
  const u = message.usage;
  const { error } = await track.supabase.from("ai_usage").insert({
    user_id: track.userId,
    label: track.label,
    model,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cache_write_tokens: u.cache_creation_input_tokens ?? 0,
    cost_usd: Number(costUsd(model, u).toFixed(6)),
  });
  if (error) console.error(`[ai_usage] ${error.message}`);
}

export type AiFailureKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "timeout"
  | "connection"
  | "bad_request"
  | "limit" // this month's AI limit is used up — the API was NOT called
  | "unknown";

export type AiCallResult =
  | { ok: true; message: Anthropic.Message }
  | { ok: false; kind: AiFailureKind; status: number | null; error: string };

const MAX_ATTEMPTS = 3;
// Kept free at the end of the budget for DB writes + returning the response.
const SAFETY_MS = 8_000;
// Don't start (or retry) an attempt with less time than this left.
const MIN_ATTEMPT_MS = 10_000;

export function deadlineAfter(seconds: number): number {
  return Date.now() + seconds * 1000;
}

type Classified = {
  kind: AiFailureKind;
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
};

function retryAfterMs(headers: Headers | undefined): number | null {
  if (!headers) return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(headers.get("retry-after"));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return null;
}

function classify(err: unknown): Classified {
  if (err instanceof MissingApiKeyError)
    return { kind: "config", status: null, retryable: false, retryAfterMs: null };
  // Timeout first — it subclasses APIConnectionError.
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return { kind: "timeout", status: null, retryable: true, retryAfterMs: null };
  if (err instanceof Anthropic.APIConnectionError)
    return { kind: "connection", status: null, retryable: true, retryAfterMs: null };
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    const status = err.status;
    const after = retryAfterMs(err.headers);
    if (status === 401 || status === 403)
      return { kind: "auth", status, retryable: false, retryAfterMs: null };
    if (status === 429)
      return { kind: "rate_limit", status, retryable: true, retryAfterMs: after };
    if (status === 408)
      return { kind: "timeout", status, retryable: true, retryAfterMs: after };
    if (status === 409)
      return { kind: "unknown", status, retryable: true, retryAfterMs: after };
    if (status >= 500)
      return { kind: "overloaded", status, retryable: true, retryAfterMs: after };
    return { kind: "bad_request", status, retryable: false, retryAfterMs: null };
  }
  return { kind: "unknown", status: null, retryable: false, retryAfterMs: null };
}

// Plain-language, failure-specific copy. The status code is included so a
// screenshot is enough to tell a rotated key from an overload.
export function aiFailureMessage(
  kind: AiFailureKind,
  status: number | null,
  attempts = 1
): string {
  const code = status != null ? ` (error ${status})` : "";
  const tried = attempts > 1 ? ` Tried ${attempts} times.` : "";
  switch (kind) {
    case "config":
      return "The coach isn't set up on the server — the Anthropic API key is missing. Retrying won't help; the server config needs fixing.";
    case "auth":
      return `The coach's API key was rejected${code}. It may have been rotated — retrying won't help; the server config needs fixing.`;
    case "rate_limit":
      return `The coach is rate-limited right now${code}. Give it a minute, then try again.${tried}`;
    case "overloaded":
      return status === 529
        ? `Anthropic's servers are overloaded right now${code}. Try again in a minute or two.${tried}`
        : `Anthropic's servers had an error${code}. Try again in a minute or two.${tried}`;
    case "timeout":
      return `The coach took too long to answer and timed out.${tried} Try again.`;
    case "connection":
      return `Couldn't connect to the coach's servers.${tried} Try again in a moment.`;
    case "limit":
      return "This month's coach limit is used up. You can still log food, workouts and Watch data — saved meals and quick logs don't use the coach.";
    case "bad_request":
      return `The coach rejected the request${code} — that's a bug on our side and it's been logged.`;
    default:
      return `The coach hit an unexpected error${code} — it's been logged. Try again.`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One Messages API call with bounded retry + exponential backoff on transient
// failures (429, 5xx/529, 408/409, connection drops, timeouts). Every attempt
// is time-boxed to what's left of the route's budget, so we fail with a clear
// message before Vercel kills the function. Every failure is logged with
// label + attempt + kind + status + message — never swallowed.
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: { label: string; deadline: number; track?: UsageTrack }
): Promise<AiCallResult> {
  // Monthly AI limit (lib/ai-limit.ts): every user-triggered call carries
  // `track`, so this one guard covers chat, photo reads, program builds and
  // weekly reviews. Over the limit → the API is never called.
  if (opts.track) {
    const use = await getCoachUse(opts.track.supabase, opts.track.userId);
    if (use.limited) {
      console.warn(`[ai:${opts.label}] monthly limit reached user=${opts.track.userId} spend=$${use.spend.toFixed(4)} limit=$${use.limit}`);
      return { ok: false, kind: "limit", status: null, error: use.message };
    }
  }

  let last: Classified | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = opts.deadline - SAFETY_MS - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      console.error(
        `[ai:${opts.label}] out of time budget before attempt ${attempt} (remaining=${remaining}ms)`
      );
      break;
    }
    attempts = attempt;
    try {
      const message = await anthropic().messages.create(params, {
        timeout: remaining,
        maxRetries: 0,
      });
      if (attempt > 1)
        console.warn(`[ai:${opts.label}] succeeded on attempt ${attempt}`);
      const u = message.usage;
      console.info(
        `[ai:${opts.label}] model=${params.model} in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cost=$${costUsd(params.model, u).toFixed(5)}`
      );
      if (opts.track) await recordUsage(opts.track, params.model, message);
      return { ok: true, message };
    } catch (err) {
      last = classify(err);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[ai:${opts.label}] attempt ${attempt}/${MAX_ATTEMPTS} failed kind=${last.kind} status=${last.status ?? "?"} message=${msg}`
      );
      if (!last.retryable || attempt === MAX_ATTEMPTS) break;

      const backoff =
        last.retryAfterMs ?? 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      if (Date.now() + backoff + MIN_ATTEMPT_MS > opts.deadline - SAFETY_MS) {
        console.error(
          `[ai:${opts.label}] no time left in budget to retry after ${backoff}ms backoff`
        );
        break;
      }
      await sleep(backoff);
    }
  }

  const kind = last?.kind ?? "timeout";
  const status = last?.status ?? null;
  return { ok: false, kind, status, error: aiFailureMessage(kind, status, attempts) };
}
