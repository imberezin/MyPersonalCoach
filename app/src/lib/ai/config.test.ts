import { describe, expect, it } from "vitest";
import { AI_DEFAULTS, readAiConfig, usableProviders } from "./config";

describe("readAiConfig defaults", () => {
  it("uses the documented defaults when nothing is set", () => {
    const config = readAiConfig({}, "production");
    expect(config.providerOrder).toEqual(["gemini", "groq"]);
    expect(config.gemini).toEqual({ apiKey: null, model: AI_DEFAULTS.models.gemini, thinkingLevel: AI_DEFAULTS.gemini.thinkingLevel });
    expect(config.groq).toMatchObject({ apiKey: null, model: AI_DEFAULTS.models.groq, responseFormat: "json_object", reasoningEffort: "none", reasoningFormat: "hidden" });
    expect(config.timeoutsMs).toEqual({ photo: 14_000, text: 10_000, total: 28_000 });
    expect(config.caps).toEqual({ dailyCalls: 40, perMinuteCalls: 3 });
  });

  it("never defaults the Groq reasoning format to raw, which Groq refuses together with JSON mode", () => {
    expect(AI_DEFAULTS.groq.reasoningFormat).not.toBe("raw");
    expect(readAiConfig({}, "production").groq.reasoningFormat).not.toBe("raw");
  });

  it("the defaults object is the only place model ids live (placeholders until the bake-off)", () => {
    expect(AI_DEFAULTS.models).toEqual({ gemini: "gemini-3.1-flash-lite", groq: "qwen/qwen3.8-27b" });
  });
});

describe("readAiConfig environment", () => {
  it("reads keys and models, trimming blanks", () => {
    const config = readAiConfig({ GEMINI_API_KEY: " g-key ", GROQ_API_KEY: "", GEMINI_MODEL: "gemini-x", GROQ_MODEL: "  " }, "production");
    expect(config.gemini.apiKey).toBe("g-key");
    expect(config.groq.apiKey).toBeNull();
    expect(config.gemini.model).toBe("gemini-x");
    expect(config.groq.model).toBe(AI_DEFAULTS.models.groq);
  });

  it("reads the Groq response format and ignores unknown values", () => {
    expect(readAiConfig({ GROQ_RESPONSE_FORMAT: "json_schema" }, "production").groq.responseFormat).toBe("json_schema");
    expect(readAiConfig({ GROQ_RESPONSE_FORMAT: "xml" }, "production").groq.responseFormat).toBe("json_object");
  });

  it("reads the caps, accepts 0, and falls back for anything that is not a whole number", () => {
    expect(readAiConfig({ AI_DAILY_CAP: "10", AI_PER_MINUTE_CAP: "2" }, "production").caps).toEqual({ dailyCalls: 10, perMinuteCalls: 2 });
    expect(readAiConfig({ AI_DAILY_CAP: "0" }, "production").caps.dailyCalls).toBe(0);
    for (const bad of ["", "abc", "-5", "1.5", "1e3", "99999999", " "]) {
      expect(readAiConfig({ AI_DAILY_CAP: bad, AI_PER_MINUTE_CAP: bad }, "production").caps).toEqual({ dailyCalls: 40, perMinuteCalls: 3 });
    }
  });
});

describe("provider order", () => {
  it("parses a comma list, in order, dropping unknown and duplicate names", () => {
    expect(readAiConfig({ AI_PROVIDER_ORDER: "groq, gemini" }, "production").providerOrder).toEqual(["groq", "gemini"]);
    expect(readAiConfig({ AI_PROVIDER_ORDER: "GROQ,openai,groq" }, "production").providerOrder).toEqual(["groq"]);
  });

  it("'none' means no providers at all, which is how development tests the manual path", () => {
    expect(readAiConfig({ AI_PROVIDER_ORDER: "none" }, "development").providerOrder).toEqual([]);
    expect(readAiConfig({ AI_PROVIDER_ORDER: "NONE", GEMINI_API_KEY: "k" }, "production").providerOrder).toEqual([]);
  });

  it("refuses the fake provider in production, even when asked", () => {
    expect(readAiConfig({ AI_PROVIDER_ORDER: "fake,groq" }, "production").providerOrder).toEqual(["groq"]);
    expect(readAiConfig({ AI_PROVIDER_ORDER: "fake" }, "test").providerOrder).toEqual(["fake"]);
  });

  it("development with no key and no explicit order uses the fake provider; with a key it does not", () => {
    expect(readAiConfig({}, "development").providerOrder).toEqual(["fake"]);
    expect(readAiConfig({ GROQ_API_KEY: "k" }, "development").providerOrder).toEqual(["gemini", "groq"]);
    expect(readAiConfig({}, "test").providerOrder).toEqual(["gemini", "groq"]);
    expect(readAiConfig({}, "production").providerOrder).toEqual(["gemini", "groq"]);
  });
});

describe("usableProviders", () => {
  it("lists only providers that have a key (the fake needs none), in order", () => {
    expect(usableProviders(readAiConfig({}, "production"))).toEqual([]);
    expect(usableProviders(readAiConfig({ GROQ_API_KEY: "k" }, "production"))).toEqual(["groq"]);
    expect(usableProviders(readAiConfig({ GROQ_API_KEY: "k", GEMINI_API_KEY: "g", AI_PROVIDER_ORDER: "groq,gemini" }, "production"))).toEqual(["groq", "gemini"]);
    expect(usableProviders(readAiConfig({}, "development"))).toEqual(["fake"]);
  });
});
