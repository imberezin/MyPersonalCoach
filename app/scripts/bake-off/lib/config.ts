import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadBakeOffEnv } from "./env";

/** The app folder (this file is scripts/bake-off/lib/config.ts). */
export const APP_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]$/, "");

/**
 * The vitest configuration of the bake-off, a SEPARATE config from the main one (so `npm test` never
 * runs the live file). It reproduces what the main config provides, because the runner imports the
 * real adapters and factory: the `@` alias and the `server-only` stub, written exactly as there.
 *
 * - No time limits: a run is dozens of sequential calls with 6 to 25 s delays.
 * - Only `bakeoff.live.ts` is included.
 * - The environment comes from the text of `.env.local` (read by `vitest.config.mts`, never here, so
 *   importing this module in a test reads no secrets). Only GEMINI_* and GROQ_* are kept.
 */
export function createBakeOffConfig(envFileText: string | null, processEnv: Record<string, string | undefined> = process.env, root: string = APP_ROOT) {
  return defineConfig({
    root,
    resolve: {
      alias: {
        "@": `${root}/src`,
        "server-only": `${root}/tests/stubs/server-only.ts`,
      },
    },
    test: {
      environment: "node",
      include: ["scripts/bake-off/bakeoff.live.ts"],
      testTimeout: 0,
      hookTimeout: 0,
      env: loadBakeOffEnv(envFileText, processEnv),
    },
  });
}
