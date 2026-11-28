import type { Metadata } from "next";
import { Sora, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// v3: Sora for big numbers + headings (Dave's pick, option E), Hanken Grotesk
// for everything else. Sora is exposed as both --font-display and the legacy
// --font-serif, so existing `font-serif` classes switch over automatically.
const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"], // 800: share-card headlines (v3.8)
  variable: "--font-display",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://xclr.vercel.app"),
  title: "Xclr",
  description: "Personal health & wellness with an AI coach at its core.",
  // Link previews (the poster itself is app/opengraph-image.tsx).
  openGraph: {
    title: "Xclr — your AI health coach",
    description: "Train smarter. Eat on track. Food, training and your Watch in one place — invite only.",
    siteName: "Xclr",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Xclr — your AI health coach",
    description: "Train smarter. Eat on track. Food, training and your Watch in one place — invite only.",
  },
  // Home Screen web app (needed for iPhone notifications, iOS 16.4+).
  appleWebApp: { capable: true, title: "Xclr", statusBarStyle: "default" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${hanken.variable} font-sans`}>
        {children}
      </body>
    </html>
  );
}
