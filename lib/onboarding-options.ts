// Single source of truth for every onboarding option set. Imported by both the
// wizard (to render) and the server action (to validate) so the allowed values
// can never drift apart. Values mirror the enums documented in Master Spec §7
// and Doc 02 §1.

export const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
] as const;

export const PRIMARY_GOALS = [
  { value: "build_muscle", label: "Build muscle", hint: "Progressive overload, protein-forward" },
  { value: "lose_fat", label: "Lose fat", hint: "Gentle deficit, keep the muscle" },
  { value: "maintain", label: "Maintain", hint: "Hold steady, stay consistent" },
  { value: "endurance", label: "Endurance", hint: "Pace, distance, engine" },
  { value: "general_health", label: "General health", hint: "Feel good, move often" },
] as const;

export const SPORTS = [
  { value: "lifting", label: "Lifting" },
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "swimming", label: "Swimming" },
  { value: "basketball", label: "Basketball" },
  { value: "volleyball", label: "Volleyball" },
  { value: "badminton", label: "Badminton" },
  { value: "boxing_muay_thai", label: "Boxing / Muay Thai" },
  { value: "football", label: "Football" },
  { value: "tennis", label: "Tennis" },
  { value: "golf", label: "Golf" },
  { value: "hiking", label: "Hiking" },
  { value: "yoga", label: "Yoga" },
  { value: "dance_zumba", label: "Dance / Zumba" },
  { value: "martial_arts", label: "Martial Arts" },
] as const;

export const SESSION_MINUTE_OPTIONS = [30, 45, 60, 75, 90] as const;

export const WEEKDAYS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const;

export const PREFERRED_TIMES = [
  { value: "morning", label: "Morning" },
  { value: "lunch", label: "Lunch" },
  { value: "evening", label: "Evening" },
  { value: "flexible", label: "Flexible" },
] as const;

export const TRAINING_EXPERIENCE = [
  { value: "beginner", label: "Beginner", hint: "New-ish to structured training" },
  { value: "intermediate", label: "Intermediate", hint: "Comfortable with the basics" },
  { value: "advanced", label: "Advanced", hint: "Years under the bar" },
] as const;

export const EQUIPMENT_ACCESS = [
  { value: "commercial_gym", label: "Commercial gym", hint: "Full machines + free weights" },
  { value: "home_basic", label: "Home (basic)", hint: "Dumbbells, bands, the essentials" },
  { value: "bodyweight_only", label: "Bodyweight only", hint: "No equipment" },
] as const;

// Value-only arrays for server-side validation (membership checks).
export const SEX_VALUES: readonly string[] = SEX_OPTIONS.map((o) => o.value);
export const PRIMARY_GOAL_VALUES: readonly string[] = PRIMARY_GOALS.map((o) => o.value);
export const SPORT_VALUES: readonly string[] = SPORTS.map((o) => o.value);
export const WEEKDAY_VALUES: readonly string[] = WEEKDAYS.map((o) => o.value);
export const PREFERRED_TIME_VALUES: readonly string[] = PREFERRED_TIMES.map((o) => o.value);
export const TRAINING_EXPERIENCE_VALUES: readonly string[] = TRAINING_EXPERIENCE.map((o) => o.value);
export const EQUIPMENT_ACCESS_VALUES: readonly string[] = EQUIPMENT_ACCESS.map((o) => o.value);
