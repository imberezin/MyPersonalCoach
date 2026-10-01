import { describe, expect, it } from "vitest";
import { parseBakeOffArgs } from "../../scripts/bake-off/lib/args";

const parse = (flags: unknown) => parseBakeOffArgs(JSON.stringify(flags));

function value(flags: unknown) {
  const result = parse(flags);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("parseBakeOffArgs", () => {
  it("applies the defaults", () => {
    expect(value({ provider: "gemini" })).toEqual({ provider: "gemini", model: null, set: "all", prompt: "he", format: null, limit: null, delayMs: null, dryRun: false });
  });

  it("reads every flag", () => {
    expect(value({ provider: "groq", model: "qwen/qwen3.8-27b", set: "photo", prompt: "en", format: "json_schema", limit: "10", "delay-ms": "25000" })).toEqual({
      provider: "groq",
      model: "qwen/qwen3.8-27b",
      set: "photo",
      prompt: "en",
      format: "json_schema",
      limit: 10,
      delayMs: 25_000,
      dryRun: false,
    });
  });

  it("--dry-run needs no provider", () => {
    expect(value({ "dry-run": true })).toMatchObject({ provider: null, dryRun: true });
    expect(value({ "dry-run": true, provider: "groq" })).toMatchObject({ provider: "groq", dryRun: true });
  });

  it("without --dry-run a provider is required", () => {
    expect(parse({})).toMatchObject({ ok: false });
    expect(parseBakeOffArgs(undefined)).toMatchObject({ ok: false });
  });

  it.each([
    [{ provider: "openai" }],
    [{ provider: "gemini", model: "bad model!" }],
    [{ provider: "gemini", model: "" }],
    [{ provider: "gemini", set: "video" }],
    [{ provider: "gemini", prompt: "fr" }],
    [{ provider: "gemini", format: "json_object" }], // Groq only
    [{ provider: "groq", format: "xml" }],
    [{ provider: "gemini", limit: "0" }],
    [{ provider: "gemini", limit: "-3" }],
    [{ provider: "gemini", limit: "abc" }],
    [{ provider: "gemini", "delay-ms": "-1" }],
    [{ provider: "gemini", "delay-ms": "99999999999" }],
    [{ provider: "gemini", "dry-run": "maybe" }],
    [{ provider: "gemini", extra: "1" }], // an unknown flag stops the run before any call
    [{ provider: "gemini", "api-key": "nope" }],
  ])("rejects %j", (flags) => {
    expect(parse(flags)).toMatchObject({ ok: false });
  });

  it("names the unknown flag", () => {
    const result = parse({ provider: "gemini", colour: "red" });
    expect(result).toEqual({ ok: false, error: "Unknown flag --colour" });
  });

  it("rejects text that is not JSON or not an object", () => {
    expect(parseBakeOffArgs("{nope")).toMatchObject({ ok: false });
    expect(parseBakeOffArgs("[]")).toMatchObject({ ok: false });
    expect(parseBakeOffArgs('"x"')).toMatchObject({ ok: false });
  });
});
