// The environment that points the app at the HOSTED Supabase project, shared by dev-hosted.mjs and dev-both.mjs.
// The values are the names that end in _1 in app/.env.local. They are passed to Next as process environment
// variables, which win over the .env files, so nothing is written to disk.
import { readFileSync } from "node:fs";

/** The hosted dev server listens here; `npm run dev` (local Supabase) keeps 3000. */
export const HOSTED_PORT = "3001";

/** Exits with a message when a hosted value is missing from .env.local. */
export function hostedEnvironment() {
  const env = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }

  const hosted = {
    NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_PROJECT_URL_1,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY_1,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY_1,
    // Next 16 locks the build folder, so the second dev server needs a folder of its own.
    NEXT_DIST_DIR: ".next-hosted",
  };
  const missing = Object.entries(hosted).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    console.error(`Missing hosted values in .env.local (${missing.join(", ")}). See SETUP-CHECKLIST.md.`);
    process.exit(1);
  }
  return hosted;
}
