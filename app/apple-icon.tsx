import { ImageResponse } from "next/og";

// Home-screen icon for iPhone ("Add to Home Screen"). Same mark as app/icon.svg.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16211B",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 64 64">
          <path d="M14 14 L50 50" stroke="#6FCF97" strokeWidth="11" strokeLinecap="round" />
          <path d="M50 14 L14 50" stroke="#E0603A" strokeWidth="11" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size
  );
}
