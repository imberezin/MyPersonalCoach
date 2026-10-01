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

describe("isAiConfigured", () => {
  it("is false with nothing set and never throws", () => {
    expect(isAiConfigured({}, "production")).toBe(false);
  });

  it("is true in development with the fake provider and the admin key", () => {
    expect(isAiConfigured({ ...ADMIN }, "development")).toBe(true);
  });
});
