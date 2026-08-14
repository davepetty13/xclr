// Pure unit conversions (Master Spec §6). Storage is ALWAYS metric (kg); lbs is
// a display-only preference converted at the read/write boundary — never stored.
export const LB_PER_KG = 2.20462;

export function lbsToKg(lbs: number): number {
  return lbs / LB_PER_KG;
}

export function kgToLbs(kg: number): number {
  return kg * LB_PER_KG;
}
