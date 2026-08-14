"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "./wizard-shell";
import {
  AutoGrowTextarea,
  Chip,
  FieldLabel,
  OptionCard,
  Segmented,
  Stepper,
  TextField,
} from "./controls";
import { computeBmi, bmiBand, BMI_BAND_LABEL } from "@/lib/bmi";
import { cmToFtIn, ftInToCm, lbsToKg } from "@/lib/units";
import type { OnboardingPayload } from "@/lib/onboarding";
import { submitOnboarding } from "@/app/onboarding/actions";
import {
  EQUIPMENT_ACCESS,
  PREFERRED_TIMES,
  PRIMARY_GOALS,
  SEX_OPTIONS,
  SESSION_MINUTE_OPTIONS,
  SPORTS,
  TRAINING_EXPERIENCE,
  WEEKDAYS,
} from "@/lib/onboarding-options";

const TOTAL = 9;

type Draft = {
  display_name: string;
  sex: string | null;
  birthdate: string;
  height_cm: string; // canonical value, always cm
  height_unit: "cm" | "ftin"; // input mode only — not stored
  height_ft: string;
  height_in: string;
  weight_unit: "kg" | "lbs";
  current_weight: string;
  goal_weight: string;
  primary_goal: string | null;
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

export function OnboardingWizard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Draft>({
    display_name: initialName ?? "",
    sex: null,
    birthdate: "",
    height_cm: "",
    height_unit: "cm",
    height_ft: "",
    height_in: "",
    weight_unit: "kg",
    current_weight: "",
    goal_weight: "",
    primary_goal: null,
    sports: [],
    training_days_per_week: 4,
    session_minutes: 60,
    preferred_days: [],
    preferred_time: null,
    training_experience: "intermediate",
    equipment_access: "commercial_gym",
    health_consent: false,
    medical_conditions: [],
  });

  const update = (patch: Partial<Draft>) => {
    setError(null);
    setData((d) => ({ ...d, ...patch }));
  };

  const back = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };
  const next = () => {
    setError(null);
    setStep((s) => Math.min(TOTAL - 1, s + 1));
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const heightNum = Number(data.height_cm);
  const currentNum = Number(data.current_weight);
  const unitSuffix = data.weight_unit;

  async function finish() {
    setBusy(true);
    setError(null);
    const payload: OnboardingPayload = {
      display_name: data.display_name.trim(),
      sex: data.sex,
      birthdate: data.birthdate || null,
      height_cm: heightNum,
      weight_unit: data.weight_unit,
      current_weight: currentNum,
      goal_weight: Number(data.goal_weight),
      primary_goal: data.primary_goal ?? "",
      sports: data.sports,
      training_days_per_week: data.training_days_per_week,
      session_minutes: data.session_minutes,
      preferred_days: data.preferred_days,
      preferred_time: data.preferred_time,
      training_experience: data.training_experience,
      equipment_access: data.equipment_access,
      health_consent: data.health_consent,
      // Only forward medical rows when consent is on (privacy + Spec §11).
      medical_conditions: data.health_consent ? data.medical_conditions : [],
    };
    const result = await submitOnboarding(payload);
    if (result.ok) {
      router.replace("/");
      router.refresh();
    } else {
      setError(result.error);
      setBusy(false);
    }
  }

  // ---- Step 0: name ----
  if (step === 0) {
    const ok = data.display_name.trim().length > 0;
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="What should I call you?"
        subtitle="This is how your coach will greet you."
        onNext={next}
        nextDisabled={!ok}
      >
        <div>
          <FieldLabel>Name</FieldLabel>
          <TextField
            value={data.display_name}
            onChange={(v) => update({ display_name: v })}
            placeholder="Your name"
            autoFocus
            ariaLabel="Name"
          />
        </div>
      </WizardShell>
    );
  }

  // ---- Step 1: height (+ optional sex / birthdate) ----
  if (step === 1) {
    const ok = Number.isFinite(heightNum) && heightNum >= 80 && heightNum <= 260;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    // height_cm is always the canonical stored value; ft/in is display-only.
    const switchHeightUnit = (unit: "cm" | "ftin") => {
      if (unit === data.height_unit) return;
      if (unit === "ftin") {
        const cm = Number(data.height_cm);
        if (Number.isFinite(cm) && cm > 0) {
          const { feet, inches } = cmToFtIn(cm);
          let ft = feet;
          let inch = round1(inches);
          if (inch >= 12) {
            ft += 1;
            inch = 0;
          }
          update({ height_unit: unit, height_ft: String(ft), height_in: String(inch) });
        } else {
          update({ height_unit: unit });
        }
      } else {
        // ftin -> cm: height_cm is already maintained, nothing to convert.
        update({ height_unit: unit });
      }
    };

    const cmFromFtIn = (ftStr: string, inStr: string): string => {
      if (!ftStr && !inStr) return "";
      const ft = Number(ftStr);
      const inch = Number(inStr);
      if (!Number.isFinite(ft) || !Number.isFinite(inch)) return data.height_cm;
      return String(round1(ftInToCm(ft || 0, inch || 0)));
    };
    const setFeet = (v: string) =>
      update({ height_ft: v, height_cm: cmFromFtIn(v, data.height_in) });
    const setInches = (v: string) =>
      update({ height_in: v, height_cm: cmFromFtIn(data.height_ft, v) });

    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="A little about your body"
        subtitle="Height helps set your targets. Sex and birthdate are optional — they only sharpen estimates."
        onBack={back}
        onNext={next}
        nextDisabled={!ok}
      >
        <div>
          <FieldLabel>Height</FieldLabel>
          <div className="space-y-3">
            <Segmented
              options={[
                { value: "cm", label: "cm" },
                { value: "ftin", label: "ft / in" },
              ]}
              value={data.height_unit}
              onChange={switchHeightUnit}
            />
            {data.height_unit === "cm" ? (
              <TextField
                value={data.height_cm}
                onChange={(v) => update({ height_cm: v })}
                placeholder="170"
                inputMode="decimal"
                suffix="cm"
                autoFocus
                ariaLabel="Height in centimeters"
              />
            ) : (
              <div className="flex gap-3">
                <div className="flex-1">
                  <TextField
                    value={data.height_ft}
                    onChange={setFeet}
                    placeholder="5"
                    inputMode="numeric"
                    suffix="ft"
                    autoFocus
                    ariaLabel="Height, feet"
                  />
                </div>
                <div className="flex-1">
                  <TextField
                    value={data.height_in}
                    onChange={setInches}
                    placeholder="7"
                    inputMode="decimal"
                    suffix="in"
                    ariaLabel="Height, inches"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Sex (optional)</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {SEX_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={data.sex === o.value}
                onClick={() =>
                  update({ sex: data.sex === o.value ? null : o.value })
                }
              />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Birthdate (optional)</FieldLabel>
          <TextField
            value={data.birthdate}
            onChange={(v) => update({ birthdate: v })}
            type="date"
            ariaLabel="Birthdate"
          />
        </div>
      </WizardShell>
    );
  }

  // ---- Step 2: current & goal weight ----
  if (step === 2) {
    const cur = Number(data.current_weight);
    const goal = Number(data.goal_weight);
    const ok =
      Number.isFinite(cur) && cur > 0 && Number.isFinite(goal) && goal > 0;
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="Where you are, where you're headed"
        subtitle="We store everything in kg and just change how it's shown."
        onBack={back}
        onNext={next}
        nextDisabled={!ok}
      >
        <div>
          <FieldLabel>Units</FieldLabel>
          <Segmented
            options={[
              { value: "kg", label: "kg" },
              { value: "lbs", label: "lbs" },
            ]}
            value={data.weight_unit}
            onChange={(v) => update({ weight_unit: v })}
          />
        </div>
        <div>
          <FieldLabel>Current weight</FieldLabel>
          <TextField
            value={data.current_weight}
            onChange={(v) => update({ current_weight: v })}
            placeholder={data.weight_unit === "kg" ? "71.5" : "158"}
            inputMode="decimal"
            suffix={unitSuffix}
            autoFocus
            ariaLabel="Current weight"
          />
        </div>
        <div>
          <FieldLabel>Goal weight</FieldLabel>
          <TextField
            value={data.goal_weight}
            onChange={(v) => update({ goal_weight: v })}
            placeholder={data.weight_unit === "kg" ? "68" : "150"}
            inputMode="decimal"
            suffix={unitSuffix}
            ariaLabel="Goal weight"
          />
        </div>
      </WizardShell>
    );
  }

  // ---- Step 3: primary goal ----
  if (step === 3) {
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="What are you here for?"
        subtitle="This shapes your whole dashboard. You can change it anytime."
        onBack={back}
        onNext={next}
        nextDisabled={!data.primary_goal}
      >
        <div className="space-y-2.5">
          {PRIMARY_GOALS.map((o) => (
            <OptionCard
              key={o.value}
              label={o.label}
              hint={o.hint}
              selected={data.primary_goal === o.value}
              onClick={() => update({ primary_goal: o.value })}
            />
          ))}
        </div>
      </WizardShell>
    );
  }

  // ---- Step 4: sports (optional) ----
  if (step === 4) {
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="Any sports in the mix?"
        subtitle="Pick any that apply — your program balances lifting around them."
        onBack={back}
        onNext={next}
        onSkip={() => {
          update({ sports: [] });
          next();
        }}
      >
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={data.sports.includes(o.value)}
              onClick={() => update({ sports: toggle(data.sports, o.value) })}
            />
          ))}
        </div>
      </WizardShell>
    );
  }

  // ---- Step 5: availability ----
  if (step === 5) {
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="When can you train?"
        subtitle="Your program is built to fit the time you actually have."
        onBack={back}
        onNext={next}
      >
        <div>
          <FieldLabel>Training days per week</FieldLabel>
          <Stepper
            value={data.training_days_per_week}
            onChange={(v) => update({ training_days_per_week: v })}
            min={1}
            max={7}
            suffix="days"
            label="training days"
          />
        </div>
        <div>
          <FieldLabel>Typical session length</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {SESSION_MINUTE_OPTIONS.map((m) => (
              <Chip
                key={m}
                label={`${m} min`}
                selected={data.session_minutes === m}
                onClick={() => update({ session_minutes: m })}
              />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Preferred days (optional)</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={data.preferred_days.includes(o.value)}
                onClick={() =>
                  update({ preferred_days: toggle(data.preferred_days, o.value) })
                }
              />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Preferred time (optional)</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {PREFERRED_TIMES.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={data.preferred_time === o.value}
                onClick={() =>
                  update({
                    preferred_time:
                      data.preferred_time === o.value ? null : o.value,
                  })
                }
              />
            ))}
          </div>
        </div>
      </WizardShell>
    );
  }

  // ---- Step 6: experience & equipment ----
  if (step === 6) {
    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="Your training setup"
        subtitle="This gates how complex the plan gets and what movements it picks."
        onBack={back}
        onNext={next}
      >
        <div>
          <FieldLabel>Experience</FieldLabel>
          <div className="space-y-2.5">
            {TRAINING_EXPERIENCE.map((o) => (
              <OptionCard
                key={o.value}
                label={o.label}
                hint={o.hint}
                selected={data.training_experience === o.value}
                onClick={() => update({ training_experience: o.value })}
              />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Equipment access</FieldLabel>
          <div className="space-y-2.5">
            {EQUIPMENT_ACCESS.map((o) => (
              <OptionCard
                key={o.value}
                label={o.label}
                hint={o.hint}
                selected={data.equipment_access === o.value}
                onClick={() => update({ equipment_access: o.value })}
              />
            ))}
          </div>
        </div>
      </WizardShell>
    );
  }

  // ---- Step 7: medical (consent-gated) ----
  if (step === 7) {
    const addCondition = () =>
      update({
        medical_conditions: [
          ...data.medical_conditions,
          { condition: "", notes: "" },
        ],
      });
    const setCondition = (i: number, patch: Partial<{ condition: string; notes: string }>) =>
      update({
        medical_conditions: data.medical_conditions.map((c, idx) =>
          idx === i ? { ...c, ...patch } : c
        ),
      });
    const removeCondition = (i: number) =>
      update({
        medical_conditions: data.medical_conditions.filter((_, idx) => idx !== i),
      });

    return (
      <WizardShell
        step={step}
        total={TOTAL}
        title="Anything I should train around?"
        subtitle="Only if you want to share. This is private, optional, and used only to keep your program safe — never to diagnose."
        onBack={back}
        onNext={next}
        onSkip={() => {
          update({ health_consent: false, medical_conditions: [] });
          next();
        }}
      >
        <label className="flex items-start gap-3 rounded-tile border border-line bg-card p-4">
          <input
            type="checkbox"
            checked={data.health_consent}
            onChange={(e) =>
              update({
                health_consent: e.target.checked,
                medical_conditions: e.target.checked
                  ? data.medical_conditions
                  : [],
              })
            }
            className="mt-0.5 h-5 w-5 shrink-0 accent-green"
          />
          <span className="text-sm font-medium text-ink">
            I consent to storing the health notes I add below so my coach can
            account for them. I can remove them anytime.
          </span>
        </label>

        {data.health_consent ? (
          <div className="space-y-3">
            {data.medical_conditions.map((c, i) => (
              <div key={i} className="space-y-2 rounded-tile border border-line bg-card p-3">
                <AutoGrowTextarea
                  value={c.condition}
                  onChange={(v) => setCondition(i, { condition: v })}
                  placeholder="e.g. wrist issue"
                  ariaLabel={`Condition ${i + 1}`}
                />
                <AutoGrowTextarea
                  value={c.notes}
                  onChange={(v) => setCondition(i, { notes: v })}
                  placeholder="Notes (optional) — e.g. avoid heavy pressing"
                  ariaLabel={`Condition ${i + 1} notes`}
                />
                <button
                  type="button"
                  onClick={() => removeCondition(i)}
                  className="py-3 text-sm font-semibold text-muted transition-opacity hover:opacity-80"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addCondition}
              className="w-full rounded-chip border border-line bg-paper px-4 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-80"
            >
              + Add a condition
            </button>
          </div>
        ) : null}
      </WizardShell>
    );
  }

  // ---- Step 8: BMI shown once, with caveat → finish ----
  const currentKg =
    data.weight_unit === "lbs" ? lbsToKg(currentNum) : currentNum;
  const bmi = computeBmi(currentKg, heightNum);
  const band = bmiBand(bmi);

  return (
    <WizardShell
      step={step}
      total={TOTAL}
      eyebrow="One number, in context"
      title="Your BMI — a single data point"
      onBack={back}
      onNext={finish}
      nextLabel="Finish setup"
      busy={busy}
      error={error}
    >
      <div className="rounded-tile border border-line bg-card p-6 text-center">
        <p className="tnum font-serif text-6xl font-medium text-ink">
          {bmi > 0 ? bmi.toFixed(1) : "—"}
        </p>
        <p className="mt-1 text-sm font-semibold text-muted">
          {BMI_BAND_LABEL[band]}
        </p>
      </div>
      <p className="text-sm font-medium text-muted">
        We show this <span className="font-semibold text-ink">once</span> — it&apos;s
        one data point, not a verdict. BMI can&apos;t tell muscle from fat, so for
        someone who lifts it&apos;s context, never a judgment. Your plan is built
        from your goal and your trend over time, not this number.
      </p>
    </WizardShell>
  );
}
