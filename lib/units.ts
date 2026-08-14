// Pure unit conversions (Master Spec §6). Storage is ALWAYS metric (kg); lbs is
// a display-only preference converted at the read/write boundary — never stored.
export const LB_PER_KG = 2.20462;

export function lbsToKg(lbs: number): number {
  return lbs / LB_PER_KG;
}

export function kgToLbs(kg: number): number {
  return kg * LB_PER_KG;
}

// Height helpers. Storage is always cm; ft/in is a display-only input mode.
export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;

export function ftInToCm(feet: number, inches: number): number {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches - feet * INCHES_PER_FOOT;
  return { feet, inches };
}
