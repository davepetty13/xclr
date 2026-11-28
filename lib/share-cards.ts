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

export type SessionCardData = {
  dateLabel: string; // "THU · 26 NOV 2026"
  shortDate: string; // "THU 26 NOV"
  titleTop: string; // "DAY 4"
  titleBottom: string | null; // "PUSH"
  subline: string | null; // "Week 3 · Upper / Lower"
  week: number | null;
  stats: ShareStat[]; // VOLUME / SETS / AVG RPE — only the ones with data
  topSets: { name: string; value: string }[]; // "62.5 kg × 8"
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
      const vStyle: TextStyle = { size: valueSize, weight: 700, face: "display", color, track: -0.03 };
      const base = y + 12 + bl(0, valueSize, 1.25);
      const vw = text(p, ellipsize(p, s.value, vStyle, colW - 30), x, base, vStyle);
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
  const str = ellipsize(p, label, s, 190);
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

function sessionFull(p: Pen, d: SessionCardData, o: DrawOptions) {
  kickerRow(p, "01 / SESSION", d.dateLabel);
  let y = PAD_TOP + 13 + 34;
  const lines = [d.titleTop, d.titleBottom].filter((l): l is string => !!l);
  const hs: TextStyle = { size: 76, weight: 800, face: "display", color: p.t.text, track: -0.05 };
  const size = fitSize(p, lines, hs, 76, 40, CONTENT_W);
  lines.forEach((l, i) => {
    const s = { ...hs, size, color: i === 1 ? p.t.accent : p.t.text };
    text(p, ellipsize(p, l, s, CONTENT_W), PAD_X, bl(y, size, 0.86), s);
    y += size * 0.86;
  });
  if (d.subline) {
    y += 12;
    const s: TextStyle = { size: 12, weight: 500, color: p.t.sub, track: 0.04 };
    text(p, ellipsize(p, d.subline, s, CONTENT_W), PAD_X, y + 11.4, s);
    y += 15;
  }
  if (d.stats.length) {
    y += 26;
    hline(p, PAD_X, y, CONTENT_W, p.t.hairline);
    y = statGrid(p, d.stats, y + 18, 30, 13);
  }

  const showNote = o.showNotes && !!d.note;
  const limit = FOOTER_TOP - 12 - (showNote ? 16 + 21 + 18 * 2 : 0);
  if (d.topSets.length) {
    y += 24;
    const rowsTop = y + 12 + 9;
    const pitch = 35;
    const fit = Math.max(showNote ? 2 : 1, Math.floor((limit - rowsTop + 9) / pitch));
    const rows = d.topSets.slice(0, Math.min(fit, 6));
    text(p, "TOP SETS", PAD_X, y + 9, LABEL(p.t));
    y = rowsTop;
    rows.forEach((r, i) => {
      const vs: TextStyle = { size: 13, weight: 600, face: "display", color: p.t.text };
      const ns: TextStyle = { size: 13, weight: 500, color: p.t.text };
      const vw = measure(p, r.value, vs);
      text(p, r.value, W - PAD_X, y + 12.5, vs, "right");
      text(p, ellipsize(p, r.name, ns, CONTENT_W - vw - 12), PAD_X, y + 12.5, ns);
      if (i < rows.length - 1) hline(p, PAD_X, y + 25, CONTENT_W, p.t.rowLine);
      y += pitch;
    });
    y -= 9;
  }
  if (showNote && d.note) noteBlock(p, d.note, y + 16, 2);

  logo(p, PAD_X, FOOTER_TOP, 22);
  if (d.prNames.length)
    pill(p, `NEW PR · ${d.prNames.length > 1 ? `${d.prNames.length} LIFTS` : d.prNames[0].toUpperCase()}`, W - PAD_X, FOOTER_TOP);
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
  const name = d.exercise.toUpperCase();
  const nsize = fitSize(p, [name], ns, 40, 24, CONTENT_W);
  text(p, ellipsize(p, name, { ...ns, size: nsize }, CONTENT_W), PAD_X, bl(y, nsize, 0.95), { ...ns, size: nsize });
  y += nsize * 0.95 + 14;

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
  detail?: string | null;
  stripCells?: WeekCardData["strip"];
  rows?: { name: string; value: string }[];
  note?: string | null;
  stats: ShareStat[];
};

function photoHeight(b: PhotoBlock, noteLines: number): number {
  let h = 13 + 12 + b.bigSize * 0.85;
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
  const bigSize = fitSize(p, [b.big], bs, b.bigSize, 40, W - 48 - unitW);
  const block = { ...b, bigSize };
  const total = photoHeight(block, noteLines.length);
  const left = 24;
  const innerW = W - 48;
  let y = H - 26 - total;

  paintPhoto(p.ctx, o.photo, y);

  text(p, ellipsize(p, b.kicker, LABEL(p.t, 10), innerW), left, y + 9.5, LABEL(p.t, 10));
  y += 13 + 12;
  const base = bl(y, bigSize, 0.85);
  const bw = text(p, b.big, left, base, { ...bs, size: bigSize });
  if (b.bigUnit) text(p, ` ${b.bigUnit}`, left + bw, base, us);
  y += bigSize * 0.85;
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
      const vw = measure(p, r.value, vs);
      text(p, r.value, W - left, y + 14, vs, "right");
      text(p, ellipsize(p, r.name, rs, innerW - vw - 12), left, y + 14, rs);
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
      detail: detail || null,
      rows: d.topSets.slice(0, o.showNotes && d.note ? 2 : 3),
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
