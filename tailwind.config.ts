import type { Config } from "tailwindcss";

// Theme maps to the CSS custom-property tokens in app/globals.css.
// Never add raw hex here or in components (Spec §13).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        line: "var(--line)",
        hairline: "var(--hairline)",
        field: "var(--field)",
        segment: "var(--segment)",
        green: { DEFAULT: "var(--green)", soft: "var(--green-soft)", "on-dark": "var(--green-on-dark)" },
        ember: {
          DEFAULT: "var(--ember)",
          soft: "var(--ember-soft)",
          text: "var(--ember-text)",
          "on-dark": "var(--ember-on-dark)",
        },
        amber: { DEFAULT: "var(--amber)", soft: "var(--amber-soft)", text: "var(--amber-text)" },
        violet: "var(--violet)",
        "control-border": "var(--control-border)",
        scrim: "var(--scrim)",
        band: {
          text: "var(--band-text)",
          secondary: "var(--band-secondary)",
          label: "var(--band-label)",
          hairline: "var(--band-hairline)",
          track: "var(--band-track)",
        },
      },
      fontFamily: {
        // v3: Sora. `serif` kept as an alias so older classes still render Sora.
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        serif: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        band: "var(--radius-band)",
        tile: "var(--radius-tile)",
        chip: "var(--radius-chip)",
        control: "var(--radius-control)",
        mark: "var(--radius-mark)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
    },
  },
  plugins: [],
};
export default config;
