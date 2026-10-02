import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "./config";

describe("isLocalSupabaseUrl", () => {
  it("accepts the local Supabase on this machine", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
  });

  it("rejects a hosted project and look-alike hosts", () => {
    expect(isLocalSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://localhost.example.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.nip.io")).toBe(false);
    expect(isLocalSupabaseUrl("https://example.com/?next=http://127.0.0.1")).toBe(false);
  });

  it("rejects a missing or malformed value", () => {
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
    expect(isLocalSupabaseUrl("")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });
});

// The dev clock (src/lib/clock/now.ts) and the seed guard use this ONE definition of "local". A look-alike host
// that slips through here would let a fake clock or the seed script near a real project.
describe("isLocalSupabaseUrl: bypass attempts", () => {
  it.each([
    "http://127.0.0.1.evil.com",
    "http://localhost.evil.com",
    "http://localhost@evil.com",
    "http://evil.com/127.0.0.1",
    "http://evil.com/?u=localhost",
    "http://evil.com#127.0.0.1",
    "http://user:localhost@evil.com",
    "http://evil.com:54321@127.0.0.1.evil.com",
    "http://notlocalhost",
    "http://127.0.0.10",
    "http://[::2]:54321",
    "",
    "not a url",
    "127.0.0.1:54321",
  ])("rejects %j", (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(false);
  });

  it("accepts the three local hosts with a port, a path and either scheme", () => {
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://localhost/rest/v1")).toBe(true);
    expect(isLocalSupabaseUrl("http://127.0.0.1")).toBe(true);
  });

  it("is defined exactly once under src/ and scripts/ (no second, looser copy of 'local')", () => {
    const roots = ["src", "scripts"].map((d) => join(process.cwd(), d)).filter((d) => existsSync(d));
    const definitions: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(path);
        } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          if (/(function\s+isLocalSupabaseUrl\b|(const|let|var)\s+isLocalSupabaseUrl\b)/.test(text)) definitions.push(path);
        }
      }
    };
    roots.forEach(walk);
    expect(definitions.map((p) => relative(process.cwd(), p).replaceAll("\\", "/"))).toEqual(["src/lib/supabase/config.ts"]);
  });
});
