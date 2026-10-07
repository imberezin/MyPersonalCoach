import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\/]$/, "");

// Used only by `npm run push:rehearse` (see scripts/push-rehearse.mjs). A SEPARATE config from the main one, so `npm test` never
// runs the live file. It reproduces what the main config provides, because the runner imports the app's own code: the `@` alias
// and the `server-only` stub, written exactly as there. envDir is off: the runner reads the two environment files itself and
// prints no value from them.
export default defineConfig({
  root,
  envDir: false,
  resolve: {
    alias: {
      "@": `${root}/src`,
      "server-only": `${root}/tests/stubs/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["scripts/push-rehearse/run.live.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
