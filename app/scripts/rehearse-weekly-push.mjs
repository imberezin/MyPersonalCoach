// Usage: npm run rehearse:weekly-push                       (the fake push service answers "ok")
//        npm run rehearse:weekly-push -- --behavior gone     (gone | rejected | retryable)
// The local, end-to-end rehearsal of the weekly summary push: the real route, the real store and the real Postgres of the LOCAL Docker
// stack, the dev clock and the fake provider. It needs, running, in this order:
//   1. the local stack:   npm run local:start
//   2. a seeded Sunday:   $env:SEED_USER_PASSWORD = "<8+ characters>"; npm run seed:demo -- --scenario w2-learn --fresh
//   3. the dev server, with sending on and the fake provider (use ANOTHER port than 3000):
//        $env:NOTIFY_SENDER_LIVE = "1"; $env:PUSH_PROVIDER = "fake"; $env:PUSH_FAKE_BEHAVIOR = "ok"; npx next dev -p 3010
// It never touches the hosted project: it refuses any Supabase that is not on this machine, any user that is not @eating-coach.test, and any
// dev server that is not on this machine. Run it once per --behavior, restarting the dev server with the matching PUSH_FAKE_BEHAVIOR.
//
// The vitest CLI rejects options it does not know, so the flags cannot simply follow `vitest run`. This wrapper only collects them into ONE
// environment variable (REHEARSE_WEEKLY_ARGS, JSON); the runner validates them (scripts/rehearse-weekly-push/guards.ts).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument "${arg}". The flags are --behavior, --base-url and --email.`);
    process.exit(2);
  }
  const name = arg.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    flags[name] = true;
  } else {
    flags[name] = next;
    i++;
  }
}

const child = spawn(
  process.execPath,
  [join(appRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--config", join("scripts", "rehearse-weekly-push", "vitest.config.mts")],
  { cwd: appRoot, stdio: "inherit", env: { ...process.env, REHEARSE_WEEKLY_ARGS: JSON.stringify(flags), VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
