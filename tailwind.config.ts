import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "surface-base": "var(--surface-base)",
        "surface-raised": "var(--surface-raised)",
        "sidebar-bg": "var(--sidebar-bg)",
        "sidebar-deep": "var(--sidebar-deep)",
        accent: "var(--accent)",
        "text-primary": "var(--text-primary)",
        "text-body": "var(--text-body)",
        "text-muted": "var(--text-muted)",
        border: "var(--border)",
      },
      fontFamily: {
        display: ["var(--font-playfair)", "serif"],
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        none: "0",
      },
    },
  },
  plugins: [],
  corePlugins: {
    // Disable shadow utilities — design system forbids shadows
  },
};

export default config;
