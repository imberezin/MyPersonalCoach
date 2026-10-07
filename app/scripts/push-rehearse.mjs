// Usage: npm run push:rehearse                     DRY RUN: shows what it would send, sends nothing
//        npm run push:rehearse -- --yes            sends ONE real push to your phone (the only subscription in the table)
//        npm run push:rehearse -- --yes --user-id <uuid>
// The device check of the weekly summary push, run by the OWNER, once, before there is an automatic sender (TODO.md section 4,
// step 6). It reads the hosted push subscriptions with the server key from app/.env.local and sends the approved weekly message
// through the real provider. It WRITES NOTHING (no database row, no log, no deletion) and prints only counts, the push service
// host and result codes.
//
// What to look at on the phone: a visible notification in Hebrew, right to left, with no digit; a tap while the app is closed
// and a tap while it is in the background must open /week inside the installed app (/week sends you to Home when no week is
// ready, which is correct).
//
// The vitest CLI rejects options it does not know, so the flags cannot simply follow `vitest run`. This wrapper only collects
// them into ONE environment variable (REHEARSE_ARGS, JSON); the runner validates them (scripts/push-rehearse/rehearse.ts).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument "${arg}". The flags are --yes and --user-id <uuid>.`);
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
  [join(appRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--config", join("scripts", "push-rehearse", "vitest.config.mts")],
  { cwd: appRoot, stdio: "inherit", env: { ...process.env, REHEARSE_ARGS: JSON.stringify(flags), VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
