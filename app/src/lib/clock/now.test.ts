import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_CLOCK_FILE, currentInstant, resolveInstant } from "./now";

const REAL = new Date("2026-10-02T08:00:00Z");
const LOCAL = "http://127.0.0.1:54321";
const HOSTED = "https://abcdefghijklmnopqrst.supabase.co";
const FILE_INSTANT = "2026-09-17T09:00:00+03:00";

const run = (a: { nodeEnv?: string; supabaseUrl?: string; file?: string | null | (() => string | null) }) => {
  const file = a.file;
  const readFile: () => string | null = typeof file === "function" ? file : () => file ?? null;
  return resolveInstant({ nodeEnv: a.nodeEnv, supabaseUrl: a.supabaseUrl, readFile, real: () => new Date(REAL) });
};

describe("resolveInstant: when the file is read", () => {
  it("returns the file's instant in development against the local stack", () => {
    expect(run({ nodeEnv: "development", supabaseUrl: LOCAL, file: FILE_INSTANT }).toISOString()).toBe("2026-09-17T06:00:00.000Z");
  });

  it("tolerates a trailing newline and surrounding spaces, and accepts Z, fractions and no seconds", () => {
    for (const [text, iso] of [
      [`${FILE_INSTANT}\n`, "2026-09-17T06:00:00.000Z"],
      [`  ${FILE_INSTANT}\r\n`, "2026-09-17T06:00:00.000Z"],
      ["2026-09-17T06:00:00Z", "2026-09-17T06:00:00.000Z"],
      ["2026-09-17T06:00:00.250Z", "2026-09-17T06:00:00.250Z"],
      ["2026-09-17T09:00+03:00", "2026-09-17T06:00:00.000Z"],
      ["2026-09-17T09:00:00-05:00", "2026-09-17T14:00:00.000Z"],
    ]) {
      expect(run({ nodeEnv: "development", supabaseUrl: LOCAL, file: text }).toISOString(), text).toBe(iso);
    }
  });

  it.each(["production", "test", "", undefined])("ignores a valid file when NODE_ENV is %j", (nodeEnv) => {
    expect(run({ nodeEnv, supabaseUrl: LOCAL, file: FILE_INSTANT })).toEqual(REAL);
  });

  it.each([HOSTED, "https://127.0.0.1.evil.com", "http://localhost.evil.com", "http://localhost@evil.com", "", undefined])(
    "ignores a valid file in development when the Supabase URL is %j",
    (supabaseUrl) => {
      expect(run({ nodeEnv: "development", supabaseUrl, file: FILE_INSTANT })).toEqual(REAL);
    },
  );

  it("does not even read the file outside development against the local stack", () => {
    const readFile = vi.fn(() => FILE_INSTANT);
    resolveInstant({ nodeEnv: "production", supabaseUrl: LOCAL, readFile, real: () => REAL });
    resolveInstant({ nodeEnv: "development", supabaseUrl: HOSTED, readFile, real: () => REAL });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("resolveInstant: a file that is not a usable instant is the real clock", () => {
  it.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "  \n"],
    ["a date only", "2026-09-17"],
    ["a time without an offset", "2026-09-17T09:00:00"],
    ["words", "tomorrow morning"],
    ["a number", "1789000000000"],
    ["an impossible month", "2026-13-01T09:00:00+03:00"],
    ["an impossible day", "2026-02-30T09:00:00+03:00"],
    ["a space instead of T", "2026-09-17 09:00:00+03:00"],
    ["two lines", `${FILE_INSTANT}\n${FILE_INSTANT}`],
    ["trailing garbage", `${FILE_INSTANT} later`],
    ["a comment", `# ${FILE_INSTANT}`],
  ])("%s", (_name, file) => {
    expect(run({ nodeEnv: "development", supabaseUrl: LOCAL, file })).toEqual(REAL);
  });

  it("a read that throws", () => {
    const file = () => {
      throw new Error("EACCES");
    };
    expect(run({ nodeEnv: "development", supabaseUrl: LOCAL, file })).toEqual(REAL);
  });
});

describe("resolveInstant: the result", () => {
  it("is a fresh Date every time, never the reader's or the clock's own object", () => {
    const real = new Date(REAL);
    const a = resolveInstant({ nodeEnv: "production", supabaseUrl: LOCAL, readFile: () => null, real: () => real });
    expect(a).toBe(real);
    const first = run({ nodeEnv: "development", supabaseUrl: LOCAL, file: FILE_INSTANT });
    const second = run({ nodeEnv: "development", supabaseUrl: LOCAL, file: FILE_INSTANT });
    expect(first).not.toBe(second);
    first.setFullYear(2000);
    expect(second.getUTCFullYear()).toBe(2026);
  });
});

describe("currentInstant", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes no argument, so nothing from a request can reach it", () => {
    expect(currentInstant.length).toBe(0);
  });

  it("is the real clock outside development, whatever the Supabase URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL);
    const before = Date.now();
    const now = currentInstant().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("is the real clock in development against a hosted project, even if a file were there", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED);
    const before = Date.now();
    expect(currentInstant().getTime()).toBeGreaterThanOrEqual(before);
  });

  it("names the clock file at the app root", () => {
    expect(DEV_CLOCK_FILE).toBe(".dev-clock");
  });
});

describe("source scans: the dev clock cannot be reached from a request", () => {
  const SRC = join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  }
  const rel = (path: string) => relative(process.cwd(), path).replaceAll("\\", "/");
  const files = sourceFiles(SRC).map((path) => ({ path: rel(path), text: readFileSync(path, "utf8") }));

  it("the clock file's name appears only under src/lib/clock/ (and the one dev-only status line that reads through currentInstant)", () => {
    const mentions = files
      .filter((f) => /dev-clock|DEV_CLOCK/.test(f.text))
      .map((f) => f.path)
      .filter((p) => !p.startsWith("src/lib/clock/") && !p.endsWith("/DevStatus.tsx"));
    expect(mentions).toEqual([]);
  });

  it("nothing outside src/lib/clock/ calls resolveInstant", () => {
    // (domain/food/edit.ts has its own unrelated private function of the same name; only files that reach into the clock count.)
    const callers = files
      .filter((f) => /\bresolveInstant\b/.test(f.text) && f.text.includes("lib/clock"))
      .map((f) => f.path)
      .filter((p) => !p.startsWith("src/lib/clock/"));
    expect(callers).toEqual([]);
  });

  it("the clock module reads nothing from the request (no cookies, headers or search params)", () => {
    const clock = files.filter((f) => f.path.startsWith("src/lib/clock/")).map((f) => f.text).join("\n");
    expect(clock).not.toMatch(/next\/headers|\bcookies\(|\bheaders\(|searchParams/);
  });

  it("the clock module uses the one existing definition of 'local'", () => {
    const now = readFileSync(join(SRC, "lib", "clock", "now.ts"), "utf8");
    expect(now).toContain('import { isLocalSupabaseUrl } from "@/lib/supabase/config"');
    expect(now).not.toMatch(/(function|const)\s+isLocal/);
  });
});
