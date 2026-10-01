import { readFileSync } from "node:fs";
import { createBakeOffConfig, APP_ROOT } from "./lib/config";

// Used only by `npm run bakeoff` (see cli.mjs). The provider keys are read from .env.local here, passed
// to the test process as environment, and never printed.
let envFileText: string | null = null;
try {
  envFileText = readFileSync(`${APP_ROOT}/.env.local`, "utf8");
} catch {
  // No .env.local: the keys may come from the real environment.
}

export default createBakeOffConfig(envFileText);
