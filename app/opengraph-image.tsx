import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Link-preview poster (Messenger, Viber, iMessage, Facebook, X). Design: the
// "A · Dark editorial" mock, matching the share cards. Next.js adds the
// og:image / twitter:image tags for every page automatically.
// Colours are literal here (an image route can't read CSS variables), the same
// exception as app/apple-icon.tsx and lib/share-card-theme.ts.
export const alt = "Xclr — Train smarter. Eat on track.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Fonts ship with the app (app/og-fonts, SIL Open Font License), so the
// poster always uses Sora + Hanken Grotesk like the app — no download at
// render time, no fallback font.
// Node runtime reading the files from disk; next.config.mjs makes sure Vercel
// ships app/og-fonts with this route.
const font = (file: string) => readFile(join(process.cwd(), "app", "og-fonts", file));

export default async function OpengraphImage() {
  const [bold, black, body] = await Promise.all([
    font("sora-latin-700-normal.woff"),
    font("sora-latin-800-normal.woff"),
    font("hanken-grotesk-latin-400-normal.woff"),
  ]);
  const fonts = [
    { name: "Sora", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Sora", data: black, weight: 800 as const, style: "normal" as const },
    { name: "Hanken Grotesk", data: body, weight: 400 as const, style: "normal" as const },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: "#0B0B0C",
          color: "#F4F1EA",
          padding: "64px 72px",
          fontFamily: "Sora",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -160,
            top: -120,
            width: 720,
            height: 720,
            display: "flex",
            backgroundImage: "radial-gradient(closest-side, rgba(224,96,58,0.30), rgba(224,96,58,0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -200,
            bottom: -260,
            width: 700,
            height: 700,
            display: "flex",
            backgroundImage: "radial-gradient(closest-side, rgba(111,207,151,0.18), rgba(111,207,151,0))",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="15" fill="#1A2720" />
            <path d="M19 18 L45 46" stroke="#6FCF97" strokeWidth="9" strokeLinecap="round" />
            <path d="M45 18 L19 46" stroke="#E0603A" strokeWidth="9" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "0.28em" }}>XCLR</span>
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            fontSize: 104,
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: "-0.045em",
          }}
        >
          <span>Train smarter.</span>
          <span style={{ color: "#E0603A" }}>Eat on track.</span>
        </div>
        <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Hanken Grotesk",
              fontSize: 30,
              color: "#C9CCC6",
              maxWidth: 780,
              lineHeight: 1.3,
            }}
          >
            Your AI coach for food, training and your Watch — built for Filipino plates.
          </div>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 700, letterSpacing: "0.14em", color: "#9AA49C" }}>
            INVITE ONLY
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
