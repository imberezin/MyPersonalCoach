// Usage: npm run bakeoff -- --provider gemini --model gemini-3.1-flash-lite --set text
//        npm run bakeoff -- --dry-run          (fake provider, no network)
// Flags: --provider gemini|groq  --model <id>  --set text|photo|all  --prompt he|en
//        --format json_object|json_schema (Groq)  --limit N  --delay-ms N  --dry-run
//
// The vitest CLI rejects options it does not know, so the flags cannot simply follow `vitest run`.
// This wrapper only collects them into ONE environment variable (BAKEOFF_ARGS, JSON); the test process
// validates them with parseBakeOffArgs before any call. Unknown flags are passed on and rejected there.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument "${arg}". Flags look like --provider gemini.`);
    process.exit(2);
  }
  const name = arg.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    flags[name] = true; // a flag with no value, such as --dry-run
  } else {
    flags[name] = next;
    i++;
  }
}

const child = spawn(
  process.execPath,
  [join(appRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--config", join("scripts", "bake-off", "vitest.config.mts")],
  { cwd: appRoot, stdio: "inherit", env: { ...process.env, BAKEOFF_ARGS: JSON.stringify(flags), VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
