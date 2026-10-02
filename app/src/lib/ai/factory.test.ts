import { describe, expect, it } from "vitest";
import { createAiRuntime, isAiConfigured } from "./factory";

const ADMIN = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "admin-key" };

describe("createAiRuntime", () => {
  it("no keys: no providers, not configured, and nothing throws", () => {
    const runtime = createAiRuntime({ env: { ...ADMIN }, nodeEnv: "production" });
    expect(runtime.providers).toEqual([]);
    expect(runtime.configured).toBe(false);
    expect(runtime.promptVersion).toBe("meal-v2");
  });

  it("provider keys present but the admin key missing: not configured (the quota ledger cannot work)", () => {
    const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
    const runtime = createAiRuntime({ env, nodeEnv: "production" });
    expect(runtime.providers).toEqual(["gemini", "groq"]);
    expect(runtime.configured).toBe(false);
    expect(isAiConfigured(env, "production")).toBe(false);
  });

  it("one key and the admin key: one provider, configured", () => {
    const env = { GROQ_API_KEY: "q", ...ADMIN };
    const runtime = createAiRuntime({ env, nodeEnv: "production" });
    expect(runtime.providers).toEqual(["groq"]);
    expect(runtime.configured).toBe(true);
    expect(isAiConfigured(env, "production")).toBe(true);
  });

  it("builds providers in the configured order", () => {
    const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", AI_PROVIDER_ORDER: "groq,gemini", ...ADMIN };
    expect(createAiRuntime({ env, nodeEnv: "production" }).providers).toEqual(["groq", "gemini"]);
  });

  it("refuses the fake provider in production", () => {
    const env = { AI_PROVIDER_ORDER: "fake", ...ADMIN };
    const runtime = createAiRuntime({ env, nodeEnv: "production" });
    expect(runtime.providers).toEqual([]);
    expect(runtime.configured).toBe(false);
    expect(isAiConfigured(env, "production")).toBe(false);
  });

  it("development with no key defaults to the fake provider", () => {
    const runtime = createAiRuntime({ env: { ...ADMIN }, nodeEnv: "development" });
    expect(runtime.providers).toEqual(["fake"]);
    expect(runtime.configured).toBe(true);
  });

  it("'none' gives the manual path even in development", () => {
    const runtime = createAiRuntime({ env: { AI_PROVIDER_ORDER: "none", ...ADMIN }, nodeEnv: "development" });
    expect(runtime.providers).toEqual([]);
    expect(runtime.configured).toBe(false);
  });

  it("the gateway of a runtime without providers answers no_providers instead of throwing", async () => {
    const runtime = createAiRuntime({ env: { ...ADMIN }, nodeEnv: "production" });
    expect(await runtime.gateway.analyzeText({ text: "x", locale: "he" })).toMatchObject({ ok: false, reason: "no_providers" });
  });

  it("a fake runtime works end to end through the gateway and the recorder", async () => {
    const records: string[] = [];
    const runtime = createAiRuntime({ env: { ...ADMIN }, nodeEnv: "development", recorder: { record: (r) => void records.push(`${r.provider}:${r.outcome}`) } });
    const result = await runtime.gateway.analyzeText({ text: "x", locale: "he" });
    expect(result).toMatchObject({ ok: true, provider: "fake" });
    expect(records).toEqual(["fake:ok"]);
  });

  it("passes the injected fetch to a real adapter (no network in tests)", async () => {
    const urls: string[] = [];
    const doFetch = (async (url: string) => {
      urls.push(url);
      return new Response("{}", { status: 429 });
    }) as unknown as typeof fetch;
    const runtime = createAiRuntime({ env: { GROQ_API_KEY: "q", ...ADMIN }, nodeEnv: "production", fetch: doFetch });
    await runtime.gateway.analyzeText({ text: "x", locale: "he" });
    expect(urls).toEqual(["https://api.groq.com/openai/v1/chat/completions"]);
  });

  it("exposes the config with the caps for the caller", () => {
    const runtime = createAiRuntime({ env: { AI_DAILY_CAP: "5", ...ADMIN }, nodeEnv: "production" });
    expect(runtime.config.caps.dailyCalls).toBe(5);
    expect(runtime.config.timeoutsMs.photo).toBe(14_000);
  });
});

describe("AI_FAKE_BEHAVIOR (the fake provider's wording behavior)", () => {
  const SENTENCE = "At your next meal, sit down, put it on a plate, and take a few minutes without a screen.";
  const wording = { locale: "en" as const, facts: { approved_text: SENTENCE, scope: "next_meal", max_chars: 180, tone: "calm" } };
  const textOf = async (runtime: ReturnType<typeof createAiRuntime>) => {
    const result = await runtime.gateway.wordExperiment(wording, { retries: 0 });
    return result.ok ? result.value.text : null;
  };

  it("with fake in the provider order, the variable picks the behavior", async () => {
    const env = { AI_PROVIDER_ORDER: "fake", AI_FAKE_BEHAVIOR: "wording_negate", ...ADMIN };
    expect(await textOf(createAiRuntime({ env, nodeEnv: "development" }))).toContain("with a screen");
    expect(await textOf(createAiRuntime({ env: { ...env, AI_FAKE_BEHAVIOR: "wording_fail" }, nodeEnv: "development" }))).toBeNull();
  });

  it("without the variable, or with an unknown value, the fake answers the default faithful reword", async () => {
    const expected = `${SENTENCE.replace(/\.$/, "")}, if you like.`;
    expect(await textOf(createAiRuntime({ env: { AI_PROVIDER_ORDER: "fake", ...ADMIN }, nodeEnv: "development" }))).toBe(expected);
    expect(await textOf(createAiRuntime({ env: { AI_PROVIDER_ORDER: "fake", AI_FAKE_BEHAVIOR: "nonsense", ...ADMIN }, nodeEnv: "development" }))).toBe(expected);
  });

  it("is read outside production only: in production the fake is refused, so the variable changes nothing", async () => {
    const env = { AI_PROVIDER_ORDER: "fake", AI_FAKE_BEHAVIOR: "wording_ok", ...ADMIN };
    const runtime = createAiRuntime({ env, nodeEnv: "production" });
    expect(runtime.providers).toEqual([]);
    expect(runtime.configured).toBe(false);
    expect(await runtime.gateway.wordExperiment(wording, { retries: 0 })).toMatchObject({ ok: false, reason: "no_providers" });
  });

  it("has no effect unless fake is in the provider order: with keys and the default order the fake is not built", async () => {
    const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", AI_FAKE_BEHAVIOR: "wording_ok", ...ADMIN };
    const runtime = createAiRuntime({ env, nodeEnv: "development" });
    expect(runtime.providers).toEqual(["gemini", "groq"]);
    expect(runtime.providers).not.toContain("fake");
  });

  it("an experiment wording attempt through the runtime is recorded as wordExperiment", async () => {
    const records: string[] = [];
    const runtime = createAiRuntime({
      env: { AI_PROVIDER_ORDER: "fake", ...ADMIN },
      nodeEnv: "development",
      recorder: { record: (r) => void records.push(`${r.operation}:${r.outcome}`) },
    });
    await runtime.gateway.wordExperiment(wording, { retries: 0 });
    expect(records).toEqual(["wordExperiment:ok"]);
  });
});

describe("isAiConfigured", () => {
  it("is false with nothing set and never throws", () => {
    expect(isAiConfigured({}, "production")).toBe(false);
  });

  it("is true in development with the fake provider and the admin key", () => {
    expect(isAiConfigured({ ...ADMIN }, "development")).toBe(true);
  });
});
