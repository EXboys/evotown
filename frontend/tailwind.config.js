/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Noto Serif SC", "serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        evo: {
          bg: "#0f172a",
          panel: "#1e293b",
          border: "#334155",
          accent: "#38bdf8",
          gold: "#fbbf24",
        },
      },
      boxShadow: {
        "evo-panel": "0 4px 24px -4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
        "evo-glow": "0 0 20px -4px rgba(56, 189, 248, 0.3)",
      },
    },
  },
  plugins: [],
};
