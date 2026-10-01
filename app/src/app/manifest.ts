import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/styles/brandColors";

// Static manifest. The app is Hebrew-first; the visible name comes from the translations
// at runtime, so this one only needs to be stable. The color is --color-background from
// src/styles/tokens.css, and the icons are generated from the logo by `npm run icons`.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Eating Coach",
    short_name: "Eating Coach",
    description: "בוא נבין יחד איך אתה אוכל",
    lang: "he",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
