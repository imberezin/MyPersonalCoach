// Usage: npm run seed:demo -- --scenario day4-candidate
//        npm run seed:demo -- --explain
//        npm run seed:demo -- --scenario day3 --fresh
//        npm run seed:demo -- --clock-only --clock-shift "+25h"
//        npm run seed:demo -- --scenario w3-result-due --fresh      (Weekly Learning presets: w2-*, w3-*, w4-*)
//        npm run seed:demo -- --scenario w2-learn --exp done@9:helpful --exp active@16   (--exp may be repeated)
// Fills ONE throwaway user in the LOCAL Docker Supabase with a deterministic history, so every Home state, the First Week
// summary, the detector, the Early Signal card and the experiment flow can be exercised "as of day N". It refuses anything but
// the local stack and an @eating-coach.test user. Set the user's password in YOUR shell first (never as a flag):
//   PowerShell:  $env:SEED_USER_PASSWORD = "<at least 8 characters>"
//
// The vitest CLI rejects options it does not know, so the flags cannot simply follow `vitest run`. This wrapper only
// collects them into ONE environment variable (SEED_ARGS, JSON); the runner validates them (scripts/seed-demo/args.ts) before
// any call. The password is inherited from the shell and is never serialized into SEED_ARGS.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const flags = {};
// A flag given twice becomes a list of its values. The runner accepts that for --exp only and refuses it for every other flag.
const put = (name, value) => {
  flags[name] = name in flags ? [...(Array.isArray(flags[name]) ? flags[name] : [flags[name]]), value] : value;
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument "${arg}". Flags look like --scenario day3.`);
    process.exit(2);
  }
  const name = arg.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    put(name, true); // a flag with no value, such as --explain
  } else {
    put(name, next);
    i++;
  }
}

const child = spawn(
  process.execPath,
  [join(appRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--config", join("scripts", "seed-demo", "vitest.config.mts")],
  { cwd: appRoot, stdio: "inherit", env: { ...process.env, SEED_ARGS: JSON.stringify(flags), VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
