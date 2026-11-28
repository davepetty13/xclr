import type { MetadataRoute } from "next";

// Web-app manifest. iPhone only allows notifications for a web app that was
// added to the Home Screen and runs standalone (iOS 16.4+).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Xclr",
    short_name: "Xclr",
    description: "Personal health & wellness with an AI coach at its core.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
