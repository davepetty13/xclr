import { ImageResponse } from "next/og";

// Link-preview poster (Messenger, Viber, iMessage, Facebook, X). Design: the
// "A · Dark editorial" mock, matching the share cards. Next.js adds the
// og:image / twitter:image tags for every page automatically.
// Colours are literal here (an image route can't read CSS variables), the same
// exception as app/apple-icon.tsx and lib/share-card-theme.ts.
export const alt = "Xclr — Train smarter. Eat on track.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

// Sora from Google Fonts as TTF (Satori can't read woff2). If the fetch fails
// the poster still renders in the default sans font.
async function sora(weight: 700 | 800): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Sora:wght@${weight}&display=swap`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Xclr-OG/1.0)" },
      })
    ).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [bold, black] = await Promise.all([sora(700), sora(800)]);
  const fonts = [
    ...(bold ? [{ name: "Sora", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(black ? [{ name: "Sora", data: black, weight: 800 as const, style: "normal" as const }] : []),
  ];
  const display = fonts.length ? "Sora" : "sans-serif";

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
          fontFamily: display,
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
          <div style={{ display: "flex", fontSize: 30, color: "#C9CCC6", maxWidth: 780, lineHeight: 1.3 }}>
            Your AI coach for food, training and your Watch — built for Filipino plates.
          </div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: "0.14em", color: "#9AA49C" }}>
            INVITE ONLY
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}
