import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT, createBakeOffConfig } from "../../scripts/bake-off/lib/config";

describe("bake-off vitest configuration", () => {
  const config = createBakeOffConfig(null, {});

  it("reproduces the aliases of the main config, and both point at files that exist", () => {
    const alias = config.resolve?.alias as Record<string, string>;
    expect(Object.keys(alias).sort()).toEqual(["@", "server-only"]);
    expect(alias["@"]).toBe(`${APP_ROOT}/src`);
    expect(existsSync(alias["@"])).toBe(true);
    expect(existsSync(alias["server-only"])).toBe(true);

    const main = readFileSync(path.join(APP_ROOT, "vitest.config.mts"), "utf8");
    expect(main).toContain('"@": `${root}src`');
    expect(main).toContain('"server-only": `${root}tests/stubs/server-only.ts`');
  });

  it("has no time limit (a run is dozens of sequential calls with long delays)", () => {
    expect(config.test?.testTimeout).toBe(0);
    expect(config.test?.hookTimeout).toBe(0);
  });

  it("includes exactly the live file, which the main config's globs do not match", () => {
    expect(config.test?.include).toEqual(["scripts/bake-off/bakeoff.live.ts"]);
    expect(existsSync(path.join(APP_ROOT, "scripts/bake-off/bakeoff.live.ts"))).toBe(true);
    const main = readFileSync(path.join(APP_ROOT, "vitest.config.mts"), "utf8");
    expect(main).toContain('include: ["src/**/*.test.ts", "tests/**/*.test.ts"]');
    expect("scripts/bake-off/bakeoff.live.ts").not.toMatch(/\.test\.ts$/);
  });

  it("passes only GEMINI_ and GROQ_ variables to the test process", () => {
    const withKeys = createBakeOffConfig("GEMINI_API_KEY=k1\nSUPABASE_SECRET_KEY=nope", { GROQ_API_KEY: "k2", PATH: "x" });
    expect(withKeys.test?.env).toEqual({ GEMINI_API_KEY: "k1", GROQ_API_KEY: "k2" });
  });

  it("the real config file reads .env.local itself, so importing the library reads no secrets", () => {
    const real = readFileSync(path.join(APP_ROOT, "scripts/bake-off/vitest.config.mts"), "utf8");
    expect(real).toContain(".env.local");
    expect(real).toContain("createBakeOffConfig(envFileText)");
    expect(readFileSync(path.join(APP_ROOT, "scripts/bake-off/lib/config.ts"), "utf8")).not.toContain("readFileSync");
  });
});

describe("npm run bakeoff", () => {
  it("is one script that runs the wrapper", () => {
    const pkg = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.bakeoff).toBe("node scripts/bake-off/cli.mjs");
    expect(existsSync(path.join(APP_ROOT, "scripts/bake-off/cli.mjs"))).toBe(true);
  });

  it("the wrapper collects flags into BAKEOFF_ARGS and spawns vitest with the bake-off config", () => {
    const cli = readFileSync(path.join(APP_ROOT, "scripts/bake-off/cli.mjs"), "utf8");
    expect(cli).toContain("BAKEOFF_ARGS");
    expect(cli).toContain("vitest.config.mts");
    expect(cli).toContain("vitest.mjs");
  });
});
