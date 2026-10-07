import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { parseRehearseWeeklyArgs } from "./guards";
import { runRehearsal } from "./rehearse";
import { createRealWorld } from "./world";

// vitest does not show the console output of a test that passes, so the lines go straight to the terminal.
const write = (line: string) => process.stdout.write(line + "\n");

// The live runner of `npm run rehearse:weekly-push` (see scripts/rehearse-weekly-push.mjs). It is a "test" only because vitest is the one
// runner that can import the app's TypeScript (vitest.config.mts); `npm test` never includes it. It runs ONLY against the local Docker
// stack and one throwaway @eating-coach.test user, and prints counts and short phrases: never a key, a user id or an endpoint.
it(
  "rehearse-weekly-push",
  async () => {
    const parsed = parseRehearseWeeklyArgs(process.env.REHEARSE_WEEKLY_ARGS);
    if (!parsed.ok) throw new Error(parsed.error);

    const appRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
    const real = await createRealWorld({ appRoot, baseUrl: parsed.value.baseUrl, email: parsed.value.email });
    if ("error" in real) throw new Error(real.error);

    write(`Rehearsing the weekly push against ${parsed.value.baseUrl} (the dev server must run with NOTIFY_SENDER_LIVE=1 PUSH_PROVIDER=fake PUSH_FAKE_BEHAVIOR=${parsed.value.behavior}).`);
    let checks;
    try {
      checks = await runRehearsal(real.world, parsed.value.behavior, (line) => write(line));
    } finally {
      real.restore();
    }
    const failed = checks.filter((c) => !c.ok);
    write(`${checks.length - failed.length} of ${checks.length} checks passed.`);
    if (failed.length > 0) throw new Error(`The rehearsal found ${failed.length} problem(s): ${failed.map((c) => c.step).join("; ")}`);
  },
  300_000,
);
