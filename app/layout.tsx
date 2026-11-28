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
  title: "Xclr",
  description: "Personal health & wellness with an AI coach at its core.",
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
