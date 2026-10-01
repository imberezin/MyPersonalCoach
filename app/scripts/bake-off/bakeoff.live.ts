import path from "node:path";
import { it } from "vitest";
import { parseBakeOffArgs } from "./lib/args";
import { APP_ROOT } from "./lib/config";
import { runBakeOff } from "./lib/run";

// The live runner. It is a "test" only because vitest is the one runner that can import the app's
// TypeScript (see lib/config.ts). `npm test` never includes it; `npm run bakeoff -- <flags>` does.
// It prints progress lines and the summary location. It never prints a key, a prompt or a photo.
it("bake-off", async () => {
  const parsed = parseBakeOffArgs(process.env.BAKEOFF_ARGS);
  if (!parsed.ok) throw new Error(parsed.error);

  const run = await runBakeOff(parsed.value, {
    rootDir: APP_ROOT,
    env: process.env,
    log: (line) => console.log(line),
  });
  const s = run.summary;
  console.log(`Passed ${s.final.passed} of ${s.final.total} (text ${s.byModality.text.passed}/${s.byModality.text.total}, photos ${s.byModality.photo.passed}/${s.byModality.photo.total}).`);
  console.log(`Summary: ${path.relative(APP_ROOT, path.join(run.outputDir, "summary.md"))}`);
});
