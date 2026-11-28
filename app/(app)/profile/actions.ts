"use server";

import { createClient } from "@/lib/supabase/server";
import { deletePhotoNow } from "@/lib/photos";
import { deleteSelf } from "@/lib/delete-user";
import {
  SEX_VALUES,
  SPORT_VALUES,
  WEEKDAY_VALUES,
  PREFERRED_TIME_VALUES,
  TRAINING_EXPERIENCE_VALUES,
  EQUIPMENT_ACCESS_VALUES,
} from "@/lib/onboarding-options";

export type ProfileResult = { ok: true } | { ok: false; error: string };

type Supa = ReturnType<typeof createClient>;

async function signedIn(): Promise<{ supabase: Supa; userId: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

const SIGNED_OUT: ProfileResult = { ok: false, error: "You're signed out — please sign in again." };

function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---- Body ----
export async function saveBody(input: {
  display_name: string;
  height_cm: number;
  sex: string | null;
  birthdate: string | null;
}): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;

  const name = String(input?.display_name ?? "").trim();
  if (!name) return { ok: false, error: "Please add your name." };
  if (name.length > 60) return { ok: false, error: "That name is a bit long." };

  const height = Number(input?.height_cm);
  if (!Number.isFinite(height) || height < 80 || height > 260)
    return { ok: false, error: "Enter a height between 80 and 260 cm." };

  const sex = input?.sex && SEX_VALUES.includes(input.sex) ? input.sex : null;

  let birthdate: string | null = null;
  if (input?.birthdate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthdate))
      return { ok: false, error: "Birthdate should be a full date." };
    const d = new Date(`${input.birthdate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getTime() > Date.now())
      return { ok: false, error: "That birthdate looks off." };
    birthdate = input.birthdate;
  }

  const { error } = await s.supabase
    .from("profiles")
    .update({
      display_name: name,
      height_cm: Math.round(height * 10) / 10,
      sex,
      birthdate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

// ---- Training ----
export async function saveTraining(input: {
  training_days_per_week: number;
  session_minutes: number;
  preferred_days: string[];
  preferred_time: string | null;
  sports: string[];
  training_experience: string;
  equipment_access: string;
  training_notes: string;
}): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;

  const days = Math.round(Number(input?.training_days_per_week));
  if (!Number.isFinite(days) || days < 1 || days > 7)
    return { ok: false, error: "Training days must be between 1 and 7." };
  const minutes = Math.round(Number(input?.session_minutes));
  if (!Number.isFinite(minutes) || minutes < 10 || minutes > 240)
    return { ok: false, error: "Session length should be 10–240 minutes." };

  const preferredDays = Array.isArray(input?.preferred_days)
    ? Array.from(new Set(input.preferred_days.filter((d) => WEEKDAY_VALUES.includes(d))))
    : [];
  const preferredTime =
    input?.preferred_time && PREFERRED_TIME_VALUES.includes(input.preferred_time)
      ? input.preferred_time
      : null;
  const sports = Array.isArray(input?.sports)
    ? Array.from(new Set(input.sports.filter((v) => SPORT_VALUES.includes(v))))
    : [];

  if (!TRAINING_EXPERIENCE_VALUES.includes(input?.training_experience))
    return { ok: false, error: "Pick your experience level." };
  if (!EQUIPMENT_ACCESS_VALUES.includes(input?.equipment_access))
    return { ok: false, error: "Pick your equipment access." };

  const notes = String(input?.training_notes ?? "").trim();
  if (notes.length > 1000) return { ok: false, error: "Keep training notes under 1,000 characters." };

  const { error } = await s.supabase
    .from("profiles")
    .update({
      training_days_per_week: days,
      session_minutes: minutes,
      preferred_days: preferredDays,
      preferred_time: preferredTime,
      sports,
      training_experience: input.training_experience,
      equipment_access: input.equipment_access,
      training_notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

// ---- Settings ----
export async function saveSettings(input: {
  weight_unit: string;
  timezone: string;
}): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  if (input?.weight_unit !== "kg" && input?.weight_unit !== "lbs")
    return { ok: false, error: "Pick kg or lbs." };
  if (!validTz(input?.timezone)) return { ok: false, error: "Pick a timezone from the list." };

  const { error } = await s.supabase
    .from("profiles")
    .update({
      weight_unit: input.weight_unit,
      timezone: input.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

// ---- Health (consent-gated) ----
async function hasConsent(s: { supabase: Supa; userId: string }): Promise<boolean> {
  const { data } = await s.supabase
    .from("profiles")
    .select("health_data_consent_at")
    .eq("id", s.userId)
    .maybeSingle();
  return data?.health_data_consent_at != null;
}

const NO_CONSENT: ProfileResult = { ok: false, error: "Turn on health notes first." };

export async function turnHealthOn(): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  const now = new Date().toISOString();
  const { error } = await s.supabase
    .from("profiles")
    .update({ health_data_consent_at: now, updated_at: now })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't turn health notes on. Try again." };
  return { ok: true };
}

// Turning consent off always clears the timestamp (so nothing is used or sent
// to the AI). The user chooses whether saved notes are deleted too.
export async function turnHealthOff(deleteNotes: boolean): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  const now = new Date().toISOString();
  const { error } = await s.supabase
    .from("profiles")
    .update({ health_data_consent_at: null, updated_at: now })
    .eq("id", s.userId);
  if (error) return { ok: false, error: "Couldn't turn health notes off. Try again." };
  // Health info waiting elsewhere is cleared either way: health proposals
  // (any status) are dropped, health photos are deleted now (file + read),
  // and health cards in chat history lose their details.
  const failMsg = "Health notes are off, but clearing some health data failed. Try again.";
  const { error: pcErr } = await s.supabase
    .from("pending_changes")
    .delete()
    .eq("user_id", s.userId)
    .eq("kind", "health");
  if (pcErr) return { ok: false, error: failMsg };
  const { data: healthPhotos, error: hpErr } = await s.supabase
    .from("photo_reads")
    .select("id")
    .eq("user_id", s.userId)
    .eq("kind", "health")
    .is("deleted_at", null);
  if (hpErr) return { ok: false, error: failMsg };
  for (const ph of healthPhotos ?? []) {
    const gone = await deletePhotoNow(s.supabase, s.userId, ph.id as string);
    if (!gone) return { ok: false, error: failMsg };
  }
  const { error: hrErr } = await s.supabase
    .from("photo_reads")
    .update({ result: null })
    .eq("user_id", s.userId)
    .eq("kind", "health");
  if (hrErr) return { ok: false, error: failMsg };
  const { data: msgs, error: mErr } = await s.supabase
    .from("messages")
    .select("id, meta")
    .eq("user_id", s.userId)
    .not("meta", "is", null);
  if (mErr) return { ok: false, error: failMsg };
  for (const m of msgs ?? []) {
    const meta = m.meta as { cards?: Array<Record<string, unknown>> } | null;
    if (!meta || !Array.isArray(meta.cards)) continue;
    if (!meta.cards.some((c) => c?.kind === "health")) continue;
    const cards = meta.cards.map((c) =>
      c?.kind === "health" ? { ...c, condition: "Health note (removed)", notes: null } : c
    );
    const { error: upErr } = await s.supabase
      .from("messages")
      .update({ meta: { ...meta, cards } })
      .eq("id", m.id as string)
      .eq("user_id", s.userId);
    if (upErr) return { ok: false, error: failMsg };
  }
  if (deleteNotes === true) {
    const { error: delErr } = await s.supabase
      .from("medical_conditions")
      .delete()
      .eq("user_id", s.userId);
    if (delErr)
      return { ok: false, error: "Health notes are off, but deleting them failed. Try again." };
  }
  return { ok: true };
}

function cleanCondition(input: { condition: string; notes: string }):
  | { ok: true; condition: string; notes: string | null }
  | { ok: false; error: string } {
  const condition = String(input?.condition ?? "").trim();
  const notes = String(input?.notes ?? "").trim();
  if (!condition) return { ok: false, error: "Name the condition, injury or medication." };
  if (condition.length > 120) return { ok: false, error: "Keep the name under 120 characters." };
  if (notes.length > 1000) return { ok: false, error: "Keep notes under 1,000 characters." };
  return { ok: true, condition, notes: notes || null };
}

export async function addCondition(input: { condition: string; notes: string }): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  if (!(await hasConsent(s))) return NO_CONSENT;
  const c = cleanCondition(input);
  if (!c.ok) return c;
  const { error } = await s.supabase.from("medical_conditions").insert({
    user_id: s.userId,
    condition: c.condition,
    notes: c.notes,
    active: true,
    source: "manual",
  });
  if (error) return { ok: false, error: "Couldn't add that. Try again." };
  return { ok: true };
}

export async function updateCondition(
  id: string,
  input: { condition: string; notes: string }
): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  if (typeof id !== "string" || !id) return { ok: false, error: "Unknown note." };
  if (!(await hasConsent(s))) return NO_CONSENT;
  const c = cleanCondition(input);
  if (!c.ok) return c;
  const { error } = await s.supabase
    .from("medical_conditions")
    .update({ condition: c.condition, notes: c.notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", s.userId);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  return { ok: true };
}

export async function resolveCondition(id: string): Promise<ProfileResult> {
  const s = await signedIn();
  if (!s) return SIGNED_OUT;
  if (typeof id !== "string" || !id) return { ok: false, error: "Unknown note." };
  if (!(await hasConsent(s))) return NO_CONSENT;
  const { error } = await s.supabase
    .from("medical_conditions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", s.userId);
  if (error) return { ok: false, error: "Couldn't update that. Try again." };
  return { ok: true };
}

// ---- Delete my data and leave Xclr ----
// Typed confirm ("DELETE"). Removes the storage folder, the auth user (every
// table cascades from auth.users) and the invite row, then signs out.
// The owner can't do this (OWNER_USER_ID or an owner row), and a failed access
// lookup refuses too — see deleteSelf in lib/delete-user.ts.
export async function deleteMyData(confirm: string): Promise<ProfileResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SIGNED_OUT;
  const r = await deleteSelf(user, confirm);
  if (!r.ok) return r;
  await supabase.auth.signOut().catch(() => undefined);
  return { ok: true };
}
