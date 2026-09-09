import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-raised": "rgb(var(--ink-raised) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        // The sheet the interface is printed on.
        stock: "rgb(var(--stock) / <alpha-value>)",
        "stock-shade": "rgb(var(--stock-shade) / <alpha-value>)",
        // A real type-colour ramp, so hierarchy stops being opacity guesswork.
        type: {
          strong: "rgb(var(--type-strong) / <alpha-value>)",
          body: "rgb(var(--type-body) / <alpha-value>)",
          muted: "rgb(var(--type-muted) / <alpha-value>)",
          faint: "rgb(var(--type-faint) / <alpha-value>)",
        },
        marigold: "rgb(var(--marigold) / <alpha-value>)",
        "marigold-deep": "rgb(var(--marigold-deep) / <alpha-value>)",
        "marigold-lift": "rgb(var(--marigold-lift) / <alpha-value>)",
        "sage-ink": "rgb(var(--sage) / <alpha-value>)",
        "sage-lift": "rgb(var(--sage-lift) / <alpha-value>)",
        rust: "rgb(var(--rust) / <alpha-value>)",
        // Muted, warm sage scale — replaces the generic SaaS emerald.
        sage: {
          100: "#e8efe1",
          200: "#cfe0c2",
          300: "#aecb9b",
          400: "#8eb27a",
          500: "#74a05e",
          600: "#5c8649",
        },
      },
      maxWidth: {
        measure: "var(--measure)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.9s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
