import { describe, expect, it } from "vitest";
import { AIGateway } from "./gateway";
import { FakeAIProvider } from "./providers/fake";

const mealInput = { text: "schnitzel and rice", locale: "en" as const };

describe("AIGateway", () => {
  it("returns a validated value from the first working provider", async () => {
    const gateway = new AIGateway([new FakeAIProvider("a"), new FakeAIProvider("b")]);
    const result = await gateway.analyzeMeal(mealInput);
    expect(result).toMatchObject({ ok: true, provider: "a" });
    if (result.ok) expect(result.value.items[0].food).toBe("schnitzel");
  });

  it("falls back to the next provider when one is down", async () => {
    const gateway = new AIGateway([new FakeAIProvider("a", { fail: true }), new FakeAIProvider("b")]);
    const result = await gateway.analyzeMeal(mealInput);
    expect(result).toMatchObject({ ok: true, provider: "b" });
  });

  it("does not trust invalid output: it retries once, then falls back", async () => {
    let calls = 0;
    const flaky = new FakeAIProvider("flaky", { invalid: true });
    const original = flaky.analyzeMeal.bind(flaky);
    flaky.analyzeMeal = () => {
      calls++;
      return original();
    };
    const gateway = new AIGateway([flaky, new FakeAIProvider("good")]);
    const result = await gateway.analyzeMeal(mealInput);
    expect(calls).toBe(2); // first try + one retry
    expect(result).toMatchObject({ ok: true, provider: "good" });
  });

  it("times out a slow provider and moves on", async () => {
    const slow = new FakeAIProvider("slow");
    slow.analyzeMeal = () => new Promise(() => {});
    const gateway = new AIGateway([slow, new FakeAIProvider("fast")], { timeoutMs: 20 });
    const result = await gateway.analyzeMeal(mealInput);
    expect(result).toMatchObject({ ok: true, provider: "fast" });
  });

  it("never throws: when every provider fails it returns a result the UI can handle", async () => {
    const gateway = new AIGateway([new FakeAIProvider("a", { fail: true }), new FakeAIProvider("b", { invalid: true })], {
      retriesOnInvalidOutput: 0,
    });
    const result = await gateway.analyzeMeal(mealInput);
    expect(result).toEqual({
      ok: false,
      reason: "all_providers_failed",
      attempts: [
        { provider: "a", error: "provider_down" },
        { provider: "b", error: "invalid_output" },
      ],
    });
  });

  it("reports when there are no providers", async () => {
    const result = await new AIGateway([]).analyzeMeal(mealInput);
    expect(result).toMatchObject({ ok: false, reason: "no_providers" });
  });

  it("validates the other operations too", async () => {
    const gateway = new AIGateway([new FakeAIProvider()]);
    expect(await gateway.transcribeVoice({ audio: new Uint8Array(), mime: "audio/webm", locale: "en" })).toMatchObject({ ok: true });
    expect(await gateway.detectPatternCandidate([])).toMatchObject({ ok: true });
    expect(await gateway.coach([], { locale: "en", facts: {} })).toMatchObject({ ok: true });
  });
});
