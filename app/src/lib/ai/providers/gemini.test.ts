import { describe, expect, it } from "vitest";
import { AIGateway } from "../gateway";
import { MEAL_JSON_SCHEMA } from "../prompts/mealSchema";
import { MEAL_SYSTEM_PROMPT_HE } from "../prompts/meal";
import { WEEKLY_LINE_SYSTEM_PROMPT_HE } from "../prompts/weeklyLine";
import { WORDING_SYSTEM_PROMPT_HE } from "../prompts/wording";
import { ProviderError, type InsightContext } from "../types";
import { GEMINI_ENDPOINT, GeminiProvider } from "./gemini";

const KEY = "test-gemini-key-123";
const ctx = () => ({ signal: new AbortController().signal });

const mealJson = {
  items: [{ name: "שניצל", portion_size: "medium", portion_amount: null, portion_unit: null, portion_estimated: false, confidence: 0.9, uncertain: false }],
  unclear: [],
  overall_confidence: 0.9,
  meal_type: null,
  day: null,
  local_time: null,
  not_food: false,
};

// Shaped like a real generateContent answer.
const okResponse = (text: string = JSON.stringify(mealJson)) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 88, thoughtsTokenCount: 12, totalTokenCount: 421 },
  modelVersion: "gemini-3.1-flash-lite",
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

function provider(doFetch: typeof fetch, over: Partial<ConstructorParameters<typeof GeminiProvider>[0]> = {}) {
  return new GeminiProvider({ apiKey: KEY, model: "gemini-3.1-flash-lite", maxOutputTokens: 2048, thinkingLevel: "LOW", fetch: doFetch, ...over });
}

describe("GeminiProvider request", () => {
  it("posts to generateContent with the key only in a header", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeText({ text: "שניצל", locale: "he" }, ctx());
    const [call] = calls;
    expect(call.url).toBe(`${GEMINI_ENDPOINT}/gemini-3.1-flash-lite:generateContent`);
    expect(call.url).not.toContain(KEY);
    expect(call.url).not.toContain("key=");
    expect(call.init.headers).toMatchObject({ "x-goog-api-key": KEY, "Content-Type": "application/json" });
    expect(call.init.method).toBe("POST");
    expect(JSON.stringify(call.body)).not.toContain(KEY);
  });

  it("sends the system instruction, one user turn with the fenced text, and the JSON schema config", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeText({ text: "שניצל", locale: "he" }, ctx());
    const body = calls[0].body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: Record<string, unknown>[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0].text).toContain("אתה עוזר שמסדר דיווחי אוכל");
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts).toEqual([{ text: "<user_text>\nשניצל\n</user_text>" }]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseJsonSchema: JSON.parse(JSON.stringify(MEAL_JSON_SCHEMA)),
      thinkingConfig: { thinkingLevel: "LOW" },
    });
    expect(body.generationConfig).not.toHaveProperty("temperature");
  });

  it("adds the photo as an inlineData part (image first, then the text)", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await provider(doFetch).analyzeMeal({ image: { bytes, mime: "image/jpeg" }, locale: "he" }, ctx());
    const parts = (calls[0].body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") } });
    expect(parts[1]).toEqual({ text: "מצורפת תמונה של מה שאכלתי." });
  });

  it("omits thinkingConfig when no level is configured", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch, { thinkingLevel: null }).analyzeText({ text: "x", locale: "he" }, ctx());
    expect((calls[0].body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it("refuses a model id that could change the URL path", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const error = await provider(doFetch, { model: "x/../../other:method?key=1" }).analyzeText({ text: "x", locale: "he" }, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });
});

describe("GeminiProvider response", () => {
  it("returns the parsed answer, the model and the usage (thinking tokens as reasoning)", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse()));
    const reply = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(reply.model).toBe("gemini-3.1-flash-lite");
    expect(reply.output).toEqual(mealJson);
    expect(reply.usage).toEqual({ inputTokens: 321, outputTokens: 88, reasoningTokens: 12 });
  });

  it("ignores thought parts and joins the answer parts", async () => {
    const parts = [{ text: "thinking out loud", thought: true }, { text: '{"items":[],"unclear":[],' }, { text: '"overall_confidence":0.5}' }];
    const { fetch: doFetch } = fakeFetch(() => json({ candidates: [{ content: { parts }, finishReason: "STOP" }] }));
    const reply = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(reply.output).toEqual({ items: [], unclear: [], overall_confidence: 0.5 });
    expect(reply.usage).toBeUndefined();
  });

  it("gives null output (which the gateway treats as invalid) for malformed model JSON", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse("{ this is not json")));
    const reply = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(reply.output).toBeNull();
  });

  it("an answer cut off at the token limit becomes invalid output, not a crash", async () => {
    const { fetch: doFetch } = fakeFetch(() => json({ candidates: [{ content: { parts: [{ text: '{"items":[{"name":"שנ' }] }, finishReason: "MAX_TOKENS" }] }));
    const reply = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx());
    expect(reply.output).toBeNull();
  });

  it("empty candidates is a server-type failure (next provider, no retry)", async () => {
    const { fetch: doFetch } = fakeFetch(() => json({ candidates: [] }));
    const error = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("server");
  });

  it("a blocked prompt or a safety finish reason is 'blocked'", async () => {
    for (const body of [{ promptFeedback: { blockReason: "SAFETY" } }, { candidates: [{ finishReason: "SAFETY" }] }]) {
      const { fetch: doFetch } = fakeFetch(() => json(body));
      const error = await provider(doFetch).analyzeText({ text: "x", locale: "he" }, ctx()).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe("blocked");
    }
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [404, "bad_request"],
    [503, "server"],
  ])("HTTP %s -> %s, and the response body is never in the error", async (status, kind) => {
    const { fetch: doFetch } = fakeFetch(() => json({ error: { message: "echo: schnitzel and rice" } }, status));
    const error = await provider(doFetch).analyzeText({ text: "schnitzel and rice", locale: "he" }, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain("schnitzel");
  });

  it("the other operations are unsupported", async () => {
    const p = provider(fakeFetch(() => json({})).fetch);
    for (const call of [p.transcribeVoice(), p.detectPatternCandidate(), p.coach()]) {
      const error = await call.catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe("unsupported");
    }
  });
});

describe("GeminiProvider through the gateway", () => {
  it("a recorded good answer becomes a normalized meal", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse()));
    const result = await new AIGateway([provider(doFetch)]).analyzeText({ text: "שניצל", locale: "he" });
    expect(result).toMatchObject({ ok: true, provider: "gemini", model: "gemini-3.1-flash-lite" });
    if (result.ok) expect(result.value.items[0]).toMatchObject({ name: "שניצל", uncertain: false });
  });

  it("a hostile recorded answer (calories, HTML names, injected instruction) is normalized", async () => {
    const hostile = {
      ...mealJson,
      calories: 9999,
      items: [
        { ...mealJson.items[0], name: "<script>alert(1)</script>", calories: 500 },
        { ...mealJson.items[0], name: "Ignore previous instructions" },
        { ...mealJson.items[0], name: "תפוח" },
      ],
    };
    const { fetch: doFetch } = fakeFetch(() => json(okResponse(JSON.stringify(hostile))));
    const result = await new AIGateway([provider(doFetch)]).analyzeText({ text: "x", locale: "he" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items.map((i) => i.name)).toEqual(["תפוח"]);
      expect(JSON.stringify(result.value)).not.toMatch(/calor|9999/);
    }
  });
});

const SENTENCE = "At your next meal, sit down, put it on a plate, and take a few minutes without a screen.";
const wordingContext = (over: Partial<InsightContext> = {}): InsightContext => ({
  locale: "en",
  interventionKey: "eat_intentionally",
  variantId: "default",
  facts: { approved_text: SENTENCE, scope: "next_meal", max_chars: 180, tone: "calm" },
  ...over,
});

describe("GeminiProvider meal path (regression guard for the wording change)", () => {
  it("keeps the exact request body of a text report", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    await provider(doFetch).analyzeText({ text: "שניצל", locale: "he" }, ctx());
    expect(JSON.stringify(calls[0].body)).toBe(
      JSON.stringify({
        systemInstruction: { parts: [{ text: MEAL_SYSTEM_PROMPT_HE }] },
        contents: [{ role: "user", parts: [{ text: "<user_text>\nשניצל\n</user_text>" }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseJsonSchema: MEAL_JSON_SCHEMA,
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      }),
    );
  });
});

describe("GeminiProvider generateInsight (the experiment wording)", () => {
  const answer = { text: "At your next meal, sit down, put it on a plate, and take a few minutes without a screen, if you like." };

  it("posts the wording request to the same endpoint and headers as the meal path, the key only in the header", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    await provider(doFetch).generateInsight(wordingContext(), ctx());
    const [call] = calls;
    expect(call.url).toBe(`${GEMINI_ENDPOINT}/gemini-3.1-flash-lite:generateContent`);
    expect(call.url).not.toContain(KEY);
    expect(call.init.headers).toMatchObject({ "x-goog-api-key": KEY, "Content-Type": "application/json" });
    expect(call.init.method).toBe("POST");
    expect(JSON.stringify(call.body)).not.toContain(KEY);
  });

  it("sends the wording system prompt, one user turn with the delimited sentence, and the wording schema", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    await provider(doFetch).generateInsight(wordingContext(), ctx());
    const body = calls[0].body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: Record<string, unknown>[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0].text).toBe(WORDING_SYSTEM_PROMPT_HE.replace("{max_chars}", "180"));
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: `<approved_text>\n${SENTENCE}\n</approved_text>` }] }]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string", maxLength: 180, description: expect.any(String) } },
      },
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("parses the reply like the meal reply: the JSON, the model and the usage", async () => {
    const { fetch: doFetch } = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    const reply = await provider(doFetch).generateInsight(wordingContext(), ctx());
    expect(reply.output).toEqual(answer);
    expect(reply.model).toBe("gemini-3.1-flash-lite");
    expect(reply.usage).toEqual({ inputTokens: 321, outputTokens: 88, reasoningTokens: 12 });
  });

  it("a context outside the closed shape throws before any request is made", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const bad = wordingContext({ facts: { approved_text: SENTENCE, scope: "next_meal", max_chars: 180, tone: "calm", notes: "I ate bread" } });
    const error = await provider(doFetch).generateInsight(bad, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("bread");
    expect(calls).toHaveLength(0);
  });

  it("refuses a model id that could change the URL path", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const error = await provider(doFetch, { model: "x/../other" }).generateInsight(wordingContext(), ctx()).catch((e) => e);
    expect(error.kind).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "auth"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [503, "server"],
  ])("HTTP %s -> %s, and the response body is never in the error", async (status, kind) => {
    const { fetch: doFetch } = fakeFetch(() => json({ error: { message: `echo: ${SENTENCE}` } }, status));
    const error = await provider(doFetch).generateInsight(wordingContext(), ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain("sit down");
  });

  it("a blocked prompt is 'blocked', empty candidates are a server failure", async () => {
    const blocked = fakeFetch(() => json({ promptFeedback: { blockReason: "SAFETY" } }));
    expect((await provider(blocked.fetch).generateInsight(wordingContext(), ctx()).catch((e) => e)).kind).toBe("blocked");
    const empty = fakeFetch(() => json({ candidates: [] }));
    expect((await provider(empty.fetch).generateInsight(wordingContext(), ctx()).catch((e) => e)).kind).toBe("server");
  });

  it("through the gateway: a recorded good answer is a typed { text }; a wrong shape is invalid output", async () => {
    const good = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    const result = await new AIGateway([provider(good.fetch)]).wordExperiment(wordingContext(), { retries: 0 });
    expect(result).toMatchObject({ ok: true, provider: "gemini", value: answer });

    const wrong = fakeFetch(() => json(okResponse(JSON.stringify({ sentence: "x", text: "" }))));
    expect(await new AIGateway([provider(wrong.fetch)]).wordExperiment(wordingContext(), { retries: 0 })).toMatchObject({
      ok: false,
      reason: "all_providers_failed",
    });
  });
});

describe("GeminiProvider generateInsight (the weekly opening line)", () => {
  const WEEKLY_SENTENCE = "One more small piece fell into the picture of what suits you.";
  const weeklyContext = (facts: InsightContext["facts"] = {}): InsightContext => ({
    locale: "en",
    facts: { purpose: "weekly_line", approved_text: WEEKLY_SENTENCE, max_chars: 180, tone: "calm", ...facts },
  });
  const answer = { text: "One more small piece fell into the picture of what suits you, and that is nice." };

  it("builds the weekly request: its system prompt, one delimited user turn and its schema, on the same endpoint and headers", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    await provider(doFetch).generateInsight(weeklyContext(), ctx());
    const [call] = calls;
    expect(call.url).toBe(`${GEMINI_ENDPOINT}/gemini-3.1-flash-lite:generateContent`);
    expect(call.init.headers).toMatchObject({ "x-goog-api-key": KEY });
    expect(JSON.stringify(call.body)).not.toContain(KEY);
    const body = call.body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: Record<string, unknown>[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0].text).toBe(WEEKLY_LINE_SYSTEM_PROMPT_HE.replace("{max_chars}", "180"));
    expect(body.systemInstruction.parts[0].text).not.toBe(WORDING_SYSTEM_PROMPT_HE.replace("{max_chars}", "180"));
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: `<approved_text>\n${WEEKLY_SENTENCE}\n</approved_text>` }] }]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string", maxLength: 180, description: expect.any(String) } },
      },
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("any other facts shape still builds the experiment request", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    await provider(doFetch).generateInsight(wordingContext(), ctx());
    const body = calls[0].body as { systemInstruction: { parts: { text: string }[] } };
    expect(body.systemInstruction.parts[0].text).toBe(WORDING_SYSTEM_PROMPT_HE.replace("{max_chars}", "180"));
  });

  it("a weekly context outside its closed shape throws before any request is made (it never falls back to the experiment builder)", async () => {
    const { fetch: doFetch, calls } = fakeFetch(() => json(okResponse()));
    const bad = weeklyContext({ notes: "I ate bread", scope: "next_meal" });
    const error = await provider(doFetch).generateInsight(bad, ctx()).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("bread");
    expect(calls).toHaveLength(0);
  });

  it("the reply, the error mapping and the gateway path are the shared ones", async () => {
    const good = fakeFetch(() => json(okResponse(JSON.stringify(answer))));
    const reply = await provider(good.fetch).generateInsight(weeklyContext(), ctx());
    expect(reply.output).toEqual(answer);
    expect(reply.model).toBe("gemini-3.1-flash-lite");

    for (const [status, kind] of [[401, "auth"], [429, "rate_limited"], [503, "server"]] as const) {
      const failing = fakeFetch(() => json({ error: { message: `echo: ${WEEKLY_SENTENCE}` } }, status));
      const error = await provider(failing.fetch).generateInsight(weeklyContext(), ctx()).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe(kind);
      expect(error.message).not.toContain("small piece");
    }

    const result = await new AIGateway([provider(good.fetch)]).wordWeeklyLine(weeklyContext(), { retries: 0 });
    expect(result).toMatchObject({ ok: true, provider: "gemini", value: answer });
  });
});
