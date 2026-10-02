import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { parseSeedArgs } from "./args";
import { createRealDeps } from "./db";
import { runSeed } from "./run";

// The live runner. It is a "test" only because vitest is the one runner that can import the app's TypeScript (see
// vitest.config.mts). `npm test` never includes it; `npm run seed:demo -- <flags>` does. It runs ONLY against the local
// Docker stack and only for an @eating-coach.test user (guard.ts), and it prints counts, instants and short codes: never the
// password, a key or a user id. The two environment variables it reads are SEED_ARGS (the flags) and SEED_USER_PASSWORD
// (the tester's shell); it opens no environment file.
it("seed-demo", async () => {
  const parsed = parseSeedArgs(process.env.SEED_ARGS);
  if (!parsed.ok) throw new Error(parsed.error);

  const appRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
  const result = await runSeed(
    parsed.value,
    createRealDeps({ appRoot, password: process.env.SEED_USER_PASSWORD, log: (line) => console.log(line) }),
  );
  if (!result.ok) throw new Error(`seed-demo stopped: ${result.code}`);
});
