"use server";

import { kgToLbs } from "@/lib/units";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { generateJson } from "@/lib/ai-json";
import { deadlineAfter } from "@/lib/ai-call";
import { AI_BUDGET_SECONDS } from "@/lib/anthropic";
import { upsertFoodLibrary } from "@/lib/food";
import { DEFAULT_TZ, todayLocal } from "@/lib/time";
import {
  PHOTO_BUCKET,
  deleteExpiredPhotosFor,
  deletePhotoNow as deletePhotoRow,
  expiryLabel,
  removeUpload,
} from "@/lib/photos";
import {
  PHOTO_SCHEMA,
  PHOTO_SYSTEM,
  PHOTO_TOOL,
  cleanFood,
  cleanNum,
  cleanReading,
  cleanStr,
  isMeal,
  isPhotoKind,
  normalizePhotoRead,
  type HealthReading,
  type PhotoFood,
  type PhotoKind,
  type PhotoRead,
} from "@/lib/photo-schema";

export type PhotoView = {
  id: string;
  kind: PhotoKind;
  read: PhotoRead;
  expiresLabel: string;
};

export type ReadPhotoResult =
  | { ok: true; photo: PhotoView }
  | { ok: false; error: string; clarification?: boolean; consentNeeded?: boolean };

export type SimpleResult = { ok: true; message?: string } | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024;

type Supa = ReturnType<typeof createClient>;

async function getProfile(supabase: Supa, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("timezone, health_data_consent_at, weight_unit")
    .eq("id", userId)
    .maybeSingle();
  return {
    tz: (data?.timezone as string | null) ?? DEFAULT_TZ,
    lbs: data?.weight_unit === "lbs",
    consent: Boolean(data?.health_data_consent_at),
  };
}

function localTimeLabel(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toUTCString();
  }
}

// Read one uploaded photo. The browser has already resized it (≤1280px JPEG,
// EXIF stripped) and uploaded it to xclr-photos/<user_id>/<uuid>.jpg.
export async function readPhoto(storagePath: string, kind: string): Promise<ReadPhotoResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  if (
    typeof storagePath !== "string" ||
    !new RegExp(`^${user.id}/[0-9a-f-]{36}\\.jpg$`).test(storagePath)
  ) {
    return { ok: false, error: "That upload doesn't look right. Try again." };
  }
  if (!isPhotoKind(kind)) {
    await removeUpload(supabase, storagePath);
    return { ok: false, error: "Pick Food, Health paper, or Scale or watch first." };
  }

  // Layer (a): clear anything of this user's that's past 48 h.
  await deleteExpiredPhotosFor(supabase, user.id);

  const { tz, consent } = await getProfile(supabase, user.id);
  if (kind === "health" && !consent) {
    await removeUpload(supabase, storagePath);
    return {
      ok: false,
      consentNeeded: true,
      error: "Health paper photos need health consent turned on first. You can turn it on in your profile.",
    };
  }

  const { data: row, error: insErr } = await supabase
    .from("photo_reads")
    .insert({ user_id: user.id, kind, storage_path: storagePath })
    .select("id, expires_at")
    .single();
  if (insErr || !row) {
    console.error(`[photo:read] insert failed: ${insErr?.message ?? "no row"}`);
    await removeUpload(supabase, storagePath);
    return { ok: false, error: "Couldn't save the photo. Try again." };
  }
  const photoId = row.id as string;

  // From here on, any failure deletes the photo right away — nothing is kept
  // that we didn't read.
  const fail = async (error: string, clarification = false): Promise<ReadPhotoResult> => {
    await deletePhotoRow(supabase, user.id, photoId);
    return { ok: false, error, clarification };
  };

  const { data: blob, error: dlErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .download(storagePath);
  if (dlErr || !blob) {
    console.error(`[photo:read] download failed: ${dlErr?.message ?? "no data"}`);
    return fail("Couldn't open the uploaded photo. Try again.");
  }
  if (blob.size > MAX_BYTES) return fail("That photo is too large. Try again.");
  // Never log these bytes.
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

  let context = `Local time now: ${localTimeLabel(tz)}.`;
  if (kind === "food") {
    const { data: lib } = await supabase
      .from("food_library")
      .select("name, serving, kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", user.id)
      .order("times_logged", { ascending: false })
      .limit(30);
    if (lib?.length) {
      context +=
        "\nMy food library (my own confirmed numbers):\n" +
        lib
          .map(
            (l) =>
              `- ${l.name}${l.serving ? ` (${l.serving})` : ""}: ${l.kcal ?? "?"} kcal, P${l.protein_g ?? "?"} C${l.carbs_g ?? "?"} F${l.fat_g ?? "?"}`
          )
          .join("\n");
    }
  }
  const ask: Record<PhotoKind, string> = {
    food: "Read this food photo.",
    scale: "Read the numbers on this scale or watch screen.",
    health: "Transcribe the values on this health paper. Values only, no interpretation.",
  };

  const user_content: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
    { type: "text", text: `${ask[kind]}\n${context}` },
  ];

  const ai = await generateJson({
    job: "vision",
    system: PHOTO_SYSTEM[kind],
    user: user_content,
    schema: PHOTO_SCHEMA[kind],
    toolName: PHOTO_TOOL[kind],
    maxTokens: 2000,
    deadline: deadlineAfter(AI_BUDGET_SECONDS.chat),
    track: { supabase, userId: user.id },
  });
  if (!ai.ok) return fail(ai.error);

  const norm = normalizePhotoRead(kind, ai.data);
  if (!norm.ok) return fail(`${norm.clarification} Nothing was saved, and the photo was deleted.`, true);

  const { error: upErr } = await supabase
    .from("photo_reads")
    .update({ result: norm.read })
    .eq("id", photoId)
    .eq("user_id", user.id);
  if (upErr) console.error(`[photo:read] save result failed: ${upErr.message}`);

  return {
    ok: true,
    photo: {
      id: photoId,
      kind,
      read: norm.read,
      expiresLabel: expiryLabel(row.expires_at as string, tz),
    },
  };
}

// Load a live (not deleted, not expired) photo row of the right kind.
async function loadPhoto(supabase: Supa, userId: string, photoId: string, kind: PhotoKind) {
  if (typeof photoId !== "string" || !/^[0-9a-f-]{36}$/.test(photoId)) return null;
  const { data } = await supabase
    .from("photo_reads")
    .select("id, kind, result")
    .eq("user_id", userId)
    .eq("id", photoId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data || data.kind !== kind || !data.result) return null;
  return data as { id: string; kind: string; result: PhotoRead & { logged_at?: string } };
}

async function markLogged(supabase: Supa, userId: string, photoId: string, result: object) {
  await supabase
    .from("photo_reads")
    .update({ result: { ...result, logged_at: new Date().toISOString() } })
    .eq("id", photoId)
    .eq("user_id", userId);
}

const sameNum = (a: number | null, b: number | null) => (a ?? null) === (b ?? null);

// Food → food_logs. Rows the user changed are no longer estimates and go into
// the personal library; untouched rows stay estimates. "Edited" is decided
// here against the stored read, not trusted from the browser.
export async function logPhotoFood(
  photoId: string,
  items: PhotoFood[],
  meal: string
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const photo = await loadPhoto(supabase, user.id, photoId, "food");
  if (!photo || photo.result.kind !== "food")
    return { ok: false, error: "That photo has already been deleted. Take it again to log it." };
  if (photo.result.logged_at) return { ok: false, error: "You've already logged this photo." };

  const clean = (Array.isArray(items) ? items : [])
    .map(cleanFood)
    .filter((f): f is PhotoFood => f !== null)
    .slice(0, 12);
  if (!clean.length) return { ok: false, error: "There's nothing to log." };

  const original = photo.result.foods;
  const now = new Date().toISOString();
  const rows = clean.map((f) => {
    const o = original.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
    const edited =
      !o ||
      (f.serving ?? null) !== (o.serving ?? null) ||
      !sameNum(f.kcal, o.kcal) ||
      !sameNum(f.protein_g, o.protein_g) ||
      !sameNum(f.carbs_g, o.carbs_g) ||
      !sameNum(f.fat_g, o.fat_g);
    return { f, edited };
  });

  const { error } = await supabase.from("food_logs").insert(
    rows.map(({ f, edited }) => ({
      user_id: user.id,
      logged_at: now,
      meal: isMeal(meal) ? meal : null,
      name: f.name,
      serving: f.serving,
      kcal: f.kcal,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
      source: "photo",
      is_estimate: !edited,
    }))
  );
  if (error) {
    console.error(`[photo:log-food] ${error.message}`);
    return { ok: false, error: "Couldn't log that. Try again." };
  }
  for (const { f, edited } of rows) if (edited) await upsertFoodLibrary(supabase, user.id, f);

  await markLogged(supabase, user.id, photoId, photo.result);
  const kcal = clean.reduce((s, f) => s + (f.kcal ?? 0), 0);
  return { ok: true, message: `Logged ${clean.length} item${clean.length === 1 ? "" : "s"}, about ${Math.round(kcal)} kcal.` };
}

// Scale/watch → today's weight (metric). Other numbers are shown but not saved
// (there's no column for them yet).
export async function logPhotoWeight(photoId: string, weightKg: number): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const photo = await loadPhoto(supabase, user.id, photoId, "scale");
  if (!photo) return { ok: false, error: "That photo has already been deleted. Take it again to log it." };

  const { tz, lbs } = await getProfile(supabase, user.id);
  const kg = cleanNum(weightKg, 20, 400, 2);
  if (kg == null)
    return { ok: false, error: lbs ? "Enter a weight between 45 and 880 lbs." : "Enter a weight between 20 and 400 kg." };

  const { error } = await supabase
    .from("weights")
    .upsert(
      { user_id: user.id, measured_on: todayLocal(tz), kg },
      { onConflict: "user_id,measured_on" }
    );
  if (error) {
    console.error(`[photo:log-weight] ${error.message}`);
    return { ok: false, error: "Couldn't save your weight. Try again." };
  }
  await markLogged(supabase, user.id, photoId, photo.result);
  const shown = lbs ? `${kgToLbs(kg).toFixed(2)} lbs` : `${kg.toFixed(2)} kg`;
  return { ok: true, message: `Saved ${shown} for today.` };
}

// Health paper → one health note. The tap is the approval; consent re-checked.
export async function savePhotoHealthNote(
  photoId: string,
  readings: HealthReading[],
  title: string
): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const { consent, tz } = await getProfile(supabase, user.id);
  if (!consent)
    return { ok: false, error: "Health notes need health consent turned on in your profile." };

  const photo = await loadPhoto(supabase, user.id, photoId, "health");
  if (!photo || photo.result.kind !== "health")
    return { ok: false, error: "That photo has already been deleted. Take it again to save it." };
  if (photo.result.logged_at) return { ok: false, error: "You've already saved this one." };

  const clean = (Array.isArray(readings) ? readings : [])
    .map(cleanReading)
    .filter((r): r is HealthReading => r !== null)
    .slice(0, 40);
  if (!clean.length) return { ok: false, error: "There's nothing to save." };

  const condition = cleanStr(title, 80) ?? photo.result.document_type;
  const notes = clean
    .map(
      (r) =>
        `${r.name}: ${r.value}${r.unit ? ` ${r.unit}` : ""}${r.reference_range ? ` (ref ${r.reference_range})` : ""}`
    )
    .join("\n");

  const { error } = await supabase.from("medical_conditions").insert({
    user_id: user.id,
    condition,
    notes: `From a photo, ${todayLocal(tz)}:\n${notes}`,
    source: "photo",
  });
  if (error) {
    console.error(`[photo:health-note] ${error.message}`);
    return { ok: false, error: "Couldn't save the health note. Try again." };
  }
  await markLogged(supabase, user.id, photoId, photo.result);
  return { ok: true, message: "Saved to your health notes." };
}

// Layer (b): "Delete now".
export async function deletePhoto(photoId: string): Promise<SimpleResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (typeof photoId !== "string" || !/^[0-9a-f-]{36}$/.test(photoId))
    return { ok: false, error: "Couldn't find that photo." };
  const ok = await deletePhotoRow(supabase, user.id, photoId);
  return ok ? { ok: true, message: "Photo deleted." } : { ok: false, error: "Couldn't delete it. Try again." };
}
