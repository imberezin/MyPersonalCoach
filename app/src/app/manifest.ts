import type { MetadataRoute } from "next";

// Static manifest. The app is Hebrew-first; the visible name comes from the translations
// at runtime, so this one only needs to be stable.
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
    background_color: "#fbfaf8",
    theme_color: "#fbfaf8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
