// Share-card colours for the Canvas 2D drawing in lib/share-cards.ts.
//
// Canvas can't read CSS tokens, so the card palette lives here as named
// constants — the ONE place outside app/globals.css where hex is allowed
// (approved mocks: CardSession / CardWeek / CardPhoto, Nov 2026).
// The UI around the cards (the share sheet) still uses tokens only.

export const CARD_W = 1080; // Instagram Story size
export const CARD_H = 1920;
// Cards are drawn in the mocks' 360 × 640 units and scaled ×3.
export const CARD_UNIT = CARD_W / 360;

// Brand
export const MARK_SQUARE = "#16211B";
export const MARK_GREEN = "#6FCF97";
export const MARK_EMBER = "#E0603A";

export type CardTheme = {
  bg: string;
  text: string;
  muted: string; // labels, small caps
  sub: string; // secondary sentences
  accent: string; // second line of the headline (ember on dark)
  good: string; // "done" numbers, week strip
  pr: string; // PR numbers
  hairline: string;
  rowLine: string;
  track: string; // empty week-strip cells
  pillBg: string; // "NEW PR" pill
  pillText: string;
  panel: string | null; // stats panel behind the week numbers (paper only)
};

// 01 · Dark editorial (CardSession)
export const DARK: CardTheme = {
  bg: "#0B0B0C",
  text: "#F4F1EA",
  muted: "#9AA49C",
  sub: "#9AA49C",
  accent: "#E0603A",
  good: "#6FCF97",
  pr: "#F28A68",
  hairline: "rgba(244,241,234,0.14)",
  rowLine: "rgba(244,241,234,0.10)",
  track: "rgba(244,241,234,0.10)",
  pillBg: "#6FCF97",
  pillText: "#0B0B0C",
  panel: null,
};
export const DARK_GLOW = "rgba(224,96,58,0.22)";

// 03 · Paper (CardWeek)
export const PAPER: CardTheme = {
  bg: "#ECE7DC",
  text: "#16211B",
  muted: "#5A655D",
  sub: "#5A655D",
  accent: "#C24E2A",
  good: "#1E7A4D",
  pr: "#C24E2A",
  hairline: "rgba(22,33,27,0.14)",
  rowLine: "rgba(22,33,27,0.10)",
  track: "rgba(22,33,27,0.08)",
  pillBg: "#1E7A4D",
  pillText: "#FFFFFF",
  panel: "rgba(255,255,255,0.90)",
};
export const PAPER_GLOW_WHITE = "rgba(255,255,255,1)";
export const PAPER_GLOW_GREEN = "rgba(30,122,77,0.16)";
export const PAPER_PANEL_SHADOW = "rgba(22,33,27,0.18)";

// 02 · Your photo (CardPhoto): white type over a dark bottom fade
export const PHOTO: CardTheme = {
  bg: "#1C1E1B",
  text: "#FFFFFF",
  muted: "#C9D2CC",
  sub: "#E8E4DA",
  accent: "#E0603A",
  good: "#6FCF97",
  pr: "#F28A68",
  hairline: "rgba(255,255,255,0.20)",
  rowLine: "rgba(255,255,255,0.14)",
  track: "rgba(255,255,255,0.18)",
  pillBg: "#6FCF97",
  pillText: "#0B0B0C",
  panel: null,
};
export const PHOTO_FADE = "rgba(11,11,12,0.88)";
export const PHOTO_FADE_CLEAR = "rgba(11,11,12,0)";
export const PHOTO_TOP_SHADE = "rgba(11,11,12,0.35)";
export const SKIP_EDGE = "#E0603A";
// Shown under the stats only until the user's photo has loaded.
export const PHOTO_PLACEHOLDER_STOPS: [number, string][] = [
  [0, "#6B6A63"],
  [0.45, "#3E413C"],
  [1, "#1C1E1B"],
];
