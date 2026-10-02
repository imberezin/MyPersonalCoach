import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\/]$/, "");

// Used only by `npm run seed:demo` (see scripts/seed-demo.mjs). A SEPARATE config from the main one, so `npm test` never
// runs the live file. It reproduces what the main config provides, because the runner imports the app's own code: the `@`
// alias and the `server-only` stub, written exactly as there.
//
// - Only run.live.ts is included.
// - The limits are explicit: a run does Auth calls, inserts and loaders, and the 5 s default of vitest is far too short
//   (the root config's 30 s is for unit tests).
// - envDir is off: no environment file is read by this runner (the stack's values come from `supabase status`, the password
//   from the tester's shell). The dev server's own local environment file, with the real AI keys, stays closed.
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
    include: ["scripts/seed-demo/run.live.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
