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
        green: { DEFAULT: "var(--green)", soft: "var(--green-soft)" },
        ember: { DEFAULT: "var(--ember)", soft: "var(--ember-soft)" },
        amber: "var(--amber)",
        violet: "var(--violet)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        tile: "var(--radius-tile)",
        chip: "var(--radius-chip)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};
export default config;
