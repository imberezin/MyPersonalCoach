// Runs both dev servers in one terminal, with a prefix on every line:
//   [local]  http://localhost:3000  against the local Supabase (Docker; start it first with `npm run local:start`)
//   [hosted] http://localhost:3001  against the hosted project
// Usage: npm run dev:both        Stop both with Ctrl+C.
import { spawn } from "node:child_process";
import { HOSTED_PORT, hostedEnvironment } from "./hosted-env.mjs";

const hosted = hostedEnvironment();
const children = [];

function start(label, port, extraEnv) {
  const child = spawn("npx", ["next", "dev", "-p", port], { shell: true, env: { ...process.env, ...extraEnv } });
  const prefix = `[${label}] `;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.on("data", (chunk) => {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") console.log(prefix + line);
    });
  }
  child.on("exit", (code) => {
    console.log(`${prefix}stopped (exit code ${code ?? 0})`);
    for (const other of children) other.kill();
    process.exit(code ?? 0);
  });
  children.push(child);
}

console.log(`[local]  http://localhost:3000  (local Supabase)`);
console.log(`[hosted] http://localhost:${HOSTED_PORT}  (hosted project ${new URL(hosted.NEXT_PUBLIC_SUPABASE_URL).host})`);
start("local", "3000", {});
start("hosted", HOSTED_PORT, hosted);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => children.forEach((child) => child.kill(signal)));
