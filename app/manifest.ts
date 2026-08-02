import type { MetadataRoute } from "next";

/**
 * Web app manifest. Served at /manifest.webmanifest and linked automatically.
 *
 * iOS note: Safari mostly ignores this file for "Add to Home Screen" — it uses
 * the apple-touch-icon (app/apple-icon.png) and the apple-mobile-web-app-*
 * meta tags set in app/layout.tsx. The manifest is what Android/Chrome and
 * desktop PWA installs read.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Resuitme — honest résumé tailoring",
    short_name: "Resuitme",
    description:
      "Tailor your LaTeX résumé to any job description — honestly. Rate your fit, then generate a one-page tailored rewrite.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#100e0c",
    theme_color: "#100e0c",
    categories: ["productivity", "business", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
