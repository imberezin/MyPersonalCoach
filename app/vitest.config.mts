import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}src`,
      // `server-only` throws outside a React Server Components build; in unit tests it is a no-op.
      "server-only": `${root}tests/stubs/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Each PGlite suite boots a Postgres and applies every migration; with several starting at once the default 10 s is too tight.
    hookTimeout: 60_000,
  },
});
