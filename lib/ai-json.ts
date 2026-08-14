import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, PROGRAM_MODEL } from "@/lib/anthropic";

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
// Errors are never swallowed silently — the caught Anthropic error is logged
// with its status + message to the server console.
export async function generateJson(opts: {
  system: string;
  user: string;
  schema: object;
  toolName: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}): Promise<AiJsonResult> {
  try {
    const message = await anthropic().messages.create({
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
    });

    if (message.stop_reason === "refusal")
      return { ok: false, error: "The coach declined that — try again." };
    if (message.stop_reason === "max_tokens")
      return { ok: false, error: "That ran long — tap to try again." };

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use")
      return { ok: false, error: "The coach didn't return a result. Try again." };

    return { ok: true, data: block.input };
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[generateJson:${opts.toolName}] Anthropic error status=${status ?? "?"} message=${message}`
    );
    return { ok: false, error: "Couldn't reach the coach — try again in a moment." };
  }
}
