import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\/]$/, "");

// Used only by `npm run rehearse:weekly-push` (see scripts/rehearse-weekly-push.mjs). A SEPARATE config from the main one, so `npm test`
// never runs the live file. It reproduces what the main config provides, because the runner imports the app's own code: the `@` alias and
// the `server-only` stub, written exactly as there. envDir is off: the runner reads CRON_SECRET from app/.env.local itself and prints
// nothing from it.
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
    include: ["scripts/rehearse-weekly-push/run.live.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
