// Share cards (v3.8): drawn on the phone with the Canvas 2D API at 1080 × 1920
// (Instagram Story size). No server image, no AI, no packages.
//
// Pure functions: they take a canvas context + plain data and draw. All the
// numbers come from the user's own rows (lib/share-data.ts builds them on the
// server); anything without data is simply not on the card.
// Colours live in lib/share-card-theme.ts (canvas can't read CSS tokens).

import {
  CARD_H,
  CARD_UNIT,
  CARD_W,
  DARK,
  DARK_GLOW,
  MARK_EMBER,
  MARK_GREEN,
  MARK_SQUARE,
  PAPER,
  PAPER_GLOW_GREEN,
  PAPER_GLOW_WHITE,
  PAPER_PANEL_SHADOW,
  PHOTO,
  PHOTO_FADE,
  PHOTO_FADE_CLEAR,
  PHOTO_PLACEHOLDER_STOPS,
  SKIP_EDGE,
  type CardTheme,
} from "@/lib/share-card-theme";

// ── Data shapes (plain, serialisable: server → client) ──────────────────────

export type CardKind = "session" | "week" | "pr";
export type CardBackground = "dark" | "paper" | "photo";

export type ShareStat = { label: string; value: string; unit?: string; tone?: "pr" | "good" };

// Session card v2: what the list under the stats shows, and how gains read.
export type ShowMode = "wins" | "muscle" | "top3" | "every";
export const SHOW_MODES: { value: ShowMode; label: string }[] = [
  { value: "wins", label: "Wins vs last time" },
  { value: "muscle", label: "By muscle group" },
  { value: "top3", label: "Top 3 lifts" },
  { value: "every", label: "Every exercise" },
];
export type GainUnit = "pct" | "kg";
export type CompareTo = "last" | "week1";
export const COMPARE_OPTIONS: { value: CompareTo; label: string }[] = [
  { value: "last", label: "Last time" },
  { value: "week1", label: "Week 1" },
];

export type MuscleGroup = "push" | "pull" | "legs" | "core" | "cardio" | "mobility" | "other";
export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  push: "Push",
  pull: "Pull",
  legs: "Legs",
  core: "Core",
  cardio: "Cardio",
  mobility: "Mobility",
  other: "Other",
};

// One exercise's change against the comparison session (same load type only).
export type Gain = {
  dir: "up" | "steady" | "down";
  pct: string | null; // "+11%" — null where a % means nothing (reps, assist, time)
  abs: string; // "+2.5 kg", "+2.5 kg/side", "+2 reps", "5 kg less assist", "+5 min"
  score: number; // relative change, for ranking only
};

export type SessionLift = {
  name: string;
  group: MuscleGroup;
  value: string; // best set: "62.5 kg × 8"
  volume: number; // kg moved (real external load only)
  sets: number;
  pr: boolean;
};

export type SessionCompare = {
  gains: (Gain | null)[]; // same order as lifts; null = not done (same load type) that time
  groupVolume: Partial<Record<MuscleGroup, number>>; // that session's kg per group
};

export type SessionCardData = {
  dateLabel: string; // "THU · 26 NOV 2026"
  shortDate: string; // "THU 26 NOV"
  titleTop: string; // "DAY 4"
  titleBottom: string | null; // "PUSH"
  subline: string | null; // "Week 3 · Lose fat"
  week: number | null;
  stats: ShareStat[]; // VOLUME / SETS / AVG RPE — only the ones with data
  lifts: SessionLift[]; // in the order the exercises were logged
  firstLabel: string; // "FIRST TIME" (a program day done for the first time) / "THIS SESSION"
  compare: Record<CompareTo, SessionCompare | null>; // null = no earlier session to compare
  prNames: string[];
  note: string | null; // only drawn when "Session notes" is on
};

export type StripState = "done" | "skipped" | "open" | "later";

export type WeekCardData = {
  week: number;
  rangeLabel: string; // "23 – 29 NOV"
  done: number;
  planned: number;
  summary: string; // "Every session done."
  strip: { letter: string; state: StripState }[]; // Mon → Sun
  stats: ShareStat[]; // PROTEIN AVG / VOLUME / PRS / AVG SLEEP
  changes: { name: string; value: string }[]; // approved progression changes
  bodyWeight: string | null; // only drawn when "Body weight" is on
};

export type PrCardData = {
  exercise: string; // "Bench press"
  big: string; // "62.5"
  unit: string; // "KG"
  detail: string; // "× 8 reps · RPE 8 · up 2.5 kg on your best"
  dateLabel: string;
  stats: ShareStat[]; // SESSION / VOLUME / WEEK
};

export type ShareBundle = {
  session: SessionCardData | null;
  week: WeekCardData | null;
  pr: PrCardData | null;
};

export type CardFonts = { display: string; sans: string };

export type DrawOptions = {
  background: CardBackground;
  photo: HTMLImageElement | null; // drawn locally only — never uploaded
  showNotes: boolean;
  showWeight: boolean;
  fonts: CardFonts;
  show: ShowMode; // session card only
  gainUnit: GainUnit;
  compareTo: CompareTo;
};

// ── Fonts ───────────────────────────────────────────────────────────────────

// next/font gives the families hashed names, so read them from the CSS
// variables the root layout sets, then wait for the weights the cards use.
export async function loadCardFonts(): Promise<CardFonts> {
  const cs = typeof document !== "undefined" ? getComputedStyle(document.body) : null;
  const display = cs?.getPropertyValue("--font-display").trim() || "Sora, system-ui, sans-serif";
  const sans = cs?.getPropertyValue("--font-sans").trim() || "'Hanken Grotesk', system-ui, sans-serif";
  const fonts = { display, sans };
  if (typeof document === "undefined" || !document.fonts) return fonts;
  const wanted = [
    `800 40px ${display}`,
    `700 40px ${display}`,
    `600 40px ${display}`,
    `400 16px ${sans}`,
    `500 16px ${sans}`,
    `600 16px ${sans}`,
    `700 16px ${sans}`,
  ];
  try {
    await Promise.race([
      Promise.all(wanted.map((f) => document.fonts.load(f))).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 4000)), // never hang the sheet on a slow font
    ]);
  } catch {
    // fall back to whatever is loaded
  }
  return fonts;
}

// ── Low-level drawing helpers (all in the mocks' 360 × 640 units) ───────────

const W = 360;
const H = 640;
const PAD_X = 26;
const PAD_TOP = 28;
const CONTENT_W = W - PAD_X * 2;

type Ctx = CanvasRenderingContext2D;
type Pen = { ctx: Ctx; fonts: CardFonts; t: CardTheme };
type TextStyle = {
  size: number;
  weight: number;
  face?: "display" | "sans";
  color: string;
  track?: number; // letter-spacing in em
};

function setFont(p: Pen, s: TextStyle) {
  p.ctx.font = `${s.weight} ${s.size}px ${s.face === "display" ? p.fonts.display : p.fonts.sans}`;
}

// Width of a run of text, honouring letter-spacing (drawn per character so it
// works on every Safari, with or without ctx.letterSpacing).
function measure(p: Pen, text: string, s: TextStyle): number {
  setFont(p, s);
  const track = (s.track ?? 0) * s.size;
  if (!track) return p.ctx.measureText(text).width;
  const chars = Array.from(text);
  let w = 0;
  for (const ch of chars) w += p.ctx.measureText(ch).width;
  return w + track * Math.max(0, chars.length - 1);
}

function text(
  p: Pen,
  str: string,
  x: number,
  baseline: number,
  s: TextStyle,
  align: "left" | "right" = "left"
): number {
  const width = measure(p, str, s);
  setFont(p, s);
  const { ctx } = p;
  ctx.fillStyle = s.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cx = align === "right" ? x - width : x;
  const track = (s.track ?? 0) * s.size;
  if (!track) {
    ctx.fillText(str, cx, baseline);
    return width;
  }
  for (const ch of Array.from(str)) {
    ctx.fillText(ch, cx, baseline);
    cx += ctx.measureText(ch).width + track;
  }
  return width;
}

// Baseline for a line box that starts at `top` (ascent ≈ .95em, descent ≈ .25em).
function bl(top: number, size: number, lineHeight: number): number {
  return top + (size * lineHeight - size * 1.2) / 2 + size * 0.95;
}

function ellipsize(p: Pen, str: string, s: TextStyle, maxW: number): string {
  if (measure(p, str, s) <= maxW) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && measure(p, `${chars.join("").trimEnd()}…`, s) > maxW) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

// Largest size ≤ max at which every line fits maxW (never below min).
function fitSize(p: Pen, lines: string[], s: TextStyle, max: number, min: number, maxW: number): number {
  let size = max;
  while (size > min && lines.some((l) => measure(p, l, { ...s, size }) > maxW)) size -= 1;
  return size;
}

function wrap(p: Pen, str: string, s: TextStyle, maxW: number, maxLines: number): string[] {
  const words = str.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (measure(p, next, s) <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const usedAll = lines.join(" ").length >= words.join(" ").length;
  if (!usedAll && lines.length) {
    lines[lines.length - 1] = ellipsize(p, `${lines[lines.length - 1]}…`, s, maxW);
  }
  return lines.map((l) => ellipsize(p, l, s, maxW));
}

// Headline words. With `glue`, a dash / slash / dot sticks to the word before
// it, and so does a lone letter or digit, so "UPPER A — PUSH" breaks as
// "UPPER A —" / "PUSH" and a line never starts with "— PUSH".
function headlineTokens(str: string, glue: boolean): string[] {
  const raw = str.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!glue) return raw;
  const out: string[] = [];
  for (const w of raw) {
    if (out.length && (/^[—–\-/·&+|:]$/.test(w) || /^[A-Za-z0-9]$/.test(w))) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  return out;
}

// Greedy word wrap with no line limit; null when one word alone is too wide.
function wrapTokens(p: Pen, tokens: string[], s: TextStyle, maxW: number): string[] | null {
  const lines: string[] = [];
  let cur = "";
  for (const t of tokens) {
    if (measure(p, t, s) > maxW) return null;
    const next = cur ? `${cur} ${t}` : t;
    if (measure(p, next, s) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Largest size (max → min) at which `str` wraps word by word into ≤ maxLines
// lines of maxW, and those lines plus the `fixed` lines above them stay within
// maxH. Only when even a single word can't fit at the minimum size does the
// text get an ellipsis.
function fitHeadline(
  p: Pen,
  str: string,
  s: TextStyle,
  o: { max: number; min: number; maxW: number; maxLines: number; maxH: number; lh: number; fixed?: string[] }
): { size: number; lines: string[] } {
  const fixed = o.fixed ?? [];
  for (const glue of [true, false]) {
    const tokens = headlineTokens(str, glue);
    for (let size = o.max; size >= o.min; size -= 1) {
      const st = { ...s, size };
      if (fixed.some((f) => measure(p, f, st) > o.maxW)) continue;
      const lines = wrapTokens(p, tokens, st, o.maxW);
      if (!lines || lines.length > o.maxLines) continue;
      if ((lines.length + fixed.length) * size * o.lh > o.maxH) continue;
      return { size, lines };
    }
  }
  // Too long for maxLines even at the minimum size: keep every word (one more
  // line; the list below makes room). Ellipsis only for a word that can't fit.
  const st = { ...s, size: o.min };
  const all = wrapTokens(p, headlineTokens(str, false), st, o.maxW);
  if (all && all.length <= o.maxLines + 1) return { size: o.min, lines: all };
  return { size: o.min, lines: wrap(p, str, st, o.maxW, o.maxLines + 1) };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hline(p: Pen, x: number, y: number, w: number, color: string) {
  p.ctx.fillStyle = color;
  p.ctx.fillRect(x, y, w, 1);
}

// Elliptical "radial-gradient(rx ry at cx cy, color, transparent stop)".
// Colours are rgba(r,g,b,a) strings; the outer stop is the same colour at 0.
function glow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, stop: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, color);
  g.addColorStop(stop, color.replace(/,\s*[\d.]+\)$/, ",0)"));
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

// The X mark: rounded ink square, green + ember diagonals (64-unit viewBox).
export function drawMark(ctx: Ctx, x: number, y: number, size: number) {
  const k = size / 64;
  ctx.save();
  ctx.fillStyle = MARK_SQUARE;
  roundRect(ctx, x, y, size, size, 15 * k);
  ctx.fill();
  ctx.lineCap = "round";
  ctx.lineWidth = 9 * k;
  ctx.strokeStyle = MARK_GREEN;
  ctx.beginPath();
  ctx.moveTo(x + 19 * k, y + 18 * k);
  ctx.lineTo(x + 45 * k, y + 46 * k);
  ctx.stroke();
  ctx.strokeStyle = MARK_EMBER;
  ctx.beginPath();
  ctx.moveTo(x + 45 * k, y + 18 * k);
  ctx.lineTo(x + 19 * k, y + 46 * k);
  ctx.stroke();
  ctx.restore();
}

function logo(p: Pen, x: number, top: number, size: number) {
  drawMark(p.ctx, x, top, size);
  text(p, "XCLR", x + size + 8, top + size / 2 + (size === 22 ? 4.6 : 4.2), {
    size: size === 22 ? 13 : 12,
    weight: 700,
    face: "display",
    color: p.t.text,
    track: 0.24,
  });
}

// ── Backgrounds ─────────────────────────────────────────────────────────────

function paintDark(ctx: Ctx) {
  ctx.fillStyle = DARK.bg;
  ctx.fillRect(0, 0, W, H);
  // ember glow: 360 × 360 at right −120, top 120
  glow(ctx, W + 120 - 180, 120 + 180, 180, 180, DARK_GLOW, 1);
}

function paintPaper(ctx: Ctx) {
  ctx.fillStyle = PAPER.bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.1, H * 0.06, W * 0.6, H * 0.4, PAPER_GLOW_WHITE, 0.7);
  glow(ctx, W, H * 0.9, W * 0.55, H * 0.45, PAPER_GLOW_GREEN, 0.7);
}

function paintPhoto(ctx: Ctx, photo: HTMLImageElement | null, contentTop: number) {
  if (photo && photo.naturalWidth > 0) {
    // cover-fit the user's photo (orientation is applied by the browser)
    const iw = photo.naturalWidth;
    const ih = photo.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.17, H);
    for (const [at, c] of PHOTO_PLACEHOLDER_STOPS) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // dark bottom fade behind the numbers
  const start = Math.max(0, contentTop - 110);
  const fade = ctx.createLinearGradient(0, start, 0, H);
  fade.addColorStop(0, PHOTO_FADE_CLEAR);
  fade.addColorStop(Math.min(0.99, (contentTop + 40 - start) / (H - start)), PHOTO_FADE);
  fade.addColorStop(1, PHOTO_FADE);
  ctx.fillStyle = fade;
  ctx.fillRect(0, start, W, H - start);
}

// ── Shared blocks ───────────────────────────────────────────────────────────

const LABEL = (t: CardTheme, size = 9): TextStyle => ({ size, weight: 700, color: t.muted, track: 0.16 });

// 2-column stat grid (dark / paper layout). Returns the new cursor.
function statGrid(p: Pen, stats: ShareStat[], top: number, valueSize: number, unitSize: number): number {
  const colW = (CONTENT_W - 14) / 2;
  let y = top;
  for (let i = 0; i < stats.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const s = stats[i + c];
      if (!s) continue;
      const x = PAD_X + c * (colW + 14);
      text(p, s.label, x, y + 9, LABEL(p.t));
      const color = s.tone === "pr" ? p.t.pr : s.tone === "good" ? p.t.good : p.t.text;
      const vBase: TextStyle = { size: valueSize, weight: 700, face: "display", color, track: -0.03 };
      // A word value ("Upper A — Push") shrinks to fit before it is cut.
      const maxW = s.unit ? colW - 30 : colW - 6;
      const vStyle = { ...vBase, size: fitSize(p, [s.value], vBase, valueSize, 16, maxW) };
      const base = y + 12 + bl(0, valueSize, 1.25);
      const vw = text(p, ellipsize(p, s.value, vStyle, maxW), x, base, vStyle);
      if (s.unit)
        text(p, ` ${s.unit}`, x + vw, base, { size: unitSize, weight: 600, color: p.t.muted });
    }
    y += 12 + valueSize * 1.25;
    if (i + 2 < stats.length) y += valueSize > 28 ? 18 : 14;
  }
  return y;
}

function pill(p: Pen, label: string, right: number, top: number) {
  const s: TextStyle = { size: 10, weight: 700, color: p.t.pillText, track: 0.14 };
  const str = ellipsize(p, label, s, 216); // leaves room for the XCLR mark
  const w = measure(p, str, s) + 16;
  p.ctx.fillStyle = p.t.pillBg;
  roundRect(p.ctx, right - w, top, w, 22, 6);
  p.ctx.fill();
  text(p, str, right - 8, top + 15, s, "right");
}

function noteBlock(p: Pen, note: string, top: number, maxLines: number): number {
  text(p, "NOTE", PAD_X, top + 9, LABEL(p.t));
  const s: TextStyle = { size: 13, weight: 500, color: p.t.sub };
  const lines = wrap(p, `“${note}”`, s, CONTENT_W, maxLines);
  let y = top + 21;
  for (const l of lines) {
    text(p, l, PAD_X, y + 12.5, s);
    y += 18;
  }
  return y;
}

function strip(
  p: Pen,
  cells: WeekCardData["strip"],
  left: number,
  width: number,
  top: number,
  height: number
): number {
  const gap = 6;
  const cw = (width - gap * 6) / 7;
  const { ctx } = p;
  cells.forEach((c, i) => {
    const x = left + i * (cw + gap);
    ctx.save();
    if (c.state === "later") ctx.globalAlpha = 0.5;
    ctx.fillStyle = c.state === "done" ? p.t.good : p.t.track;
    roundRect(ctx, x, top, cw, height, 8);
    ctx.fill();
    if (c.state === "skipped") {
      ctx.strokeStyle = SKIP_EDGE;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x + 0.75, top + 0.75, cw - 1.5, height - 1.5, 7.5);
      ctx.stroke();
    }
    ctx.restore();
    // day letter under each cell (M T W T F S S)
    const s: TextStyle = { size: 9, weight: 700, color: p.t.muted, track: 0.1 };
    const lw = measure(p, c.letter, s);
    text(p, c.letter, x + (cw - lw) / 2, top + height + 5 + 9, s);
  });
  return top + height + 16;
}

function kickerRow(p: Pen, left: string, right: string) {
  const s: TextStyle = { size: 10, weight: p.t === PAPER ? 700 : 600, color: p.t.muted, track: 0.16 };
  text(p, left, PAD_X, PAD_TOP + 9.5, s);
  text(p, right, W - PAD_X, PAD_TOP + 9.5, s, "right");
}

const FOOTER_TOP = H - PAD_TOP - 22; // 590

// ── Full layouts (Dark / Paper) ─────────────────────────────────────────────

// ── Session card v2 (CardSessionWins / Muscle / Top3 mocks) ────────────────

type Row = { name: string; value: string; gain: string | null; tone: "good" | "muted" };
type Section = { label: string; color: string } & ({ rows: Row[] } | { names: string[] });

const LABEL_H = 16; // section label (9px caps) + gap
const ROW_GAP = 12;
const SECTION_GAP = 16;
const MORE_H = 20;

function gainText(g: Gain, unit: GainUnit): string {
  return unit === "pct" && g.pct ? g.pct : g.abs;
}

function liftRow(l: SessionLift, gain: string | null = null): Row {
  return { name: l.name, value: l.value, gain, tone: "good" };
}

// "DAY 1" then the day label in ember, wrapped word by word and shrunk to fit.
function sessionHeadline(p: Pen, top: string, bottom: string | null, y: number): number {
  const hs: TextStyle = { size: 76, weight: 800, face: "display", color: p.t.text, track: -0.05 };
  const LH = 0.9;
  if (!bottom) {
    const size = fitSize(p, [top], hs, 76, 34, CONTENT_W);
    const s = { ...hs, size };
    text(p, ellipsize(p, top, s, CONTENT_W), PAD_X, bl(y, size, LH), s);
    return y + size * LH;
  }
  const fit = fitHeadline(p, bottom, hs, {
    max: 76,
    min: 30,
    maxW: CONTENT_W,
    maxLines: 3,
    maxH: 168,
    lh: LH,
    fixed: [top],
  });
  const s = { ...hs, size: fit.size };
  text(p, top, PAD_X, bl(y, fit.size, LH), s);
  y += fit.size * LH;
  for (const l of fit.lines) {
    text(p, l, PAD_X, bl(y, fit.size, LH), { ...s, color: p.t.accent });
    y += fit.size * LH;
  }
  return y;
}

// One row of stats (3 across; 4 only if a real Time stat is ever added).
function statRow(p: Pen, stats: ShareStat[], top: number): number {
  const cols = Math.min(4, stats.length);
  const gap = 10;
  const colW = (CONTENT_W - gap * (cols - 1)) / cols;
  const vSize = cols >= 4 ? 20 : 24;
  stats.slice(0, cols).forEach((s, i) => {
    const x = PAD_X + i * (colW + gap);
    text(p, ellipsize(p, s.label, LABEL(p.t), colW), x, top + 9, LABEL(p.t));
    const color = s.tone === "pr" ? p.t.pr : s.tone === "good" ? p.t.good : p.t.text;
    const vStyle: TextStyle = { size: vSize, weight: 700, face: "display", color, track: -0.03 };
    const us: TextStyle = { size: 11, weight: 600, color: p.t.muted };
    const unitW = s.unit ? measure(p, ` ${s.unit}`, us) : 0;
    const base = top + 12 + bl(0, vSize, 1.25);
    const vw = text(p, ellipsize(p, s.value, vStyle, colW - unitW), x, base, vStyle);
    if (s.unit) text(p, ` ${s.unit}`, x + vw, base, us);
  });
  return top + 12 + vSize * 1.25;
}

type RowLayout = { lines: string[]; value: string; h: number };

function layoutRow(p: Pen, r: Row, size: number): RowLayout {
  const vs: TextStyle = { size, weight: 600, face: "display", color: p.t.text };
  const ns: TextStyle = { size, weight: 500, color: p.t.text };
  const gainW = r.gain ? measure(p, ` ${r.gain}`, vs) : 0;
  let value = r.value;
  if (CONTENT_W - measure(p, value, vs) - gainW - 10 < 110) value = ellipsize(p, value, vs, CONTENT_W - gainW - 120);
  const nameW = CONTENT_W - measure(p, value, vs) - gainW - 10;
  const lines = wrap(p, r.name, ns, nameW, 2);
  return { lines, value, h: lines.length * (size + 3) };
}

function drawRow(p: Pen, r: Row, L: RowLayout, top: number, size: number) {
  const vs: TextStyle = { size, weight: 600, face: "display", color: p.t.text };
  const ns: TextStyle = { size, weight: 500, color: p.t.text };
  const base = top + size * 0.96;
  let right = W - PAD_X;
  if (r.gain) {
    const gs = { ...vs, color: r.tone === "good" ? p.t.good : p.t.muted };
    right -= text(p, r.gain, right, base, gs, "right");
    right -= measure(p, " ", vs);
  }
  text(p, L.value, right, base, vs, "right");
  L.lines.forEach((l, i) => text(p, l, PAD_X, base + i * (size + 3), ns));
}

function moreLine(p: Pen, n: number, noun: string, y: number) {
  const s: TextStyle = { size: 11, weight: 500, color: p.t.muted };
  text(p, `+ ${n} more ${noun}${n === 1 ? "" : "s"}`, PAD_X, y + 6 + 10, s);
}

// Sections of rows / name lines, as many as fit above `bottom`; whatever is
// left (plus `hidden`, items never in a section) becomes "+ N more …".
function drawSections(
  p: Pen,
  sections: Section[],
  top: number,
  bottom: number,
  size: number,
  noun: string,
  hidden = 0
): number {
  const items = (s: Section) => ("rows" in s ? s.rows.length : s.names.length);
  let left = sections.reduce((n, s) => n + items(s), 0) + hidden;
  let y = top;
  let first = true;
  let stop = false;
  for (const sec of sections) {
    if (stop || !items(sec)) continue;
    const start = first ? y : y + SECTION_GAP;
    const labelStyle = { ...LABEL(p.t), color: sec.color };
    if ("rows" in sec) {
      let yy = start + LABEL_H;
      let drawn = 0;
      for (const r of sec.rows) {
        const L = layoutRow(p, r, size);
        const sep = drawn ? ROW_GAP : 0;
        const need = sep + L.h + (left - 1 > 0 ? MORE_H : 0);
        if (yy + need > bottom) {
          stop = true;
          break;
        }
        if (!drawn) text(p, sec.label, PAD_X, start + 9, labelStyle);
        else hline(p, PAD_X, yy + ROW_GAP / 2 - 1, CONTENT_W, p.t.rowLine);
        yy += sep;
        drawRow(p, r, L, yy, size);
        yy += L.h;
        drawn++;
        left--;
      }
      if (drawn) {
        y = yy;
        first = false;
      }
    } else {
      const ns: TextStyle = { size: 13, weight: 500, color: p.t.soft };
      const lineH = 17;
      const n = sec.names.length;
      const rest = left - n;
      const room = Math.floor((bottom - (start + LABEL_H) - (rest > 0 ? MORE_H : 0)) / lineH);
      const maxLines = Math.min(2, room);
      if (maxLines < 1) {
        stop = true;
        continue;
      }
      let lines: string[] | null = null;
      for (let k = n; k >= 1 && !lines; k--) {
        const str = sec.names.slice(0, k).join(" · ") + (k < n ? ` · +${n - k}` : "");
        const w = wrapTokens(p, str.split(" "), ns, CONTENT_W);
        if (w && w.length <= maxLines) lines = w;
      }
      lines ??= wrap(p, sec.names.join(" · "), ns, CONTENT_W, maxLines);
      text(p, sec.label, PAD_X, start + 9, labelStyle);
      let yy = start + LABEL_H;
      for (const l of lines) {
        text(p, l, PAD_X, yy + 12.5, ns);
        yy += lineH;
      }
      y = yy - 4;
      left -= n; // the line carries its own "+N"
      first = false;
    }
  }
  if (left > 0) {
    moreLine(p, left, noun, y);
    y += MORE_H;
  }
  return y;
}

type GroupSum = { group: MuscleGroup; volume: number; sets: number; names: string[] };

function groupSums(lifts: SessionLift[]): GroupSum[] {
  const m = new Map<MuscleGroup, GroupSum>();
  for (const l of lifts) {
    const g = m.get(l.group) ?? { group: l.group, volume: 0, sets: 0, names: [] };
    g.volume += l.volume;
    g.sets += l.sets;
    g.names.push(l.name);
    m.set(l.group, g);
  }
  return Array.from(m.values()).sort((a, b) => b.volume - a.volume || b.sets - a.sets);
}

const fmtKg = (n: number) => Math.round(n).toLocaleString("en-US");

// Change of a group's volume vs the comparison session. Nothing when that
// session had no volume there (no number to compare) or it went down.
function groupChange(
  g: GroupSum,
  cmp: SessionCompare | null,
  unit: GainUnit
): { text: string; up: boolean } | null {
  const prev = cmp?.groupVolume[g.group];
  if (prev == null || !(prev > 0) || !(g.volume > 0)) return null;
  const delta = g.volume - prev;
  if (unit === "pct") {
    const r = Math.round((delta / prev) * 100);
    if (r < 0) return null;
    return r === 0 ? { text: "±0%", up: false } : { text: `+${r}%`, up: true };
  }
  const k = Math.round(delta);
  if (k < 0) return null;
  return k === 0 ? { text: "±0 kg", up: false } : { text: `+${fmtKg(k)} kg`, up: true };
}

function drawGroups(p: Pen, d: SessionCardData, o: DrawOptions, top: number, bottom: number): number {
  const groups = groupSums(d.lifts);
  const cmp = d.compare[o.compareTo];
  const maxVol = Math.max(0, ...groups.map((g) => g.volume));
  const BLOCK = 49;
  const GAP = 14;
  let y = top;
  let shown = 0;
  for (const g of groups) {
    const after = groups.length - shown - 1;
    const need = (shown ? GAP : 0) + BLOCK + (after > 0 ? MORE_H : 0);
    if (y + need > bottom) break;
    if (shown) y += GAP;
    const base = y + 16;
    text(p, MUSCLE_LABEL[g.group].toUpperCase(), PAD_X, base, { ...LABEL(p.t), color: p.t.text });
    const ch = groupChange(g, cmp, o.gainUnit);
    let right = W - PAD_X;
    if (ch) {
      const cs: TextStyle = { size: 13, weight: 700, face: "display", color: ch.up ? p.t.good : p.t.muted };
      right -= text(p, ch.text, right, base, cs, "right") + 5;
    }
    const vs: TextStyle = { size: 18, weight: 700, face: "display", color: p.t.text };
    const us: TextStyle = { size: 11, weight: 600, color: p.t.muted };
    if (g.volume > 0) {
      right -= text(p, " kg", right, base, us, "right");
      text(p, fmtKg(g.volume), right, base, vs, "right");
    } else {
      right -= text(p, g.sets === 1 ? " set" : " sets", right, base, us, "right");
      text(p, String(g.sets), right, base, vs, "right");
    }
    const barY = y + 24;
    p.ctx.fillStyle = p.t.track;
    roundRect(p.ctx, PAD_X, barY, CONTENT_W, 6, 3);
    p.ctx.fill();
    if (g.volume > 0 && maxVol > 0) {
      p.ctx.fillStyle = ch?.up ? p.t.accent : p.t.muted;
      roundRect(p.ctx, PAD_X, barY, Math.max(6, (g.volume / maxVol) * CONTENT_W), 6, 3);
      p.ctx.fill();
    }
    const ns: TextStyle = { size: 11, weight: 500, color: p.t.muted };
    text(p, ellipsize(p, g.names.join(" · "), ns, CONTENT_W), PAD_X, barY + 6 + 15, ns);
    y += BLOCK;
    shown++;
  }
  if (shown < groups.length) {
    const n = groups.length - shown;
    text(p, `+ ${n} more group${n === 1 ? "" : "s"}`, PAD_X, y + 16, { size: 11, weight: 500, color: p.t.muted });
    y += MORE_H;
  }
  return y;
}

// Wins: NEW PR, WENT UP, HELD STEADY. Lifts that went down are simply not
// listed; with nothing earlier to compare, one FIRST TIME list and no gains.
function winsSections(p: Pen, d: SessionCardData, o: DrawOptions): Section[] {
  const cmp = d.compare[o.compareTo];
  if (!cmp) return [{ label: d.firstLabel, color: p.t.muted, rows: d.lifts.map((l) => liftRow(l)) }];
  const idx = d.lifts.map((_, i) => i);
  const g = (i: number) => cmp.gains[i];
  const prs = idx.filter((i) => d.lifts[i].pr);
  const up = idx.filter((i) => !d.lifts[i].pr && g(i)?.dir === "up").sort((a, b) => g(b)!.score - g(a)!.score);
  const steady = idx.filter((i) => !d.lifts[i].pr && g(i)?.dir === "steady");
  const fresh = idx.filter((i) => !d.lifts[i].pr && g(i) == null);
  const row = (i: number) => {
    const gi = g(i);
    return liftRow(d.lifts[i], gi && gi.dir === "up" ? gainText(gi, o.gainUnit) : null);
  };
  const all: Section[] = [
    { label: "NEW PR", color: p.t.good, rows: prs.map(row) },
    { label: "WENT UP", color: p.t.accent, rows: up.map(row) },
    { label: "HELD STEADY", color: p.t.muted, names: steady.map((i) => d.lifts[i].name) },
    // done today but not (with the same load type) that time: no number to compare
    { label: "ALSO TRAINED", color: p.t.muted, names: fresh.map((i) => d.lifts[i].name) },
  ];
  const sections = all.filter((s) => ("rows" in s ? s.rows.length : s.names.length) > 0);
  // Nothing to celebrate against that session: just the sets, no gains.
  if (!sections.length) return [{ label: "TOP SETS", color: p.t.muted, rows: d.lifts.map((l) => liftRow(l)) }];
  return sections;
}

// Top 3: biggest gains first (est. 1RM change), then PRs, then most volume.
function top3Rows(d: SessionCardData, o: DrawOptions): Row[] {
  const cmp = d.compare[o.compareTo];
  const idx = d.lifts.map((_, i) => i);
  const g = (i: number) => cmp?.gains[i] ?? null;
  const up = idx.filter((i) => g(i)?.dir === "up").sort((a, b) => g(b)!.score - g(a)!.score);
  const prs = idx.filter((i) => !up.includes(i) && d.lifts[i].pr);
  const rest = idx
    .filter((i) => !up.includes(i) && !prs.includes(i))
    .sort((a, b) => d.lifts[b].volume - d.lifts[a].volume);
  return [...up, ...prs, ...rest].slice(0, 3).map((i) => {
    const gi = g(i);
    const gain = gi && gi.dir === "up" ? gainText(gi, o.gainUnit) : d.lifts[i].pr ? "PR" : null;
    return liftRow(d.lifts[i], gain);
  });
}

function sessionList(p: Pen, d: SessionCardData, o: DrawOptions, top: number, bottom: number): number {
  if (!d.lifts.length) return top;
  switch (o.show) {
    case "muscle":
      return drawGroups(p, d, o, top, bottom);
    case "top3": {
      const rows = top3Rows(d, o);
      const label = rows.length === 1 ? "BEST LIFT" : `BEST ${rows.length} LIFTS`;
      return drawSections(p, [{ label, color: p.t.muted, rows }], top, bottom, 14, "exercise", d.lifts.length - rows.length);
    }
    case "every":
      return drawSections(p, [{ label: "TOP SETS", color: p.t.muted, rows: d.lifts.map((l) => liftRow(l)) }], top, bottom, 13, "exercise");
    default:
      return drawSections(p, winsSections(p, d, o), top, bottom, 13, "exercise");
  }
}

function prChipLabel(d: SessionCardData): string {
  return `NEW PR · ${d.prNames.length > 1 ? `${d.prNames.length} LIFTS` : d.prNames[0].toUpperCase()}`;
}

function sessionFull(p: Pen, d: SessionCardData, o: DrawOptions) {
  kickerRow(p, "01 / SESSION", d.dateLabel);
  let y = sessionHeadline(p, d.titleTop, d.titleBottom, PAD_TOP + 13 + 26);
  if (d.subline) {
    y += 10;
    const s: TextStyle = { size: 12, weight: 500, color: p.t.sub, track: 0.04 };
    text(p, ellipsize(p, d.subline, s, CONTENT_W), PAD_X, y + 11.4, s);
    y += 15;
  }
  if (d.stats.length) {
    y += 18;
    hline(p, PAD_X, y, CONTENT_W, p.t.hairline);
    y = statRow(p, d.stats, y + 14);
  }

  const showNote = o.showNotes && !!d.note;
  const bottom = FOOTER_TOP - 14 - (showNote ? 16 + 21 + 18 * 2 : 0);
  y = sessionList(p, d, o, y + 20, bottom);
  if (showNote && d.note) noteBlock(p, d.note, y + 16, 2);

  logo(p, PAD_X, FOOTER_TOP, 22);
  const cmp = d.compare[o.compareTo];
  const prChip = d.prNames.length > 0 && (o.show === "top3" || o.show === "every" || !cmp);
  if (prChip) pill(p, prChipLabel(d), W - PAD_X, FOOTER_TOP);
  else if (cmp && o.show !== "every")
    text(
      p,
      o.compareTo === "week1" ? "VS WEEK 1" : "VS LAST TIME",
      W - PAD_X,
      FOOTER_TOP + 15,
      { size: 10, weight: 600, color: p.t.muted, track: 0.12 },
      "right"
    );
}

// Up to `max` rows for the photo layout, picked the same way as the full card.
function photoRows(p: Pen, d: SessionCardData, o: DrawOptions, max: number): Row[] {
  if (o.show === "muscle") {
    const cmp = d.compare[o.compareTo];
    return groupSums(d.lifts).map((g) => {
      const ch = groupChange(g, cmp, o.gainUnit);
      return {
        name: MUSCLE_LABEL[g.group],
        value: g.volume > 0 ? `${fmtKg(g.volume)} kg` : `${g.sets} ${g.sets === 1 ? "set" : "sets"}`,
        gain: ch?.text ?? null,
        tone: ch?.up ? "good" : "muted",
      } satisfies Row;
    }).slice(0, max);
  }
  if (o.show === "top3") return top3Rows(d, o).slice(0, max);
  if (o.show === "every") return d.lifts.slice(0, max).map((l) => liftRow(l));
  const rows = winsSections(p, d, o).flatMap((s) => ("rows" in s ? s.rows : []));
  return (rows.length ? rows : d.lifts.map((l) => liftRow(l))).slice(0, max);
}

function weekFull(p: Pen, d: WeekCardData, o: DrawOptions) {
  kickerRow(p, "03 / WEEK", d.rangeLabel);
  let y = PAD_TOP + 13 + 30;
  const hs: TextStyle = { size: 64, weight: 800, face: "display", color: p.t.text, track: -0.05 };
  const lines = [`WEEK ${d.week}`, `${d.done} / ${d.planned}`];
  const size = fitSize(p, lines, hs, 64, 40, CONTENT_W);
  text(p, lines[0], PAD_X, bl(y, size, 0.88), { ...hs, size });
  y += size * 0.88;
  text(p, lines[1], PAD_X, bl(y, size, 0.88), { ...hs, size, color: p.t.good });
  y += size * 0.88;
  y += 10;
  text(p, d.summary, PAD_X, y + 12.5, { size: 13, weight: 500, color: p.t.sub });
  y += 17 + 18;
  y = strip(p, d.strip, PAD_X, CONTENT_W, y, 30);

  if (d.stats.length) {
    y += 22;
    const rows = Math.ceil(d.stats.length / 2);
    const h = 32 + rows * (12 + 26 * 1.25) + (rows - 1) * 14;
    if (p.t.panel) {
      const { ctx } = p;
      ctx.save();
      ctx.shadowColor = PAPER_PANEL_SHADOW;
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = p.t.panel;
      roundRect(ctx, PAD_X, y, CONTENT_W, h, 20);
      ctx.fill();
      ctx.restore();
    } else {
      hline(p, PAD_X, y, CONTENT_W, p.t.hairline);
    }
    // inset by the panel padding (16 top / 18 sides) on paper
    const inset = p.t.panel ? 18 : 0;
    statGridNarrow(p, d.stats, PAD_X + inset, CONTENT_W - inset * 2, y + (p.t.panel ? 16 : 18));
    y += h;
  }

  const rows = [...d.changes];
  if (o.showWeight && d.bodyWeight) rows.push({ name: "Body weight", value: d.bodyWeight });
  if (rows.length) {
    y += 16;
    for (const r of rows.slice(0, 4)) {
      if (y + 17 > FOOTER_TOP - 12) break;
      const vs: TextStyle = { size: 13, weight: 600, face: "display", color: p.t.text };
      const ns: TextStyle = { size: 13, weight: 500, color: p.t.text };
      const vw = measure(p, r.value, vs);
      text(p, r.value, W - PAD_X, y + 12.5, vs, "right");
      text(p, ellipsize(p, r.name, ns, CONTENT_W - vw - 12), PAD_X, y + 12.5, ns);
      y += 25;
    }
  }

  logo(p, PAD_X, FOOTER_TOP, 22);
  text(p, "BUILT FOR ONE", W - PAD_X, FOOTER_TOP + 15, { size: 10, weight: 700, color: p.t.muted, track: 0.12 }, "right");
}

// Stat grid inside the week panel (26px values, 14px gaps, narrower columns).
function statGridNarrow(p: Pen, stats: ShareStat[], left: number, width: number, top: number) {
  const colW = (width - 14) / 2;
  let y = top;
  for (let i = 0; i < stats.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const s = stats[i + c];
      if (!s) continue;
      const x = left + c * (colW + 14);
      text(p, s.label, x, y + 9, LABEL(p.t));
      const color = s.tone === "pr" ? p.t.pr : s.tone === "good" ? p.t.good : p.t.text;
      const vStyle: TextStyle = { size: 26, weight: 700, face: "display", color, track: -0.03 };
      const base = y + 12 + bl(0, 26, 1.25);
      const vw = text(p, ellipsize(p, s.value, vStyle, colW - 24), x, base, vStyle);
      if (s.unit) text(p, ` ${s.unit}`, x + vw, base, { size: 12, weight: 600, color: p.t.muted });
    }
    y += 12 + 26 * 1.25 + 14;
  }
}

function prFull(p: Pen, d: PrCardData) {
  kickerRow(p, "02 / PR", d.dateLabel);
  let y = PAD_TOP + 13 + 34;
  text(p, "NEW PR", PAD_X, y + 9, { ...LABEL(p.t, 10), color: p.t.good });
  y += 13 + 10;
  const ns: TextStyle = { size: 40, weight: 800, face: "display", color: p.t.text, track: -0.04 };
  // Long exercise names wrap onto a second line (and shrink) instead of "…".
  const name = fitHeadline(p, d.exercise.toUpperCase(), ns, {
    max: 40,
    min: 24,
    maxW: CONTENT_W,
    maxLines: 2,
    maxH: 2 * 40 * 0.95,
    lh: 0.95,
  });
  for (const l of name.lines) {
    text(p, l, PAD_X, bl(y, name.size, 0.95), { ...ns, size: name.size });
    y += name.size * 0.95;
  }
  y += 14;

  const bs: TextStyle = { size: 120, weight: 800, face: "display", color: p.t.text, track: -0.05 };
  const us: TextStyle = { size: 34, weight: 800, face: "display", color: p.t.accent, track: -0.02 };
  const unitW = d.unit ? measure(p, ` ${d.unit}`, us) : 0;
  const bsize = fitSize(p, [d.big], bs, 120, 56, CONTENT_W - unitW);
  const base = bl(y, bsize, 0.85);
  const bw = text(p, d.big, PAD_X, base, { ...bs, size: bsize });
  if (d.unit) text(p, ` ${d.unit}`, PAD_X + bw, base, us);
  y += bsize * 0.85 + 14;
  if (d.detail) {
    const s: TextStyle = { size: 14, weight: 500, color: p.t.sub };
    for (const l of wrap(p, d.detail, s, CONTENT_W, 2)) {
      text(p, l, PAD_X, y + 13.5, s);
      y += 19;
    }
  }
  if (d.stats.length) {
    y += 24;
    hline(p, PAD_X, y, CONTENT_W, p.t.hairline);
    statGrid(p, d.stats, y + 18, 26, 12);
  }
  logo(p, PAD_X, FOOTER_TOP, 22);
  pill(p, "PERSONAL BEST", W - PAD_X, FOOTER_TOP);
}

// ── Photo layout: everything sits at the bottom over a dark fade ───────────

type PhotoBlock = {
  kicker: string;
  big: string;
  bigUnit?: string;
  bigSize: number;
  wrapBig?: boolean; // session day label: wrap onto 2 lines instead of overflowing
  detail?: string | null;
  stripCells?: WeekCardData["strip"];
  rows?: { name: string; value: string; gain?: string | null; tone?: "good" | "muted" }[];
  note?: string | null;
  stats: ShareStat[];
};

function photoHeight(b: PhotoBlock, noteLines: number, bigLines: number): number {
  let h = 13 + 12 + b.bigSize * 0.85 * bigLines;
  if (b.detail) h += 12 + 18;
  if (b.stripCells) h += 12 + 22 + 14;
  if (b.rows?.length) h += 12 + b.rows.length * 22;
  if (noteLines) h += 12 + noteLines * 18;
  if (b.stats.length) h += 12 + 13 + 12 + 23;
  h += 16 + 20; // logo
  return h;
}

function photoLayout(p: Pen, b: PhotoBlock, o: DrawOptions) {
  const ns: TextStyle = { size: 13, weight: 500, color: p.t.sub };
  const noteLines = b.note ? wrap(p, `“${b.note}”`, ns, W - 48, 2) : [];
  const bs: TextStyle = { size: b.bigSize, weight: 800, face: "display", color: p.t.text, track: -0.05 };
  const us: TextStyle = { size: 26, weight: 800, face: "display", color: p.t.accent, track: -0.02 };
  const unitW = b.bigUnit ? measure(p, ` ${b.bigUnit}`, us) : 0;
  let bigSize: number;
  let bigLines: string[];
  if (b.wrapBig) {
    const fit = fitHeadline(p, b.big, bs, {
      max: b.bigSize,
      min: 30,
      maxW: W - 48 - unitW,
      maxLines: 3,
      maxH: 2 * b.bigSize * 0.85,
      lh: 0.85,
    });
    bigSize = fit.size;
    bigLines = fit.lines;
  } else {
    bigSize = fitSize(p, [b.big], bs, b.bigSize, 40, W - 48 - unitW);
    bigLines = [b.big];
  }
  const block = { ...b, bigSize };
  const total = photoHeight(block, noteLines.length, bigLines.length);
  const left = 24;
  const innerW = W - 48;
  let y = H - 26 - total;

  paintPhoto(p.ctx, o.photo, y);

  text(p, ellipsize(p, b.kicker, LABEL(p.t, 10), innerW), left, y + 9.5, LABEL(p.t, 10));
  y += 13 + 12;
  bigLines.forEach((l, i) => {
    const base = bl(y, bigSize, 0.85);
    const bw = text(p, l, left, base, { ...bs, size: bigSize });
    if (b.bigUnit && i === bigLines.length - 1) text(p, ` ${b.bigUnit}`, left + bw, base, us);
    y += bigSize * 0.85;
  });
  if (b.detail) {
    y += 12;
    const s: TextStyle = { size: 14, weight: 500, color: p.t.sub };
    text(p, ellipsize(p, b.detail, s, innerW), left, y + 13.5, s);
    y += 18;
  }
  if (b.stripCells) {
    y += 12;
    y = strip(p, b.stripCells, left, innerW, y, 22) - 2;
  }
  if (b.rows?.length) {
    y += 12;
    for (const r of b.rows) {
      const vs: TextStyle = { size: 13, weight: 600, face: "display", color: p.t.text };
      const rs: TextStyle = { size: 13, weight: 500, color: p.t.text };
      let right = W - left;
      if (r.gain) {
        right -= text(p, r.gain, right, y + 14, { ...vs, color: r.tone === "muted" ? p.t.muted : p.t.good }, "right");
        right -= measure(p, " ", vs);
      }
      const value = ellipsize(p, r.value, vs, Math.max(60, right - left - 110));
      const vw = text(p, value, right, y + 14, vs, "right");
      text(p, ellipsize(p, r.name, rs, right - vw - left - 12), left, y + 14, rs);
      y += 22;
    }
  }
  if (noteLines.length) {
    y += 12;
    for (const l of noteLines) {
      text(p, l, left, y + 12.5, ns);
      y += 18;
    }
  }
  if (b.stats.length) {
    y += 12;
    hline(p, left, y, innerW, p.t.hairline);
    y += 13;
    const cols = Math.min(4, b.stats.length);
    const colW = innerW / cols;
    const vSize = cols === 4 ? 16 : 18;
    b.stats.slice(0, cols).forEach((s, i) => {
      const x = left + i * colW;
      const ls: TextStyle = { size: 9, weight: 700, color: p.t.muted, track: 0.14 };
      const label = cols === 4 ? s.label.replace(/ AVG$/, "") : s.label;
      text(p, ellipsize(p, label, ls, colW - 6), x, y + 9, ls);
      const color = s.tone === "pr" ? p.t.pr : s.tone === "good" ? p.t.good : p.t.text;
      const vs: TextStyle = { size: vSize, weight: 700, face: "display", color };
      const v = s.unit ? `${s.value} ${s.unit}` : s.value;
      text(p, ellipsize(p, v, vs, colW - 6), x, y + 12 + 18.5, vs);
    });
    y += 12 + 23;
  }
  y += 16;
  logo(p, left, y, 20);
}

function sessionPhoto(p: Pen, d: SessionCardData, o: DrawOptions) {
  const dayWord = d.titleBottom ? d.titleTop.charAt(0) + d.titleTop.slice(1).toLowerCase() : null;
  const detail = [dayWord, d.week != null ? `Week ${d.week}` : null].filter(Boolean).join(" · ");
  photoLayout(
    p,
    {
      kicker: d.prNames.length
        ? `NEW PR · ${d.prNames[0].toUpperCase()} · ${d.shortDate}`
        : `SESSION · ${d.shortDate}`,
      big: d.titleBottom ?? d.titleTop,
      bigSize: 72,
      wrapBig: true,
      detail: detail || null,
      rows: photoRows(p, d, o, o.showNotes && d.note ? 2 : 3),
      note: o.showNotes ? d.note : null,
      stats: d.stats.slice(0, 3),
    },
    o
  );
}

function weekPhoto(p: Pen, d: WeekCardData, o: DrawOptions) {
  const rows = d.changes.slice(0, 2);
  if (o.showWeight && d.bodyWeight) rows.push({ name: "Body weight", value: d.bodyWeight });
  photoLayout(
    p,
    {
      kicker: `WEEK ${d.week} · ${d.rangeLabel}`,
      big: `${d.done}/${d.planned}`,
      bigUnit: "DONE",
      bigSize: 84,
      detail: d.summary,
      stripCells: d.strip,
      rows,
      stats: d.stats.slice(0, 4),
    },
    o
  );
}

function prPhoto(p: Pen, d: PrCardData, o: DrawOptions) {
  photoLayout(
    p,
    {
      kicker: `NEW PR · ${d.exercise.toUpperCase()}`,
      big: d.big,
      bigUnit: d.unit || undefined,
      bigSize: 84,
      detail: d.detail,
      stats: d.stats.slice(0, 3),
    },
    o
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function drawCard(ctx: Ctx, kind: CardKind, bundle: ShareBundle, o: DrawOptions): boolean {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.setTransform(CARD_UNIT, 0, 0, CARD_UNIT, 0, 0);
  const theme = o.background === "paper" ? PAPER : o.background === "photo" ? PHOTO : DARK;
  const p: Pen = { ctx, fonts: o.fonts, t: theme };
  let drawn = false;
  if (o.background === "dark") paintDark(ctx);
  else if (o.background === "paper") paintPaper(ctx);

  if (kind === "session" && bundle.session) {
    if (o.background === "photo") sessionPhoto(p, bundle.session, o);
    else sessionFull(p, bundle.session, o);
    drawn = true;
  } else if (kind === "week" && bundle.week) {
    if (o.background === "photo") weekPhoto(p, bundle.week, o);
    else weekFull(p, bundle.week, o);
    drawn = true;
  } else if (kind === "pr" && bundle.pr) {
    if (o.background === "photo") prPhoto(p, bundle.pr, o);
    else prFull(p, bundle.pr);
    drawn = true;
  }
  ctx.restore();
  return drawn;
}

export function cardToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}
