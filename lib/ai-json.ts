import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { PROGRAM_MODEL } from "@/lib/anthropic";
import { createMessage } from "@/lib/ai-call";

export type AiJsonResult = { ok: true; data: unknown } | { ok: false; error: string };

// Get strict JSON from Claude via FORCED TOOL USE.
//
// We deliberately do NOT use output_config.format (structured outputs): that
// path compiles + enforces the JSON Schema and rejects constructs our contracts
// need — notably nullable enums (`{type:["string","null"], enum:[...,null]}`),
// which return `400 invalid_request_error: Enum value ... does not match declared
// type`. A non-strict tool input_schema is a shape hint, not a compiled
// constraint, so the same schema is accepted and the model still returns a clean
// object in tool_use.input. Callers validate/normalize that object themselves.
//
// Errors are never swallowed silently — every failure (API error, refusal,
// truncation, missing tool call) is logged with its status/reason to the
// server console, and the caller gets a failure-specific message. Transient
// API errors are retried within the route's time budget (lib/ai-call.ts).
export async function generateJson(opts: {
  system: string;
  user: string;
  schema: object;
  toolName: string;
  maxTokens: number;
  deadline: number;
  effort?: "low" | "medium" | "high";
}): Promise<AiJsonResult> {
  const r = await createMessage(
    {
      model: PROGRAM_MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      tools: [
        {
          name: opts.toolName,
          description: "Return the result as structured JSON via this tool.",
          input_schema: opts.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.user }],
    },
    { label: `generateJson:${opts.toolName}`, deadline: opts.deadline }
  );
  if (!r.ok) return { ok: false, error: r.error };
  const message = r.message;
  const tag = `[generateJson:${opts.toolName}]`;

  if (message.stop_reason === "refusal") {
    console.error(`${tag} refusal stop_details=${JSON.stringify(message.stop_details ?? null)}`);
    return { ok: false, error: "The coach declined that request. Try rewording it." };
  }
  if (message.stop_reason === "max_tokens") {
    console.error(
      `${tag} hit max_tokens=${opts.maxTokens} output_tokens=${message.usage.output_tokens}`
    );
    return { ok: false, error: "The coach's answer ran too long and got cut off. Try again." };
  }

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    console.error(`${tag} no tool_use block stop_reason=${message.stop_reason}`);
    return { ok: false, error: "The coach answered without a usable result. Try again." };
  }

  return { ok: true, data: block.input };
}
