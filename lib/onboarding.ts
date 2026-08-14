// Shared onboarding types + helpers used by both the server (page guard, action)
// and the client wizard.

// The onboarding-complete signal. We intentionally do NOT add an `onboarded_at`
// column — that would be schema drift beyond Master Spec §7. Onboarding writes
// the whole profile atomically at the end, and `height_cm` is required with no
// default, so a non-null height cleanly means "onboarding finished."
export function isOnboarded(
  profile: { height_cm?: number | null } | null | undefined
): boolean {
  return profile?.height_cm != null;
}

// Default coach persona seeded on completion — verbatim shape from Doc 02 §2a.
// Stored in profiles.coach_persona (jsonb); the prompt (Session D) reads it.
export const DEFAULT_COACH_PERSONA = {
  coach_name: "Xclr",
  tone: "motivational",
  sass_level: 2,
  emoji: true,
  language_notes: "English with Filipino food fluency",
  focus: ["protein", "consistency", "don't chase the scale"],
};

// Payload sent from the client wizard to the submitOnboarding server action.
// Weights are in the user's chosen unit; the action converts to kg before write.
export type OnboardingPayload = {
  display_name: string;
  sex: string | null;
  birthdate: string | null; // "yyyy-mm-dd" or null
  height_cm: number;
  weight_unit: "kg" | "lbs";
  current_weight: number;
  goal_weight: number;
  primary_goal: string;
  sports: string[];
  training_days_per_week: number;
  session_minutes: number;
  preferred_days: string[];
  preferred_time: string | null;
  training_experience: string;
  equipment_access: string;
  health_consent: boolean;
  medical_conditions: { condition: string; notes: string }[];
};

export type OnboardingResult = { ok: true } | { ok: false; error: string };
