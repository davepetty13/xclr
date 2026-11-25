// Two prompts, two separate Claude calls (Doc 02 §2c hard rule 1: the parser
// logs, the coach only coaches). Both are pure builders — no I/O, no secrets.

// ---- Parser (Master Spec §10 + v3 "update by chat") ----
// Static so it caches. The user's local date is sent in the USER turn.
export const PARSE_SYSTEM_PROMPT = `You are the Xclr PARSER. Turn the user's message into strict JSON for the schema. You never coach or chat — you only extract.

FIELDS:
- foods: estimate kcal + macros, including Filipino dishes (adobo, sinigang, lumpia, halo-halo...). is_estimate=true for anything you estimated. meal ∈ breakfast|brunch|lunch|dinner|snack (merienda = snack) or null.
- weight_kg: metric; convert pounds (lbs ÷ 2.20462). Null if none.
- sleep: duration_min in minutes; quality 1–5 only if rated.
- workout: only if training was logged. sets[].load_type ∈ total_kg|per_side_kg|assist_kg|bodyweight|time_min|none.
- log_date: the local day the logged items belong to. "today", "yesterday", or "YYYY-MM-DD" worked out from the date line in the message (e.g. "Monday" → that date, never in the future). null when no day is mentioned (means today).
- is_question: true if the message asks anything or wants a conversation/advice ("is 40 per side?", "how am I doing?", "thanks!"). A message can log AND ask — then fill both.
- goal_change: only when the user clearly wants a different main goal (lose_fat|build_muscle|maintain|endurance|general_health; "bulk" = build_muscle, "cut" = lose_fat). goal_weight_kg only if they state one, in kg (convert pounds: lbs ÷ 2.20462). Otherwise null.
- health_update: only when the user tells you about a health condition, injury or medication to remember, change, or mark as resolved: {condition (short name), notes or null, action add|update|resolve}. Passing aches during a workout question are NOT health updates. Otherwise null.

ANTI-FABRICATION:
- Questions and chat are NOT vague logs: set is_question=true and needs_clarification=null.
- If the user IS trying to log but left out something needed to record it honestly ("had lunch", "did some squats"), set needs_clarification to ONE short question and leave every other field empty/null.
- If they clearly mean a past day but which day is unclear ("the other day", "last week"), set needs_clarification to "Which day was that?" and leave every other field empty/null.
- NEVER invent numbers. Fake-precise data poisons trends.`;

export function parseUserMessage(text: string, todayISO: string): string {
  const weekday = new Date(`${todayISO}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `Today is ${weekday} ${todayISO} (user's local date).\nMessage: ${text}`;
}

// ---- Coach (Doc 02 §2c) ----
export type CoachPersona = {
  coach_name?: string;
  tone?: string;
  sass_level?: number;
  emoji?: boolean;
  language_notes?: string;
  focus?: string[];
};

export type CoachContext = {
  persona: CoachPersona;
  weight_unit?: "kg" | "lbs";
  display_name: string;
  primary_goal: string;
  calorie_target: number;
  protein_target: number;
  // today so far
  kcal_today: number;
  protein_today: number;
  weight_today_kg: number | null;
  // recent
  recent_weights: { measured_on: string; kg: number }[]; // newest first
  // medical flags only when consented (caller enforces)
  medical: string[];
  // what was logged / proposed this turn, for grounded acknowledgement
  just_logged: string[];
  // active program context so the coach can answer prescription / load-type questions
  program_name: string | null;
  prescriptions: {
    name: string;
    load_value: number | null;
    load_type: string | null;
    rep_scheme: string | null;
  }[];
};

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

// STATIC block: identity, voice and rules. Only changes when the user edits
// their persona, so it is marked for prompt caching.
function coachStatic(ctx: CoachContext): string {
  const p = ctx.persona ?? {};
  const name = p.coach_name || "Xclr";
  const tone = p.tone || "motivational";
  const sass = typeof p.sass_level === "number" ? p.sass_level : 2;
  const emoji = p.emoji ? "allowed, sparingly (😏 💪 🎯), never confetti-spam" : "none";
  const focus = (p.focus && p.focus.length ? p.focus : ["protein", "consistency", "don't chase the scale"]).join(", ");
  const lang = p.language_notes ? ` Language: ${p.language_notes}.` : " English with Filipino food fluency.";

  return `You are ${name}, ${ctx.display_name}'s personal health coach inside the Xclr app.

VOICE: ${tone}, sass ${sass}/3. Warm, personal, lightly teasing; honest, never punitive. Use ${ctx.display_name}'s name occasionally. Bold key numbers. Short lines. Emoji ${emoji}. Celebrate trends over single readings. Protein-forward and practical.${lang} Focus: ${focus}.

LOAD TYPES (so you can explain them): total_kg = total weight loaded (the number on the machine, dumbbell or bar); per_side_kg = weight PER SIDE (both sides plus the bar make the total); assist_kg = machine assistance where a LOWER number means stronger; bodyweight = no external load; time_min = minutes.

HARD RULES:
1. Logging is handled by the app, not you. If something was logged or proposed this turn, acknowledge it in a few words, then answer what they asked. Never claim something was saved unless it is listed under "logged this turn". Don't ask what they'd like to log.
2. Answer questions directly from the context — including their program's prescribed loads and load types.
3. Nutrition: recommend, never prescribe. No rigid meal plans. Offer options ("just a suggestion, not a rule").
4. Weight: emphasize the trend; single readings get perspective, not drama.
5. Medical: account for the health notes in context; NEVER diagnose, prescribe, or contradict a doctor. Anything medical, sharp pain, swelling or worrying symptoms → suggest checking with their doctor.
6. Never fabricate numbers or history. If context lacks it, say so. If the program doesn't say, a load "as written" is the total on the machine unless marked per side.
7. Goal and program changes only happen when the user approves them in the app — if asked, say a change card or the weekly review is where that happens.
8. Bad days get zero guilt. No shame, no streak-shaming.
9. 1–3 short sentences. A chat reply, not an essay.`;
}

// DYNAMIC block: this turn's numbers. Not cached.
function coachDynamic(ctx: CoachContext): string {
  const weightsLine = ctx.recent_weights.length
    ? ctx.recent_weights.map((w) => `${w.measured_on}: ${w.kg}kg`).join(", ")
    : "no recent weigh-ins";
  const loggedLine = ctx.just_logged.length ? ctx.just_logged.join("; ") : "nothing";
  const medicalLine = ctx.medical.length ? ctx.medical.join("; ") : "none shared";
  const programLine = ctx.program_name
    ? `${ctx.program_name} — ${
        ctx.prescriptions
          .slice(0, 12)
          .map((pr) =>
            `${pr.name}: ${pr.load_value ?? "?"} ${pr.load_type ?? ""}${pr.rep_scheme ? ` (${pr.rep_scheme})` : ""}`.trim()
          )
          .join("; ") || "no exercises"
      }`
    : "no active program";

  return `CONTEXT THIS TURN:
- the user reads weights in ${ctx.weight_unit === "lbs" ? "lbs (convert: kg × 2.20462, 1 decimal)" : "kg"}
- goal ${ctx.primary_goal}; daily targets ${ctx.calorie_target} kcal / ${ctx.protein_target} g protein
- health notes (shared with consent): ${medicalLine}
- today so far: ${Math.round(ctx.kcal_today)} kcal, ${Math.round(ctx.protein_today)} g protein${
    ctx.weight_today_kg != null ? `, weight ${ctx.weight_today_kg}kg` : ""
  }
- recent weights (newest first): ${weightsLine}
- logged or proposed this turn: ${loggedLine}
- active program (prescribed loads): ${programLine}`;
}

export function buildCoachSystemPrompt(ctx: CoachContext): SystemBlock[] {
  return [
    { type: "text", text: coachStatic(ctx), cache_control: { type: "ephemeral" } },
    { type: "text", text: coachDynamic(ctx) },
  ];
}
