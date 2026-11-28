// The Xclr mark (same as app/icon.svg), drawn with tokens.
export function XclrMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--ink)" />
      <path d="M19 18 L45 46" stroke="var(--green)" strokeWidth="9" strokeLinecap="round" />
      <path d="M45 18 L19 46" stroke="var(--ember)" strokeWidth="9" strokeLinecap="round" />
    </svg>
  );
}
