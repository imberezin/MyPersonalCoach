// Runs the dev server against the HOSTED Supabase project instead of the local Docker one.
// Usage: npm run dev:hosted   (http://localhost:3001)
//
// It runs next to `npm run dev` (http://localhost:3000, local Supabase): the two use different ports and
// different build folders (.next and .next-hosted), because Next 16 locks the build folder.
import { spawn } from "node:child_process";
import { HOSTED_PORT, hostedEnvironment } from "./hosted-env.mjs";

const hosted = hostedEnvironment();
console.log(`Dev server against the HOSTED project (${new URL(hosted.NEXT_PUBLIC_SUPABASE_URL).host}) on http://localhost:${HOSTED_PORT}`);
console.log("The real data of your hosted account is read and written. The local test accounts do not exist there.");

const child = spawn("npx", ["next", "dev", "-p", HOSTED_PORT], { stdio: "inherit", shell: true, env: { ...process.env, ...hosted } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
