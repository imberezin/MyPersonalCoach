import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source scans for the promises the seed tooling makes (16.4 and the gates of 14.1): it reads no environment file, takes only
 * two environment variables, never names the hosted project or an admin key by its variable name, writes only the demo
 * user's tables, and is not part of the app.
 */

const ROOT = process.cwd();
const SEED_DIR = join(ROOT, "scripts", "seed-demo");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const rel = (path: string) => relative(ROOT, path).replaceAll("\\", "/");
const seedFiles = [...files(SEED_DIR), join(ROOT, "scripts", "seed-demo.mjs")].map((path) => ({ path: rel(path), text: readFileSync(path, "utf8") }));
const text = (name: string) => seedFiles.find((f) => f.path === name)?.text ?? "";

describe("the tooling reads no secret from a file", () => {
  it("names no environment file", () => {
    // (`process.env` is the environment itself, counted in the next test; an environment FILE is `.env`, `.env.local`, ...)
    expect(seedFiles.filter((f) => /\.env/.test(f.text.replaceAll("process.env", ""))).map((f) => f.path)).toEqual([]);
  });

  it("takes only SEED_ARGS and SEED_USER_PASSWORD from the environment", () => {
    const reads = seedFiles.flatMap((f) => [...f.text.matchAll(/process\.env(?:\.(\w+)|\[)?/g)].map((m) => `${f.path}: ${m[1] ?? m[0]}`));
    // The wrapper spreads the inherited environment into the child (the password travels there, not in SEED_ARGS).
    expect(reads.sort()).toEqual(
      [
        "scripts/seed-demo.mjs: process.env",
        "scripts/seed-demo/run.live.ts: SEED_ARGS",
        "scripts/seed-demo/run.live.ts: SEED_USER_PASSWORD",
      ].sort(),
    );
  });

  it("never names the hosted project's variables or an admin key by its variable name", () => {
    expect(seedFiles.filter((f) => /SUPABASE_URL|SERVICE_ROLE|SUPABASE_SECRET|NEXT_PUBLIC/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("the wrapper never serializes the password, and the runner never prints it", () => {
    const wrapper = text("scripts/seed-demo.mjs");
    expect(wrapper).toContain("SEED_ARGS: JSON.stringify(flags)");
    expect(wrapper).not.toMatch(/process\.env\.SEED_USER_PASSWORD|process\.env\[/);
    // The password is read once from the dependencies and then only handed to sign-in and to user creation.
    const run = text("scripts/seed-demo/run.ts");
    expect([...run.matchAll(/deps\.password/g)]).toHaveLength(1);
    expect([...run.matchAll(/password as string/g)]).toHaveLength(3);
    // No template literal in a log call interpolates a password.
    expect(run).not.toMatch(/log\([^;]*\$\{[^}]*password/i);
  });

  it("the live runner's vitest config reads no environment file and keeps the live file out of npm test", () => {
    const config = text("scripts/seed-demo/vitest.config.mts");
    expect(config).toMatch(/envDir:\s*false/);
    expect(config).toContain('include: ["scripts/seed-demo/run.live.ts"]');
    expect(config).toMatch(/testTimeout:\s*120_000/);
    expect(config).toMatch(/hookTimeout:\s*120_000/);
    const root = readFileSync(join(ROOT, "vitest.config.mts"), "utf8");
    expect(root).toContain('include: ["src/**/*.test.ts", "tests/**/*.test.ts"]');
  });

  it("the package script is the documented one", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["seed:demo"]).toBe("node scripts/seed-demo.mjs");
  });
});

describe("the database code touches only the demo user's own tables", () => {
  const db = text("scripts/seed-demo/db.ts");

  it("reads and writes only these tables", () => {
    const tables = new Set([...db.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(["meal_entries", "offline_periods", "pattern_evidence", "profiles", "user_preferences"]);
  });

  it("deletes only meals (through RLS) and, with the stack's own admin key, the one guarded user", () => {
    const deletes = [...db.matchAll(/\.from\("(\w+)"\)\s*\.delete\(/g)].map((m) => m[1]);
    expect(deletes).toEqual(["meal_entries", "meal_entries"]);
    expect([...db.matchAll(/auth\.admin\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(["createUser", "deleteUser", "listUsers"]);
    // The admin key is read in one function and only when a user is created or deleted.
    expect([...db.matchAll(/adminKeyOf\(/g)]).toHaveLength(2); // its definition and its single call
  });

  it("never uses the stack's key anywhere but the admin client", () => {
    expect([...db.matchAll(/createClient\(([^,]+),/g)].map((m) => m[1].trim()).sort()).toEqual(["stack.apiUrl", "stack.apiUrl"]);
    const keys = [...db.matchAll(/createClient\([^,]+,\s*([^,]+),/g)].map((m) => m[1].trim()).sort();
    expect(keys).toEqual(["adminKeyOf(status)", "stack.publishableKey"]);
  });

  it("takes the stack URL only from the Docker stack's status", () => {
    expect(db).toContain("supabase status -o json");
    expect(db).not.toMatch(/https?:\/\//);
  });
});

describe("the tooling is not part of the app", () => {
  it("nothing under src imports from scripts/", () => {
    const srcFiles = files(join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p));
    const importers = srcFiles.filter((p) => /from\s+["'][^"']*scripts\//.test(readFileSync(p, "utf8"))).map(rel);
    expect(importers).toEqual([]);
  });

  it("the dev clock file is gitignored", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^\/\.dev-clock$/m);
  });
});
