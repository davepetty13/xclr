"use server";

import { createClient } from "@/lib/supabase/server";
import { AI_BUDGET_SECONDS, MODELS } from "@/lib/anthropic";
import { createMessage, deadlineAfter } from "@/lib/ai-call";
import { generateJson } from "@/lib/ai-json";
import {
  PARSE_JSON_SCHEMA,
  normalizeParse,
  numbersInText,
  appearsIn,
  MEALS,
  type ParsedCorrection,
  type ParsedInput,
} from "@/lib/parse-schema";
import {
  PARSE_SYSTEM_PROMPT,
  buildCoachSystemPrompt,
  parseUserMessage,
  type CoachContext,
  type CoachPersona,
  type ParseContext,
} from "@/lib/chat-prompts";
import {
  matchLibraryMessage,
  loggedFoodsLine,
  fixedFoodLine,
  patchCard,
  type CardFood,
  type CardRef,
  type ChatCard,
  type FoodSnapshot,
  type LibraryRow,
} from "@/lib/chat-library";
import { getUserTz, previewTargets, GOAL_LABEL } from "@/lib/goal-change";
import { todayWindow, addDays, noonOnLocalDateISO, prettyDate } from "@/lib/time";
import { upsertFoodLibrary } from "@/lib/food";
import { resolveExerciseIds } from "@/lib/exercises";
import { getActiveProgram } from "@/lib/programs";

type Supa = ReturnType<typeof createClient>;
type Win = { date: string; start: string; end: string };

export type ChatMode = "log" | "ask";

export type ChatResult =
  | {
      ok: true;
      reply: string;
      cards: ChatCard[];
      messageId: string | null;
      kcal_today: number;
      protein_today: number;
    }
  | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = "You're signed out — sign in again.";

// ---------- helpers ----------

function newKey(i: number): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${i}`;
}

function cleanMeal(meal: string | null | undefined): string | null {
  return meal && MEALS.includes(meal as (typeof MEALS)[number]) ? meal : null;
}

function nnum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function isDateISO(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

async function todayTotals(supabase: Supa, userId: string, win: Win) {
  const { data } = await supabase
    .from("food_logs")
    .select("kcal, protein_g")
    .eq("user_id", userId)
    .gte("logged_at", win.start)
    .lt("logged_at", win.end);
  return {
    kcal: (data ?? []).reduce((s, r) => s + (Number(r.kcal) || 0), 0),
    protein: (data ?? []).reduce((s, r) => s + (Number(r.protein_g) || 0), 0),
  };
}

async function loadLibrary(supabase: Supa, userId: string): Promise<LibraryRow[]> {
  const { data } = await supabase
    .from("food_library")
    .select("id, name, serving, kcal, protein_g, carbs_g, fat_g, times_logged")
    .eq("user_id", userId);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    serving: (r.serving as string | null) ?? null,
    kcal: r.kcal != null ? Number(r.kcal) : null,
    protein_g: r.protein_g != null ? Number(r.protein_g) : null,
    carbs_g: r.carbs_g != null ? Number(r.carbs_g) : null,
    fat_g: r.fat_g != null ? Number(r.fat_g) : null,
    times_logged: r.times_logged != null ? Number(r.times_logged) : null,
  }));
}

function fromLibrary(row: LibraryRow): CardFood {
  return {
    name: row.name,
    serving: row.serving,
    kcal: row.kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    is_estimate: false,
    library_id: row.id,
  };
}

function normServing(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// True when the stated portion is empty, "1 serving", or the same as the saved serving.
function sameServing(stated: string | null, saved: string | null): boolean {
  const a = normServing(stated);
  if (!a || /^(1|one|a)( serving| portion| order)?$/.test(a)) return true;
  const b = normServing(saved);
  if (!b) return false;
  if (a === b) return true;
  const unit = (x: string) => x.replace(/^(1|one|a)\s+/, "").replace(/s\b/, "");
  return /^(1|one|a)\s+/.test(a) && /^(1|one|a)\s+/.test(b) && unit(a) === unit(b);
}

// The user's own library numbers win over any estimate (Spec §7).
function resolveWithLibrary(items: CardFood[], lib: LibraryRow[]): CardFood[] {
  const byLower = new Map(lib.map((r) => [r.name.toLowerCase(), r]));
  return items.map((f) => {
    // Numbers the user typed beat the library too.
    if (f.user_stated) return { ...f, library_id: null, is_estimate: false };
    const known = byLower.get(f.name.trim().toLowerCase());
    if (!known) return { ...f, library_id: null };
    // Only use the saved numbers when the portion is the saved one. "2 cups
    // adobo" against a "1 cup" entry keeps the estimate (and stays an estimate).
    if (!sameServing(f.serving, known.serving)) return { ...f, library_id: null, is_estimate: true };
    return { ...fromLibrary(known), serving: known.serving ?? f.serving };
  });
}

async function bumpLibrary(supabase: Supa, userId: string, items: CardFood[], lib: LibraryRow[]) {
  const counts = new Map<string, number>();
  for (const f of items) if (f.library_id) counts.set(f.library_id, (counts.get(f.library_id) ?? 0) + 1);
  for (const [id, n] of Array.from(counts)) {
    const row = lib.find((r) => r.id === id);
    const { error } = await supabase
      .from("food_library")
      .update({ times_logged: (row?.times_logged ?? 1) + n })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) console.error(`[chat library bump] ${error.message}`);
  }
}

async function insertFoods(
  supabase: Supa,
  userId: string,
  items: CardFood[],
  meal: string | null,
  loggedAt: string
): Promise<CardFood[] | null> {
  const rows = items.map((f) => ({
    user_id: userId,
    logged_at: loggedAt,
    meal,
    name: f.name,
    serving: f.serving,
    kcal: f.kcal,
    protein_g: f.protein_g,
    carbs_g: f.carbs_g,
    fat_g: f.fat_g,
    source: f.library_id ? "library" : "chat",
    is_estimate: f.library_id ? false : f.is_estimate,
  }));
  const { data, error } = await supabase.from("food_logs").insert(rows).select("id");
  if (error || !data || data.length !== rows.length) {
    if (error) console.error(`[chat food insert] ${error.message}`);
    return null;
  }
  return items.map((f, i) => ({ ...f, id: data[i].id as string }));
}

async function persistTurn(
  supabase: Supa,
  userId: string,
  userText: string,
  reply: string,
  cards: ChatCard[]
): Promise<string | null> {
  const nowMs = Date.now();
  const { error: uErr } = await supabase
    .from("messages")
    .insert({ user_id: userId, role: "user", content: userText, created_at: new Date(nowMs).toISOString() });
  if (uErr) console.error(`[messages persist user] ${uErr.message}`);
  const { data, error } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      role: "coach",
      content: reply,
      meta: cards.length ? { cards } : null,
      created_at: new Date(nowMs + 1).toISOString(),
    })
    .select("id")
    .single();
  // Persistence is best-effort (the reply still returns) — but log, don't swallow.
  if (error) {
    console.error(`[messages persist coach] ${error.message}`);
    return null;
  }
  return (data?.id as string) ?? null;
}

// ---------- recent context + corrections ----------

type RecentFood = FoodSnapshot & { id: string; meal: string | null; logged_at: string };

const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;

// What the parser may refer back to: the user's last ≤3 food logs from the last
// 2 hours (newest first, so index 0 = most recent) and the previous exchange.
async function loadRecentContext(
  supabase: Supa,
  userId: string
): Promise<{ foods: RecentFood[]; prompt: ParseContext }> {
  const now = Date.now();
  const { data: rows, error: fErr } = await supabase
    .from("food_logs")
    .select("id, name, serving, kcal, protein_g, carbs_g, fat_g, meal, logged_at, is_estimate")
    .eq("user_id", userId)
    .gte("logged_at", new Date(now - RECENT_WINDOW_MS).toISOString())
    .lte("logged_at", new Date(now + 60_000).toISOString())
    .order("logged_at", { ascending: false })
    .limit(3);
  if (fErr) console.error(`[chat recent foods] ${fErr.message}`);
  const n = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const foods: RecentFood[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    serving: (r.serving as string | null) ?? null,
    kcal: n(r.kcal),
    protein_g: n(r.protein_g),
    carbs_g: n(r.carbs_g),
    fat_g: n(r.fat_g),
    is_estimate: r.is_estimate !== false,
    meal: (r.meal as string | null) ?? null,
    logged_at: r.logged_at as string,
  }));

  // The turn being answered isn't persisted yet, so the newest two are the previous exchange.
  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(2);
  if (mErr) console.error(`[chat recent messages] ${mErr.message}`);
  const prevUser = (msgs ?? []).find((m) => m.role === "user")?.content as string | undefined;
  const prevReply = (msgs ?? []).find((m) => m.role === "coach")?.content as string | undefined;

  return {
    foods,
    prompt: {
      foods: foods.map((f) => ({
        ...f,
        minutes_ago: Math.max(0, Math.round((now - Date.parse(f.logged_at)) / 60_000)),
      })),
      prev_user: prevUser ? prevUser.slice(0, 300) : null,
      prev_reply: prevReply ? prevReply.slice(0, 300) : null,
    },
  };
}

type FixPlan =
  | { ok: true; target: RecentFood; patch: Partial<FoodSnapshot>; next: FoodSnapshot }
  | { ok: false; question: string };

const NUM_FIELDS = ["kcal", "protein_g", "carbs_g", "fat_g"] as const;

// Turn the parser's correction into an exact row patch — or ONE question.
// Only fields the user stated (or that follow from a new amount) change.
function planCorrection(c: ParsedCorrection, recent: RecentFood[], text: string): FixPlan {
  if (!recent.length)
    return { ok: false, question: "I don't see anything logged in the last 2 hours to fix. What should I log?" };
  const target = c.target_index >= 0 ? recent[c.target_index] : undefined;
  if (!target) {
    const names = Array.from(new Set(recent.map((r) => r.name)));
    return {
      ok: false,
      question: names.length > 1 ? `Which one should I fix — ${names.join(" or ")}?` : `Should I fix the ${names[0]}?`,
    };
  }

  const typed = numbersInText(text);
  const patch: Partial<FoodSnapshot> = {};
  let statedApplied = false;
  for (const k of NUM_FIELDS) {
    const v = c[k];
    if (v == null) continue;
    if (c.user_stated_numbers) {
      // "User said so" must be visible in what they typed — else keep the old value.
      if (!appearsIn(v, typed)) continue;
      statedApplied = true;
    }
    if (v !== target[k]) patch[k] = v;
  }
  if (c.serving && c.serving !== target.serving) patch.serving = c.serving;
  // A new amount with only some numbers typed ("2 cups, 600 kcal"): the other
  // values follow the new amount too (model-scaled), so the row stays coherent —
  // but then it's still partly an estimate.
  let modelFilled = false;
  if (patch.serving !== undefined && c.user_stated_numbers) {
    for (const k of NUM_FIELDS) {
      const v = c[k];
      if (v == null || patch[k] !== undefined || appearsIn(v, typed)) continue;
      if (v !== target[k]) {
        patch[k] = v;
        modelFilled = true;
      }
    }
  }
  const renamed = !!c.name && c.name.trim().toLowerCase() !== target.name.trim().toLowerCase();
  if (renamed) patch.name = c.name!;

  if (!Object.keys(patch).length && !statedApplied)
    return { ok: false, question: `What should the ${target.name} be — size, calories or protein?` };

  // Typed numbers → no longer an estimate. A new food with model numbers → estimate.
  patch.is_estimate = statedApplied && !modelFilled ? false : renamed || modelFilled ? true : target.is_estimate;
  const next: FoodSnapshot = {
    name: patch.name ?? target.name,
    serving: patch.serving !== undefined ? patch.serving : target.serving,
    kcal: patch.kcal !== undefined ? patch.kcal : target.kcal,
    protein_g: patch.protein_g !== undefined ? patch.protein_g : target.protein_g,
    carbs_g: patch.carbs_g !== undefined ? patch.carbs_g : target.carbs_g,
    fat_g: patch.fat_g !== undefined ? patch.fat_g : target.fat_g,
    is_estimate: patch.is_estimate,
  };
  return { ok: true, target, patch, next };
}

function sharedMeal(foods: { meal: string | null }[]): string | null {
  const meals = Array.from(new Set(foods.map((f) => f.meal)));
  return meals.length === 1 ? cleanMeal(meals[0]) : null;
}

// "today" | "yesterday" | YYYY-MM-DD | null → a local date, or null if it's in
// the future / more than a year back / unreadable (→ ask which day).
function resolveLogDate(raw: string | null, today: string): string | null {
  if (!raw || raw === "today") return today;
  if (raw === "yesterday") return addDays(today, -1);
  if (!isDateISO(raw)) return null;
  if (raw > today || raw < addDays(today, -366)) return null;
  return raw;
}

function dayWord(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  return prettyDate(date);
}

async function buildCoachContext(
  supabase: Supa,
  userId: string,
  win: Win,
  totals: { kcal: number; protein: number },
  justLogged: string[]
): Promise<CoachContext> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, primary_goal, daily_calorie_target, daily_protein_target, coach_persona, health_data_consent_at, weight_unit")
    .eq("id", userId)
    .single();

  const { data: recentWeights } = await supabase
    .from("weights")
    .select("measured_on, kg")
    .eq("user_id", userId)
    .order("measured_on", { ascending: false })
    .limit(7);
  const weightToday = (recentWeights ?? []).find((w) => w.measured_on === win.date)?.kg ?? null;

  // Medical context only with consent (never sent to the AI otherwise).
  let medical: string[] = [];
  if (profile?.health_data_consent_at) {
    const { data: conds } = await supabase
      .from("medical_conditions")
      .select("condition, notes")
      .eq("user_id", userId)
      .eq("active", true);
    medical = (conds ?? []).map((c) =>
      c.notes ? `${c.condition as string} (${c.notes as string})` : (c.condition as string)
    );
  }

  let programName: string | null = null;
  let prescriptions: CoachContext["prescriptions"] = [];
  const activeProgram = await getActiveProgram(supabase, userId);
  if (activeProgram) {
    programName = activeProgram.name;
    const { data: days } = await supabase
      .from("program_days")
      .select("id")
      .eq("user_id", userId)
      .eq("program_id", activeProgram.id);
    const dayIds = (days ?? []).map((d) => d.id as string);
    if (dayIds.length) {
      const { data: pes } = await supabase
        .from("program_exercises")
        .select("exercise_id, suggested_load_value, suggested_load_type, rep_scheme")
        .eq("user_id", userId)
        .in("program_day_id", dayIds);
      const { data: exRows } = await supabase.from("exercises").select("id, name").eq("user_id", userId);
      const nameById = new Map<string, string>();
      for (const e of exRows ?? []) nameById.set(e.id as string, e.name as string);
      prescriptions = (pes ?? []).map((pe) => ({
        name: nameById.get(pe.exercise_id as string) ?? "Exercise",
        load_value: pe.suggested_load_value as number | null,
        load_type: pe.suggested_load_type as string | null,
        rep_scheme: pe.rep_scheme as string | null,
      }));
    }
  }

  return {
    persona: (profile?.coach_persona as CoachPersona) ?? {},
    display_name: profile?.display_name ?? "there",
    primary_goal: profile?.primary_goal ?? "general_health",
    weight_unit: profile?.weight_unit === "lbs" ? "lbs" : "kg",
    calorie_target: Number(profile?.daily_calorie_target) || 2200,
    protein_target: Number(profile?.daily_protein_target) || 150,
    kcal_today: totals.kcal,
    protein_today: totals.protein,
    weight_today_kg: weightToday != null ? Number(weightToday) : null,
    recent_weights: (recentWeights ?? []).map((w) => ({ measured_on: w.measured_on as string, kg: Number(w.kg) })),
    medical,
    just_logged: justLogged,
    program_name: programName,
    prescriptions,
  };
}

async function askCoach(
  supabase: Supa,
  userId: string,
  text: string,
  ctx: CoachContext,
  deadline: number
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const coach = await createMessage(
    {
      model: MODELS.coach,
      max_tokens: 1000,
      system: buildCoachSystemPrompt(ctx),
      output_config: { effort: "low" },
      messages: [{ role: "user", content: text }],
    },
    { label: "coach reply", deadline, track: { supabase, userId, label: "coach" } }
  );
  if (!coach.ok) return { ok: false, error: coach.error };
  const t = coach.message.content.find((b) => b.type === "text");
  const out = t && t.type === "text" ? t.text.trim() : "";
  if (out) return { ok: true, text: out };
  // Logged, not swallowed: e.g. thinking used the whole max_tokens.
  console.error(
    `[coach reply] no text stop_reason=${coach.message.stop_reason} output_tokens=${coach.message.usage.output_tokens}`
  );
  return {
    ok: false,
    error:
      coach.message.stop_reason === "refusal"
        ? "Your coach declined to answer that one."
        : "Your coach's reply came back empty. Try asking again.",
  };
}

// ---------- main entry ----------

export async function sendChatMessage(text: string, mode: ChatMode = "log"): Promise<ChatResult> {
  // One budget shared by the parse + coach calls (matches the page maxDuration).
  const deadline = deadlineAfter(AI_BUDGET_SECONDS.chat);
  const clean = (text ?? "").trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "Say something first." };
  const askOnly = mode === "ask";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const userId = user.id;

  const tz = await getUserTz(supabase, userId);
  const win = todayWindow(tz);

  const cards: ChatCard[] = [];
  const justLogged: string[] = [];
  const lines: string[] = [];
  const failed: string[] = [];
  let todayFoodCard: Extract<ChatCard, { kind: "food" }> | null = null;
  let fixCard: Extract<ChatCard, { kind: "food_fixed" }> | null = null;
  let callCoach = askOnly;
  let parsed: ParsedInput | null = null;

  if (!askOnly) {
    const lib = await loadLibrary(supabase, userId);

    // ---- 1a. Library-first: every piece is a saved dish → no AI at all. ----
    const match = matchLibraryMessage(clean, lib);
    if (match) {
      const items = match.rows.map(fromLibrary);
      const written = await insertFoods(supabase, userId, items, match.meal, new Date().toISOString());
      if (!written) return { ok: false, error: "Couldn't save that. Try again." };
      await bumpLibrary(supabase, userId, written, lib);
      const totals = await todayTotals(supabase, userId, win);
      const card: ChatCard = {
        key: newKey(0),
        kind: "food",
        meal: match.meal,
        via: "library",
        items: written,
        kcal_today: totals.kcal,
        protein_today: totals.protein,
        status: "logged",
      };
      const reply = loggedFoodsLine(match.meal, written.map((f) => f.name), totals.kcal, totals.protein);
      const messageId = await persistTurn(supabase, userId, clean, reply, [card]);
      return { ok: true, reply, cards: [card], messageId, kcal_today: totals.kcal, protein_today: totals.protein };
    }

    // ---- 1b. Haiku parser, with recent context so "that" / "you logged it wrong" resolve. ----
    const recent = await loadRecentContext(supabase, userId);
    const parseResult = await generateJson({
      job: "parse",
      system: PARSE_SYSTEM_PROMPT,
      user: parseUserMessage(clean, win.date, recent.prompt),
      schema: PARSE_JSON_SCHEMA,
      toolName: "log_entry",
      maxTokens: 2000,
      deadline,
      effort: "low",
      track: { supabase, userId },
    });
    if (!parseResult.ok) return { ok: false, error: parseResult.error };
    parsed = normalizeParse(parseResult.data);

    // A correction updates the old row — never also log the same item again.
    if (parsed.correction) {
      const target = recent.foods[parsed.correction.target_index];
      const names = new Set(
        [target?.name, parsed.correction.name].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase())
      );
      parsed = { ...parsed, foods: parsed.foods.filter((f) => !names.has(f.name.trim().toLowerCase())) };
    }

    // Anti-fabrication guard in CODE (not just the model): a food with no
    // numbers, or a set with neither load nor reps (unless bodyweight / timed),
    // is too vague to save. If anything gets dropped, ask and write nothing.
    {
      const foodsIn = parsed.foods.length;
      const setsIn = parsed.workout?.sets.length ?? 0;
      const foods = parsed.foods.filter((f) =>
        [f.kcal, f.protein_g, f.carbs_g, f.fat_g].some((v) => v != null)
      );
      const sets = (parsed.workout?.sets ?? []).filter(
        (x) =>
          x.load_value != null ||
          x.reps != null ||
          x.load_type === "bodyweight" ||
          x.load_type === "time_min"
      );
      if (!parsed.needs_clarification && (foods.length < foodsIn || sets.length < setsIn)) {
        parsed = {
          ...parsed,
          needs_clarification:
            foods.length < foodsIn
              ? "What did you have, and roughly how much?"
              : "What did you do for those sets — weight and reps?",
        };
      }
    }

    const hasLoggable = !!(parsed.foods.length || parsed.weight_kg != null || parsed.sleep || parsed.workout);
    const date = resolveLogDate(parsed.log_date, win.date);
    // A correction with only numbers/size is NOT vague when a recent item fits;
    // an unclear target or an empty change is → one question.
    const fixPlan = parsed.correction ? planCorrection(parsed.correction, recent.foods, clean) : null;

    // ---- 2. Anti-fabrication: vague → ask ONE question, write NOTHING. ----
    const clarify =
      parsed.needs_clarification ??
      (fixPlan && !fixPlan.ok ? fixPlan.question : null) ??
      (hasLoggable && !date ? "Which day was that?" : null);
    if (clarify) {
      const totals = await todayTotals(supabase, userId, win);
      const messageId = await persistTurn(supabase, userId, clean, clarify, []);
      return { ok: true, reply: clarify, cards: [], messageId, kcal_today: totals.kcal, protein_today: totals.protein };
    }
    const day = date ?? win.date;
    const isToday = day === win.date;

    // Correction → UPDATE that row (user-scoped). No new row.
    if (fixPlan?.ok) {
      const { target, patch, next } = fixPlan;
      const { data: upd, error } = await supabase
        .from("food_logs")
        .update(patch)
        .eq("id", target.id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error || !upd) {
        if (error) console.error(`[chat food fix] ${error.message}`);
        failed.push(`the fix to ${target.name}`);
      } else {
        const { id, name, serving, kcal, protein_g, carbs_g, fat_g, is_estimate } = target;
        fixCard = {
          key: newKey(cards.length),
          kind: "food_fixed",
          item: { id, ...next },
          previous: { name, serving, kcal, protein_g, carbs_g, fat_g, is_estimate },
          kcal_today: 0,
          protein_today: 0,
          status: "fixed",
        };
        cards.push(fixCard);
        justLogged.push(
          `corrected ${target.name} → ${next.name}${next.serving ? `, ${next.serving}` : ""}${next.kcal != null ? ` ${Math.round(next.kcal)} kcal` : ""}`
        );
      }
    }

    // Foods: today → write now (with Undo). Past day → card, written on tap.
    if (parsed.foods.length) {
      const meal = sharedMeal(parsed.foods);
      const typedNums = numbersInText(clean);
      const items = resolveWithLibrary(
        parsed.foods.map((f) => {
          // "Stated" only when the kcal or protein number really is in the message.
          const stated =
            f.user_stated_numbers && (appearsIn(f.kcal, typedNums) || appearsIn(f.protein_g, typedNums));
          return {
            name: f.name,
            serving: f.serving,
            kcal: f.kcal,
            protein_g: f.protein_g,
            carbs_g: f.carbs_g,
            fat_g: f.fat_g,
            is_estimate: stated ? false : f.user_stated_numbers ? true : f.is_estimate,
            user_stated: stated,
          };
        }),
        lib
      );
      if (isToday) {
        // Per-food meal is kept on the row; the card shows the shared one.
        const written: CardFood[] = [];
        let ok = true;
        for (const m of Array.from(new Set(parsed.foods.map((f) => f.meal)))) {
          const group = items.filter((_, i) => parsed!.foods[i].meal === m);
          const res = await insertFoods(supabase, userId, group, cleanMeal(m), new Date().toISOString());
          if (!res) ok = false;
          else written.push(...res);
        }
        if (!ok) failed.push("some of the food");
        if (written.length) {
          await bumpLibrary(supabase, userId, written, lib);
          todayFoodCard = {
            key: newKey(cards.length),
            kind: "food",
            meal,
            via: written.every((f) => f.library_id) ? "library" : "parse",
            items: written,
            kcal_today: 0,
            protein_today: 0,
            status: "logged",
          };
          cards.push(todayFoodCard);
          justLogged.push(
            ...written.map((f) => `${f.name}${f.kcal != null ? ` ~${Math.round(f.kcal)} kcal` : ""}`)
          );
        }
      } else {
        cards.push({ key: newKey(cards.length), kind: "food_past", meal, date: day, items, status: "pending" });
        justLogged.push(`proposed adding ${items.map((f) => f.name).join(", ")} to ${prettyDate(day)} (not saved yet — needs a tap)`);
        lines.push(`Here's what I'd add to ${prettyDate(day)}. Tap Add to save it.`);
      }
    }

    // Weight → that local day (metric only), with Undo.
    if (parsed.weight_kg != null) {
      const kg = Math.round(parsed.weight_kg * 100) / 100;
      if (kg < 20 || kg > 400) {
        lines.push("That weight looks off, so I didn't save it. Can you check the number?");
      } else {
        const { data: same } = await supabase
          .from("weights")
          .select("kg")
          .eq("user_id", userId)
          .eq("measured_on", day)
          .maybeSingle();
        const { data: before } = await supabase
          .from("weights")
          .select("kg")
          .eq("user_id", userId)
          .lt("measured_on", day)
          .order("measured_on", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error } = await supabase
          .from("weights")
          .upsert({ user_id: userId, measured_on: day, kg }, { onConflict: "user_id,measured_on" });
        if (error) {
          console.error(`[chat weight] ${error.message}`);
          failed.push("your weight");
        } else {
          const delta = before ? Math.round((kg - Number(before.kg)) * 100) / 100 : null;
          cards.push({
            key: newKey(cards.length),
            kind: "weight",
            date: day,
            kg,
            delta,
            previous_kg: same ? Number(same.kg) : null,
            status: "saved",
          });
          justLogged.push(`weight ${kg} kg for ${dayWord(day, win.date)}`);
          lines.push(isToday ? "Weight saved." : `Weight saved for ${dayWord(day, win.date)}.`);
        }
      }
    }

    // Sleep → that local day, with Undo.
    if (parsed.sleep) {
      const { data: prev } = await supabase
        .from("sleep_logs")
        .select("duration_min, quality")
        .eq("user_id", userId)
        .eq("slept_on", day)
        .maybeSingle();
      const { error } = await supabase.from("sleep_logs").upsert(
        {
          user_id: userId,
          slept_on: day,
          duration_min: parsed.sleep.duration_min,
          quality: parsed.sleep.quality,
          source: "chat",
        },
        { onConflict: "user_id,slept_on" }
      );
      if (error) {
        console.error(`[chat sleep] ${error.message}`);
        failed.push("your sleep");
      } else {
        cards.push({
          key: newKey(cards.length),
          kind: "sleep",
          date: day,
          duration_min: parsed.sleep.duration_min,
          quality: parsed.sleep.quality,
          previous: prev
            ? { duration_min: (prev.duration_min as number | null) ?? null, quality: (prev.quality as number | null) ?? null }
            : null,
          status: "saved",
        });
        justLogged.push(`sleep for ${dayWord(day, win.date)}`);
        lines.push(isToday ? "Sleep saved." : `Sleep saved for ${dayWord(day, win.date)}.`);
      }
    }

    // Workout → session + set_logs (Spec §10 mapping).
    if (parsed.workout) {
      const { data: session, error: wErr } = await supabase
        .from("workout_sessions")
        .insert({
          user_id: userId,
          type: parsed.workout.type,
          performed_at: isToday ? new Date().toISOString() : noonOnLocalDateISO(day, tz),
        })
        .select("id")
        .single();
      if (wErr || !session) {
        if (wErr) console.error(`[chat workout] ${wErr.message}`);
        failed.push("the workout");
      } else {
        const ids = await resolveExerciseIds(
          supabase,
          userId,
          parsed.workout.sets.map((s) => ({ name: s.exercise }))
        );
        const perExercise = new Map<string, number>();
        const setRows = parsed.workout.sets
          .map((s) => {
            const exId = ids.get(s.exercise.toLowerCase());
            if (!exId) return null;
            const idx = (perExercise.get(exId) ?? 0) + 1;
            perExercise.set(exId, idx);
            return {
              user_id: userId,
              session_id: session.id as string,
              exercise_id: exId,
              set_index: idx,
              actual_load_value: s.load_value,
              actual_load_type: s.load_type,
              actual_reps: s.reps,
              actual_rpe: s.rpe,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        let setsOk = setRows.length > 0;
        if (setRows.length) {
          const { error: slErr } = await supabase.from("set_logs").insert(setRows);
          if (slErr) {
            console.error(`[chat set_logs] ${slErr.message}`);
            setsOk = false;
          }
        }
        if (!setsOk) {
          // Never leave an empty session behind or claim it was logged.
          await supabase.from("workout_sessions").delete().eq("id", session.id as string).eq("user_id", userId);
          failed.push("the workout");
        }
        if (setsOk) {
          justLogged.push(`${parsed.workout.type ?? "workout"} for ${dayWord(day, win.date)}`);
          lines.push(isToday ? "Workout logged." : `Workout logged for ${dayWord(day, win.date)}.`);
        }
      }
    }

    // Goal change → proposal only (approve before apply).
    if (parsed.goal_change) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("primary_goal, daily_calorie_target, daily_protein_target, goal_weight_kg")
        .eq("id", userId)
        .single();
      const { data: latest } = await supabase
        .from("weights")
        .select("kg")
        .eq("user_id", userId)
        .order("measured_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      const preview = previewTargets({
        currentGoal: (prof?.primary_goal as string | null) ?? null,
        currentKcal: prof?.daily_calorie_target != null ? Number(prof.daily_calorie_target) : null,
        currentProtein: prof?.daily_protein_target != null ? Number(prof.daily_protein_target) : null,
        newGoal: parsed.goal_change.goal,
        latestWeightKg: latest?.kg != null ? Number(latest.kg) : null,
      });
      const gw = parsed.goal_change.goal_weight_kg;
      const sameGoal = preview.from.goal === preview.to.goal;
      const sameWeight = gw == null || Number(prof?.goal_weight_kg) === gw;
      if (sameGoal && sameWeight) {
        lines.push(`You're already set to ${GOAL_LABEL[preview.to.goal]}.`);
      } else {
        const { data: pc, error } = await supabase
          .from("pending_changes")
          .insert({ user_id: userId, kind: "goal", payload: { ...preview, goal_weight_kg: gw }, source: "chat" })
          .select("id")
          .single();
        if (error || !pc) {
          if (error) console.error(`[chat goal proposal] ${error.message}`);
          failed.push("the goal change");
        } else {
          cards.push({
            key: newKey(cards.length),
            kind: "goal",
            pending_id: pc.id as string,
            preview,
            goal_weight_kg: gw,
            status: "pending",
          });
          justLogged.push(`proposed goal change to ${GOAL_LABEL[preview.to.goal]} (waiting for approval, not applied)`);
          lines.push("Here's what that change looks like. Nothing changes until you approve.");
        }
      }
    }

    // Health note → consent-gated proposal.
    if (parsed.health_update) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("health_data_consent_at")
        .eq("id", userId)
        .single();
      if (!prof?.health_data_consent_at) {
        cards.push({ key: newKey(cards.length), kind: "health_consent" });
        lines.push("I can only keep health notes once you turn on health data sharing in your profile. I didn't save anything.");
      } else {
        const h = parsed.health_update;
        const { data: pc, error } = await supabase
          .from("pending_changes")
          .insert({ user_id: userId, kind: "health", payload: h, source: "chat" })
          .select("id")
          .single();
        if (error || !pc) {
          if (error) console.error(`[chat health proposal] ${error.message}`);
          failed.push("the health note");
        } else {
          cards.push({
            key: newKey(cards.length),
            kind: "health",
            pending_id: pc.id as string,
            condition: h.condition,
            notes: h.notes,
            action: h.action,
            status: "pending",
          });
          justLogged.push(`proposed a health note "${h.condition}" (waiting for approval)`);
          lines.push(
            h.action === "resolve"
              ? `Want me to mark ${h.condition} as resolved in your health notes?`
              : "Want me to keep that in your health notes?"
          );
        }
      }
    }

    const extracted = hasLoggable || !!fixPlan || !!parsed.goal_change || !!parsed.health_update;
    callCoach = parsed.is_question || !extracted;
  }

  // ---- 3. Reply: template when it was just a log, coach when asked. ----
  const totals = await todayTotals(supabase, userId, win);
  if (todayFoodCard) {
    todayFoodCard.kcal_today = totals.kcal;
    todayFoodCard.protein_today = totals.protein;
    lines.unshift(
      loggedFoodsLine(todayFoodCard.meal, todayFoodCard.items.map((f) => f.name), totals.kcal, totals.protein)
    );
  }
  if (fixCard) {
    fixCard.kcal_today = totals.kcal;
    fixCard.protein_today = totals.protein;
    lines.unshift(fixedFoodLine(fixCard.item, totals.kcal, totals.protein));
  }
  if (failed.length) lines.push(`Couldn't save ${failed.join(", ")} — try that part again.`);
  const wroteSomething = cards.length > 0 || justLogged.length > 0;
  let reply = lines.join(" ");

  if (callCoach) {
    const ctx = await buildCoachContext(supabase, userId, win, totals, justLogged);
    const coach = await askCoach(supabase, userId, clean, ctx, deadline);
    if (coach.ok) {
      reply = coach.text;
    } else if (!wroteSomething) {
      // Nothing was written this turn → fail loudly so it's safe to resend.
      return { ok: false, error: coach.error };
    } else {
      reply = `${reply} No reply to your question this time — ${coach.error}`.trim();
    }
  }
  if (!reply) reply = "Got it.";

  const messageId = await persistTurn(supabase, userId, clean, reply, cards);
  return { ok: true, reply, cards, messageId, kcal_today: totals.kcal, protein_today: totals.protein };
}

// ---------- quick-log chip: zero AI ----------

export async function logFromLibrary(libraryId: string, meal: string | null): Promise<ChatResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const userId = user.id;

  const lib = await loadLibrary(supabase, userId);
  const row = lib.find((r) => r.id === libraryId);
  if (!row) return { ok: false, error: "That dish isn't in your library any more." };

  const m = cleanMeal(meal);
  const written = await insertFoods(supabase, userId, [fromLibrary(row)], m, new Date().toISOString());
  if (!written) return { ok: false, error: "Couldn't save that. Try again." };
  await bumpLibrary(supabase, userId, written, lib);

  const tz = await getUserTz(supabase, userId);
  const win = todayWindow(tz);
  const totals = await todayTotals(supabase, userId, win);
  const card: ChatCard = {
    key: newKey(0),
    kind: "food",
    meal: m,
    via: "library",
    items: written,
    kcal_today: totals.kcal,
    protein_today: totals.protein,
    status: "logged",
  };
  const reply = loggedFoodsLine(m, [row.name], totals.kcal, totals.protein);
  const label = `${row.name}${row.serving ? ` ${row.serving}` : ""}`;
  const messageId = await persistTurn(supabase, userId, label, reply, [card]);
  return { ok: true, reply, cards: [card], messageId, kcal_today: totals.kcal, protein_today: totals.protein };
}

// ---------- card actions ----------

// "Add to <day>" on a past-day food card.
export async function addPastFoods(
  items: CardFood[],
  date: string,
  meal: string | null,
  ref?: CardRef | null
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const userId = user.id;

  const tz = await getUserTz(supabase, userId);
  const today = todayWindow(tz).date;
  if (!isDateISO(date) || date > today) return { ok: false, error: "Pick a day that isn't in the future." };
  if (date < addDays(today, -366)) return { ok: false, error: "That's more than a year back." };
  if (!Array.isArray(items) || !items.length || items.length > 20) return { ok: false, error: "Nothing to add." };

  const cleanItems: CardFood[] = [];
  for (const f of items) {
    const name = typeof f?.name === "string" ? f.name.trim().slice(0, 200) : "";
    if (!name) continue;
    cleanItems.push({
      name,
      serving: typeof f.serving === "string" ? f.serving.slice(0, 100) : null,
      kcal: nnum(f.kcal),
      protein_g: nnum(f.protein_g),
      carbs_g: nnum(f.carbs_g),
      fat_g: nnum(f.fat_g),
      is_estimate: f.is_estimate !== false,
      user_stated: f.user_stated === true && f.is_estimate === false,
    });
  }
  if (!cleanItems.length) return { ok: false, error: "Nothing to add." };

  const lib = await loadLibrary(supabase, userId);
  const resolved = resolveWithLibrary(cleanItems, lib);
  const written = await insertFoods(supabase, userId, resolved, cleanMeal(meal), noonOnLocalDateISO(date, tz));
  if (!written) return { ok: false, error: "Couldn't add those. Try again." };
  await bumpLibrary(supabase, userId, written, lib);
  await patchCard(supabase, userId, ref, { status: "added", added_date: date, items: written });
  return { ok: true };
}

export async function undoFoodLogs(ids: string[], ref?: CardRef | null): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x).slice(0, 50);
  if (!clean.length) return { ok: false, error: "Nothing to undo." };
  const { error } = await supabase.from("food_logs").delete().eq("user_id", user.id).in("id", clean);
  if (error) {
    console.error(`[chat undo food] ${error.message}`);
    return { ok: false, error: "Couldn't undo that. Try again." };
  }
  await patchCard(supabase, user.id, ref, { status: "undone" });
  return { ok: true };
}

// Undo a chat correction: put the row back exactly as it was before the fix.
export async function undoFoodFix(
  foodLogId: string,
  previous: FoodSnapshot,
  ref?: CardRef | null
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const name = typeof previous?.name === "string" ? previous.name.trim().slice(0, 200) : "";
  if (typeof foodLogId !== "string" || !foodLogId || !name) return { ok: false, error: "Nothing to undo." };
  const { data, error } = await supabase
    .from("food_logs")
    .update({
      name,
      serving: typeof previous.serving === "string" ? previous.serving.slice(0, 100) : null,
      kcal: nnum(previous.kcal),
      protein_g: nnum(previous.protein_g),
      carbs_g: nnum(previous.carbs_g),
      fat_g: nnum(previous.fat_g),
      is_estimate: previous.is_estimate !== false,
    })
    .eq("id", foodLogId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[chat undo food fix] ${error.message}`);
    return { ok: false, error: error ? "Couldn't undo that. Try again." : "That food is gone." };
  }
  await patchCard(supabase, user.id, ref, { status: "undone" });
  return { ok: true };
}

// Restores the value that was there before the chat save, or removes the row.
export async function undoWeight(
  date: string,
  previousKg: number | null,
  ref?: CardRef | null
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  if (!isDateISO(date)) return { ok: false, error: "That day doesn't look right." };

  const prev = typeof previousKg === "number" && previousKg >= 20 && previousKg <= 400 ? previousKg : null;
  const { error } =
    prev != null
      ? await supabase
          .from("weights")
          .update({ kg: prev })
          .eq("user_id", user.id)
          .eq("measured_on", date)
      : await supabase.from("weights").delete().eq("user_id", user.id).eq("measured_on", date);
  if (error) {
    console.error(`[chat undo weight] ${error.message}`);
    return { ok: false, error: "Couldn't undo that. Try again." };
  }
  await patchCard(supabase, user.id, ref, { status: "undone" });
  return { ok: true };
}

export async function undoSleep(
  date: string,
  previous: { duration_min: number | null; quality: number | null } | null,
  ref?: CardRef | null
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  if (!isDateISO(date)) return { ok: false, error: "That day doesn't look right." };

  const { error } = previous
    ? await supabase
        .from("sleep_logs")
        .update({
          duration_min: nnum(previous.duration_min),
          quality: nnum(previous.quality),
        })
        .eq("user_id", user.id)
        .eq("slept_on", date)
    : await supabase.from("sleep_logs").delete().eq("user_id", user.id).eq("slept_on", date);
  if (error) {
    console.error(`[chat undo sleep] ${error.message}`);
    return { ok: false, error: "Couldn't undo that. Try again." };
  }
  await patchCard(supabase, user.id, ref, { status: "undone" });
  return { ok: true };
}

// "Save to library" on an estimated food: the user confirms these numbers, so
// the next log of this dish uses them with no AI.
export async function saveFoodToLibrary(foodLogId: string): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const { data: row } = await supabase
    .from("food_logs")
    .select("name, serving, kcal, protein_g, carbs_g, fat_g")
    .eq("id", foodLogId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That food is gone." };
  await upsertFoodLibrary(supabase, user.id, {
    name: row.name as string,
    serving: (row.serving as string | null) ?? null,
    kcal: row.kcal != null ? Number(row.kcal) : null,
    protein_g: row.protein_g != null ? Number(row.protein_g) : null,
    carbs_g: row.carbs_g != null ? Number(row.carbs_g) : null,
    fat_g: row.fat_g != null ? Number(row.fat_g) : null,
  });
  // upsertFoodLibrary doesn't report errors, so check before claiming it saved.
  const { data: saved } = await supabase
    .from("food_library")
    .select("id")
    .eq("user_id", user.id)
    .ilike("name", (row.name as string).trim())
    .maybeSingle();
  if (!saved) return { ok: false, error: "Couldn't save that to your library. Try again." };
  return { ok: true };
}
