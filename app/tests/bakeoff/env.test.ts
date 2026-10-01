import { describe, expect, it } from "vitest";
import { loadBakeOffEnv, parseEnvFile } from "../../scripts/bake-off/lib/env";

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines, skipping blanks and comments", () => {
    const text = ["# a comment", "", "GEMINI_API_KEY=abc123", "  GROQ_API_KEY = def456  ", "NOT A LINE", "=novalue"].join("\n");
    expect(parseEnvFile(text)).toEqual({ GEMINI_API_KEY: "abc123", GROQ_API_KEY: "def456" });
  });

  it("handles quotes, an `export` prefix, inline comments and CRLF", () => {
    const text = ['A="quoted value"', "B='single'", "export C=plain # trailing comment", 'D="has # inside"', "E=a=b"].join("\r\n");
    expect(parseEnvFile(text)).toEqual({ A: "quoted value", B: "single", C: "plain", D: "has # inside", E: "a=b" });
  });

  it("lets a later line win and ignores keys that are not identifiers", () => {
    expect(parseEnvFile("A=1\nA=2\nbad key=3\n1BAD=4")).toEqual({ A: "2" });
  });

  it("an empty value is an empty string", () => {
    expect(parseEnvFile("GEMINI_API_KEY=")).toEqual({ GEMINI_API_KEY: "" });
  });
});

describe("loadBakeOffEnv", () => {
  const file = ["GEMINI_API_KEY=from-file", "GROQ_MODEL=m-file", "SUPABASE_SECRET_KEY=must-not-pass", "CRON_SECRET=nope", "NEXT_PUBLIC_X=1"].join("\n");

  it("keeps only GEMINI_ and GROQ_ variables", () => {
    expect(loadBakeOffEnv(file, {})).toEqual({ GEMINI_API_KEY: "from-file", GROQ_MODEL: "m-file" });
  });

  it("lets the real process environment win, and ignores its other variables", () => {
    const merged = loadBakeOffEnv(file, { GEMINI_API_KEY: "from-process", GROQ_API_KEY: "g2", PATH: "/bin", SUPABASE_SECRET_KEY: "x" });
    expect(merged).toEqual({ GEMINI_API_KEY: "from-process", GROQ_MODEL: "m-file", GROQ_API_KEY: "g2" });
  });

  it("works with no file", () => {
    expect(loadBakeOffEnv(null, { GROQ_API_KEY: "k", OTHER: "o" })).toEqual({ GROQ_API_KEY: "k" });
    expect(loadBakeOffEnv(null, {})).toEqual({});
  });

  it("skips undefined process values", () => {
    expect(loadBakeOffEnv(null, { GROQ_API_KEY: undefined })).toEqual({});
  });
});
