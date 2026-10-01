import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 locks the build folder, so two dev servers can only run side by side with a folder each.
  // `npm run dev:hosted` sets NEXT_DIST_DIR=.next-hosted; every other run (and every build) uses .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev only: lets the dev server (hot reload) be opened through 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The app uses the camera (food photos) and the microphone (voice) on its own origin only.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
      {
        // The service worker must never be cached, or push handling goes stale.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
