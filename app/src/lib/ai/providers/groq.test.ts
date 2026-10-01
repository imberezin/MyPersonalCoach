import { describe, expect, it } from "vitest";
import { AIGateway } from "../gateway";
import { MEAL_JSON_SCHEMA } from "../prompts/mealSchema";
import { ProviderError } from "../types";
import { GROQ_ENDPOINT, GroqProvider } from "./groq";

const KEY = "test-groq-key-456";
const ctx = () => ({ signal: new AbortController().signal });

const mealJson = {
  items: [{ name: "פיצה", portion_size: "large", portion_amount: null, portion_unit: null, portion_estimated: true, confidence: 0.8, uncertain: false }],
  unclear: [],
  overall_confidence: 0.8,
  meal_type: null,
  day: null,
  local_time: null,
  not_food: false,
};

// Shaped like a real OpenAI-compatible chat completion.
const okResponse = (content: string | null = JSON.stringify(mealJson), usage: Record<string, unknown> = { prompt_tokens: 2400, completion_tokens: 90, total_tokens: 2490 }) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "qwen/qwen3.8-27b",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage,
});

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    return respond();
  }) as unknown as typeof fetch;
  return { fetch: doFetch, calls };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function provider(doFetch: typeof fetch, over: Partial<ConstructorParameters<typeof GroqProvider>[0]> = {}) {
  return new GroqProvider({
    apiKey: KEY,
    model: "qwen/qwen3.8-27b",
    responseFormat: "json_object",
    reasoningEffort: "none",
    reasoningFormat: "hidden",
    maxOutputTokens: 2048,
    fetch: doFetch,
    ...over,
  });
}

type Message = { role: string; content: unknown };

describe("GroqProvider request", () => {
  it("posts to chat completions with the key as a Bearer header only", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeText({ text: "פיצה", locale: "he" }, ctx());
    const [call] = calls;
    expect(call.url).toBe(GROQ_ENDPOINT);
    expect(call.url).not.toContain(KEY);
    expect(call.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(JSON.stringify(call.body)).not.toContain(KEY);
  });

  it("always sends reasoning_effort and reasoning_format from the config, and never 'raw'", async () => {
    for (const format of ["json_object", "json_schema"] as const) {
      const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
      await provider(doFetch, { responseFormat: format, reasoningEffort: "low", reasoningFormat: "parsed" }).analyzeText({ text: "x", locale: "he" }, ctx());
      expect(calls[0].body.reasoning_effort).toBe("low");
      expect(calls[0].body.reasoning_format).toBe("parsed");
    }
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeMeal({ image: { bytes: new Uint8Array([1]), mime: "image/jpeg" }, locale: "he" }, ctx());
    expect(calls[0].body.reasoning_effort).toBe("none");
    expect(calls[0].body.reasoning_format).toBe("hidden");
    expect(calls[0].body.reasoning_format).not.toBe("raw");
  });

  it("text: a string user turn inside the delimiters, JSON mode, shape appended to the system text", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeText({ text: "פיצה", locale: "he" }, ctx());
    const body = calls[0].body;
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.temperature).toBe(0.2);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.response_format).toEqual({ type: "json_object" });
    const [system, user] = body.messages as Message[];
    expect(system.role).toBe("system");
    expect(system.content as string).toContain("אתה עוזר שמסדר דיווחי אוכל");
    expect(system.content as string).toContain("JSON shape:");
    expect(user).toEqual({ role: "user", content: "<user_text>\nפיצה\n</user_text>" });
  });

  it("photo: a text part and an image_url part holding a base64 data URL", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    await provider(doFetch).analyzeMeal({ image: { bytes, mime: "image/jpeg" }, text: "חצי מנה", locale: "he" }, ctx());
    const user = (calls[0].body.messages as Message[])[1];
    expect(user.content).toEqual([
      { type: "text", text: "מצורפת תמונה של מה שאכלתי.\n<user_text>\nחצי מנה\n</user_text>" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` } },
    ]);
  });

  it("json_schema mode sends the strict schema and does not append the shape to the prompt", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch, { responseFormat: "json_schema" }).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(calls[0].body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "meal", strict: true, schema: JSON.parse(JSON.stringify(MEAL_JSON_SCHEMA)) },
    });
    expect(((calls[0].body.messages as Message[])[0].content as string)).not.toContain("JSON shape:");
  });
});

describe("GroqProvider response", () => {
  it("returns the parsed answer, the model and the usage", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse()));
    const reply = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(reply.model).toBe("qwen/qwen3.8-27b");
    expect(reply.output).toEqual(mealJson);
    expect(reply.usage).toEqual({ inputTokens: 2400, outputTokens: 90, reasoningTokens: undefined });
  });

  it("reads reasoning tokens from either place Groq may put them", async () => {
    const nested = fakeFetch(() => json(okResponse(undefined, { prompt_tokens: 1, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 40 } })));
    expect((await provider(nested.fetch).analyzeText({ text: "x", locale: "he" }, ctx())).usage?.reasoningTokens).toBe(40);
    const flat = fakeFetch(() => json(okResponse(undefined, { prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 7 })));
    expect((await provider(flat.fetch).analyzeText({ text: "x", locale: "he" }, ctx())).usage?.reasoningTokens).toBe(7);
  });

  it("strips a reasoning block and a code fence that leaked into the content", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse("<think>maybe pizza</think>\n```json\n" + JSON.stringify(mealJson) + "\n```")));
    expect((await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx())).output).toEqual(mealJson);
  });

  it("malformed JSON or null content gives null output (invalid, not a crash)", async () => {
    for (const content of ["{nope", null, ""]) {
      const { fetch: doFetch } = fakeFetch(() => json(okResponse(content)));
      expect((await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx())).output).toBeNull();
    }
  });

  it("no choices is a server-type failure", async () => {
    const { fetch: doFetch } = fakeFetch(() => json({ choices: [] }));
    const error = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("server");
  });

  it("a content_filter finish is 'blocked'", async () => {
    const { fetch: doFetch } = fakeFetch(() => json({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }));
    const error = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx()).catch((e) => e);
    expect(error.kind).toBe("blocked");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [404, "bad_request"],
    [500, "server"],
  ])("HTTP %s -> %s, and the response body is never in the error", async (status, kind) => {
    const { fetch: doFetch } = fakeFetch(() => json({ error: { message: "echo: pizza and cola" } }, status));
    const error = await provider(doFetch).analyzeText({ text: "pizza and cola", locale: "he" }, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain("pizza");
  });

  it("the other operations are unsupported", async () => {
    const p = provider(fakeFetch(() => json({})).fetch);
    for (const call of [p.transcribeVoice(), p.generateInsight(), p.detectPatternCandidate(), p.coach()]) {
      const error = await call.catch((e) => e);
      expect(error.kind).toBe("unsupported");
    }
  });
});

describe("GroqProvider through the gateway", () => {
  it("a recorded good answer becomes a normalized meal with an estimated size", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse()));
    const result = await new AIGateway([provider(doFetch)]).analyzeText({ text: "פיצה", locale: "he" });
    expect(result).toMatchObject({ ok: true, provider: "groq", model: "qwen/qwen3.8-27b" });
    if (result.ok) expect(result.value.items[0].portion).toEqual({ kind: "size", size: "large", estimated: true });
  });

  it("a rate-limited Groq is a recorded 'error' attempt and the gateway reports failure without throwing", async () => {
    const { fetch: doFetch } = fakeFetch(() => json({}, 429));
    const records: string[] = [];
    const gateway = new AIGateway([provider(doFetch)], { recorder: { record: (r) => void records.push(`${r.outcome}:${r.errorKind}`) } });
    const result = await gateway.analyzeText({ text: "x", locale: "he" });
    expect(result).toMatchObject({ ok: false, reason: "all_providers_failed" });
    expect(records).toEqual(["error:rate_limited"]);
  });
});
