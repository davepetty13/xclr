"use server";

import { createClient } from "@/lib/supabase/server";
import { lbsToKg } from "@/lib/units";
import {
  DEFAULT_COACH_PERSONA,
  type OnboardingPayload,
  type OnboardingResult,
} from "@/lib/onboarding";
import {
  SEX_VALUES,
  PRIMARY_GOAL_VALUES,
  SPORT_VALUES,
  WEEKDAY_VALUES,
  PREFERRED_TIME_VALUES,
  TRAINING_EXPERIENCE_VALUES,
  EQUIPMENT_ACCESS_VALUES,
} from "@/lib/onboarding-options";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Persists the onboarding profile. Identity is derived server-side from the
// session (never the payload). All writes go through the RLS-scoped anon client,
// so a user can only ever write their own rows (Master Spec §5).
export async function submitOnboarding(
  payload: OnboardingPayload
): Promise<OnboardingResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — please sign in again." };

  // ---- server-side validation (never trust the client) ----
  const name = (payload.display_name ?? "").trim();
  if (!name) return { ok: false, error: "Please tell me your name." };

  const height = Number(payload.height_cm);
  if (!Number.isFinite(height) || height < 80 || height > 260)
    return { ok: false, error: "Enter a height between 80 and 260 cm." };

  const unit: "kg" | "lbs" = payload.weight_unit === "lbs" ? "lbs" : "kg";
  const rawCurrent = Number(payload.current_weight);
  const rawGoal = Number(payload.goal_weight);
  if (!Number.isFinite(rawCurrent) || rawCurrent <= 0)
    return { ok: false, error: "Enter your current weight." };
  if (!Number.isFinite(rawGoal) || rawGoal <= 0)
    return { ok: false, error: "Enter your goal weight." };

  // Store metric only (Spec §6).
  const currentKg = unit === "lbs" ? lbsToKg(rawCurrent) : rawCurrent;
  const goalKg = unit === "lbs" ? lbsToKg(rawGoal) : rawGoal;
  if (currentKg < 25 || currentKg > 400 || goalKg < 25 || goalKg > 400)
    return { ok: false, error: "That weight looks off — please check it." };

  if (!PRIMARY_GOAL_VALUES.includes(payload.primary_goal))
    return { ok: false, error: "Pick a primary goal." };

  const sports = (payload.sports ?? []).filter((s) => SPORT_VALUES.includes(s));

  const days = Math.round(Number(payload.training_days_per_week));
  if (!Number.isFinite(days) || days < 1 || days > 7)
    return { ok: false, error: "Training days must be between 1 and 7." };
  const minutes = Math.round(Number(payload.session_minutes));
  if (!Number.isFinite(minutes) || minutes < 10 || minutes > 240)
    return { ok: false, error: "Session length looks off." };

  const preferredDays = (payload.preferred_days ?? []).filter((d) =>
    WEEKDAY_VALUES.includes(d)
  );
  const preferredTime =
    payload.preferred_time && PREFERRED_TIME_VALUES.includes(payload.preferred_time)
      ? payload.preferred_time
      : null;

  if (!TRAINING_EXPERIENCE_VALUES.includes(payload.training_experience))
    return { ok: false, error: "Pick your experience level." };
  if (!EQUIPMENT_ACCESS_VALUES.includes(payload.equipment_access))
    return { ok: false, error: "Pick your equipment access." };

  const sex = payload.sex && SEX_VALUES.includes(payload.sex) ? payload.sex : null;
  const birthdate =
    payload.birthdate && /^\d{4}-\d{2}-\d{2}$/.test(payload.birthdate)
      ? payload.birthdate
      : null;

  const consent = payload.health_consent === true;
  const nowISO = new Date().toISOString();

  // ---- writes ----
  // Upsert (not update) so onboarding still completes even if the first-login
  // seed row is somehow missing — otherwise a 0-row update would return no error
  // and silently loop the user back through onboarding. `id` is the auth user id,
  // so RLS (id = auth.uid()) still scopes this to the caller's own row.
  const { error: profileErr } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: name,
      sex,
      birthdate,
      height_cm: height,
      weight_unit: unit,
      goal_weight_kg: goalKg,
      primary_goal: payload.primary_goal,
      sports,
      training_days_per_week: days,
      session_minutes: minutes,
      preferred_days: preferredDays,
      preferred_time: preferredTime,
      training_experience: payload.training_experience,
      equipment_access: payload.equipment_access,
      coach_persona: DEFAULT_COACH_PERSONA,
      // Consent timestamp is set ONLY when the user opted in (Spec §11).
      health_data_consent_at: consent ? nowISO : null,
      updated_at: nowISO,
    },
    { onConflict: "id" }
  );
  if (profileErr) return { ok: false, error: "Couldn't save your profile. Try again." };

  // Current weight → today's row (unique per user+date, so upsert).
  const { error: weightErr } = await supabase
    .from("weights")
    .upsert(
      { user_id: user.id, measured_on: todayISO(), kg: currentKg },
      { onConflict: "user_id,measured_on" }
    );
  if (weightErr) return { ok: false, error: "Couldn't save your weight. Try again." };

  // Medical conditions are written ONLY with consent (hard rule, Spec §11).
  if (consent) {
    const rows = (payload.medical_conditions ?? [])
      .map((c) => ({
        condition: (c.condition ?? "").trim(),
        notes: (c.notes ?? "").trim(),
      }))
      .filter((c) => c.condition.length > 0)
      .map((c) => ({
        user_id: user.id,
        condition: c.condition,
        notes: c.notes || null,
      }));
    if (rows.length > 0) {
      const { error: medErr } = await supabase
        .from("medical_conditions")
        .insert(rows);
      if (medErr) return { ok: false, error: "Couldn't save your medical info. Try again." };
    }
  }

  return { ok: true };
}
