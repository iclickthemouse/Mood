/** @type {import('tailwindcss').Config} */

/* ------------------------------------------------------------------ *
 *  mood — "darkroom / gallery" monochrome theme
 *  A warm ink-on-paper palette. No chroma. Off-white paper surfaces,
 *  faded-black ink for type and primary actions, hairline sepia borders.
 *  The existing Tailwind color names are remapped to monotone scales so
 *  the whole UI inherits the theme without restructuring markup.
 * ------------------------------------------------------------------ */

// Warm neutral "paper → ink" ramp (replaces slate).
const paper = {
  50: "#F6F4EF",
  100: "#EDEAE2",
  200: "#E0DBD0",
  300: "#CDC7B9",
  400: "#A39C8D",
  500: "#7C7568",
  600: "#5E584D",
  700: "#46413A",
  800: "#2E2B26",
  900: "#1F1D1A",
  950: "#16140F",
};

// Faded-black "ink" ramp used for primary actions, focus and selection
// (replaces indigo). 600 is the signature faded black on buttons.
const ink = {
  50: "#EEEAE1",
  100: "#E3DDD0",
  200: "#D3CCBD",
  300: "#BBB2A0",
  400: "#6F6A5E",
  500: "#4A463E",
  600: "#262320",
  700: "#14120E",
  800: "#100E0B",
  900: "#0B0A08",
};

// Warm kraft / sepia for sticky notes — desaturated, stays in the family
// (replaces amber).
const kraft = {
  50: "#EFE9DB",
  100: "#E6DECB",
  200: "#DCD2B9",
  300: "#D2C6AC",
  400: "#C0B190",
  500: "#9A8E72",
  600: "#75694F",
  700: "#5C5240",
  800: "#463E2D",
};

// A single warm clay accent for destructive / error affordances. Low
// chroma so it reads as "dark warning" rather than candy red (replaces rose).
const clay = {
  50: "#EDE2DA",
  100: "#E3D2C7",
  500: "#9C5A45",
  600: "#8C4A38",
  700: "#723A2C",
};

export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // off-white paper instead of pure white; faded-black instead of #000
        white: "#FBFAF6",
        black: "#16140F",
        slate: paper,
        indigo: ink,
        amber: kraft,
        // image/icon hints and "ready" status collapse into the ink ramp
        sky: { 500: "#5E584D", 600: "#46413A" },
        emerald: { 500: "#5E584D", 600: "#46413A" },
        rose: clay,
      },
      fontFamily: {
        sans: [
          "'Hanken Grotesk'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        serif: ["'Fraunces'", "ui-serif", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgba(31, 29, 26, 0.06)",
        DEFAULT: "0 1px 3px 0 rgba(31, 29, 26, 0.10), 0 1px 2px -1px rgba(31, 29, 26, 0.08)",
        lg: "0 16px 40px -12px rgba(31, 29, 26, 0.28)",
        xl: "0 28px 64px -16px rgba(31, 29, 26, 0.34)",
      },
    },
  },
  plugins: [],
};
