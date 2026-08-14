// Weekly review proposal contract (Doc 02 §4 → Master Spec §8 proposal_items).
// The AI references each program exercise by an integer `ref` we assign (not a
// uuid it would have to echo), and we map ref → program_exercise_id server-side.

export const PROPOSAL_FIELDS = [
  "suggested_load_value",
  "prescribed_sets",
  "rep_scheme",
  "coach_note",
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

export type ProposedItem = {
  ref: number;
  field: ProposalField;
  old_value: string;
  new_value: string;
  rationale: string;
};
export type ProposalOutput = { summary: string; items: ProposedItem[] };

export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "integer" },
          field: { type: "string", enum: [...PROPOSAL_FIELDS] },
          old_value: { type: "string" },
          new_value: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["ref", "field", "old_value", "new_value", "rationale"],
      },
    },
  },
  required: ["summary", "items"],
} as const;

type ValidationResult =
  | { ok: true; proposal: ProposalOutput }
  | { ok: false; error: string };

// Validate/normalize AI output. `maxRef` is the number of program exercises;
// items with an out-of-range ref or empty new_value are dropped.
export function validateProposal(input: unknown, maxRef: number): ValidationResult {
  if (!input || typeof input !== "object")
    return { ok: false, error: "Empty proposal." };
  const root = input as Record<string, unknown>;
  const summary = typeof root.summary === "string" ? root.summary.trim() : "";
  const rawItems = Array.isArray(root.items) ? root.items : [];

  const items: ProposedItem[] = [];
  for (const raw of rawItems) {
    const it = raw as Record<string, unknown>;
    const ref = typeof it.ref === "number" ? Math.round(it.ref) : NaN;
    const field = it.field as ProposalField;
    const oldValue = typeof it.old_value === "string" ? it.old_value.trim() : "";
    const newValue = typeof it.new_value === "string" ? it.new_value.trim() : "";
    const rationale = typeof it.rationale === "string" ? it.rationale.trim() : "";
    if (
      Number.isFinite(ref) &&
      ref >= 0 &&
      ref < maxRef &&
      PROPOSAL_FIELDS.includes(field) &&
      newValue.length > 0
    ) {
      items.push({ ref, field, old_value: oldValue, new_value: newValue, rationale });
    }
  }

  return { ok: true, proposal: { summary, items } };
}

// Coerce a proposal item's text new_value into the column type it targets.
export function coerceFieldValue(
  field: ProposalField,
  newValue: string
): { column: string; value: string | number } | null {
  if (field === "coach_note" || field === "rep_scheme")
    return { column: field, value: newValue };
  if (field === "prescribed_sets") {
    const n = Math.round(Number(newValue));
    return Number.isFinite(n) && n > 0 ? { column: field, value: n } : null;
  }
  if (field === "suggested_load_value") {
    const n = Number(newValue);
    return Number.isFinite(n) && n >= 0 ? { column: field, value: n } : null;
  }
  return null;
}
