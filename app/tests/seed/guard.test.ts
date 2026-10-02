import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSeedTarget, checkDemoEmail, DEMO_EMAIL_SUFFIX } from "../../scripts/seed-demo/guard";

const LOCAL = "http://127.0.0.1:54321";
const GOOD = "demo@eating-coach.test";

describe("assertSeedTarget: the target is accepted", () => {
  it.each([
    ["http://127.0.0.1:54321", "demo@eating-coach.test", "demo@eating-coach.test"],
    ["http://localhost:54321", "demo@eating-coach.test", "demo@eating-coach.test"],
    ["http://[::1]:54321", "demo@eating-coach.test", "demo@eating-coach.test"],
    [LOCAL, "Demo-1@Eating-Coach.TEST", "demo-1@eating-coach.test"],
    [LOCAL, "  demo@eating-coach.test \n", "demo@eating-coach.test"],
    [LOCAL, "a.b_c+d-e@eating-coach.test", "a.b_c+d-e@eating-coach.test"],
    [LOCAL, `${"a".repeat(40)}@eating-coach.test`, `${"a".repeat(40)}@eating-coach.test`],
  ])("%s with %j", (apiUrl, email, expected) => {
    expect(assertSeedTarget({ apiUrl, email })).toEqual({ ok: true, email: expected });
  });
});

describe("assertSeedTarget: the stack must be the local one", () => {
  it.each([
    ["a hosted URL", "https://abcdefghijklmnopqrst.supabase.co"],
    ["a host that merely starts like it", "http://127.0.0.1.evil.com"],
    ["a user-info trick", "http://localhost@evil.com"],
    ["a longer host name", "http://localhost.evil.com"],
    ["the address in the path", "http://evil.com/127.0.0.1"],
    ["undefined", undefined],
    ["an empty string", ""],
    ["text that is not a URL", "not a url"],
  ])("refuses %s", (_name, apiUrl) => {
    expect(assertSeedTarget({ apiUrl, email: GOOD })).toEqual({ ok: false, reason: "not_local_stack" });
  });
});

describe("assertSeedTarget: the user must be a throwaway one", () => {
  it.each(["owner@gmail.com", "x@eating-coach.test.evil.com", "x@eating-coach.testx", "x@notating-coach.test", "x@sub.eating-coach.test", "x@eating-coach.test@evil.com"])(
    "%j is the wrong suffix or shape",
    (email) => {
      const result = assertSeedTarget({ apiUrl: LOCAL, email });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(["bad_email_suffix", "bad_email"]).toContain(result.reason);
    },
  );

  it.each(["owner@gmail.com", "x@eating-coach.test.evil.com", "x@eating-coach.testx", "x@notating-coach.test"])("%j is bad_email_suffix", (email) => {
    expect(assertSeedTarget({ apiUrl: LOCAL, email })).toEqual({ ok: false, reason: "bad_email_suffix" });
  });

  it.each([
    ["no local part", "@eating-coach.test"],
    ["a 41-character local part", `${"a".repeat(41)}@eating-coach.test`],
    ["a space inside", "de mo@eating-coach.test"],
    ["a newline inside", "demo\n@eating-coach.test"],
    ["a character outside the set", "dé@eating-coach.test"],
    ["undefined", undefined],
    ["an empty string", ""],
    ["no @ at all", "demo.eating-coach.test"],
  ])("%s is bad_email", (_name, email) => {
    expect(assertSeedTarget({ apiUrl: LOCAL, email })).toEqual({ ok: false, reason: "bad_email" });
  });

  it("when both are wrong, the URL reason is reported first", () => {
    expect(assertSeedTarget({ apiUrl: "https://abc.supabase.co", email: "owner@gmail.com" })).toEqual({ ok: false, reason: "not_local_stack" });
    expect(assertSeedTarget({ apiUrl: undefined, email: undefined })).toEqual({ ok: false, reason: "not_local_stack" });
  });

  it("never throws, whatever it is given", () => {
    const hostile: unknown[] = [null, 0, {}, [], Symbol.iterator, () => 1, "\u0000", "a@".repeat(1000)];
    for (const apiUrl of hostile) {
      for (const email of hostile) {
        expect(() => assertSeedTarget({ apiUrl: apiUrl as string, email: email as string })).not.toThrow();
        expect(assertSeedTarget({ apiUrl: apiUrl as string, email: email as string }).ok).toBe(false);
      }
    }
  });

  it("the suffix is the documented one", () => {
    expect(DEMO_EMAIL_SUFFIX).toBe("@eating-coach.test");
    expect(checkDemoEmail("demo@eating-coach.test")).toEqual({ ok: true, email: "demo@eating-coach.test" });
  });
});

describe("the guard has one definition of 'local'", () => {
  it("imports the app's isLocalSupabaseUrl and does not define its own", () => {
    const source = readFileSync("scripts/seed-demo/guard.ts", "utf8");
    expect(source).toContain('import { isLocalSupabaseUrl } from "@/lib/supabase/config"');
    expect(source).not.toMatch(/(function|const)\s+isLocal/);
  });
});
