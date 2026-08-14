// BMI is COMPUTED and shown once at signup as a single data point with a caveat
// (Master Spec §7, §11). It is never stored — height + weight live in their own
// columns/tables and BMI is derived at render time only.
export function computeBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  if (!Number.isFinite(m) || m <= 0) return 0;
  return weightKg / (m * m);
}

export type BmiBand = "underweight" | "healthy" | "overweight" | "obese";

export function bmiBand(bmi: number): BmiBand {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "healthy";
  if (bmi < 30) return "overweight";
  return "obese";
}

export const BMI_BAND_LABEL: Record<BmiBand, string> = {
  underweight: "Underweight range",
  healthy: "Healthy range",
  overweight: "Overweight range",
  obese: "Obese range",
};
