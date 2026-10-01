import { describe, expect, it } from "vitest";
import { AIGateway } from "./gateway";
import { FakeAIProvider } from "./providers/fake";
import { ProviderError, type AiCallRecord, type AIRecorder } from "./types";

const mealInput = { text: "schnitzel and rice", locale: "en" as const };

function collector() {
  const records: AiCallRecord[] = [];
  const recorder: AIRecorder = { record: (rec) => void records.push(rec) };
  return { records, recorder };
}

describe("AIGateway", () => {
  it("returns a validated value from the first working provider, with its model", async () => {
    const gateway = new AIGateway([new FakeAIProvider("a"), new FakeAIProvider("b")]);
    const result = await gateway.analyzeMeal(mealInput);
    expect(result).toMatchObject({ ok: true, provider: "a", model: "fake-1" });
    if (result.ok) expect(result.value.items[0].name).toBe("schnitzel");
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
    flaky.analyzeMeal = (input, ctx) => {
      calls++;
      return original(input, ctx);
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

  it("aborts the signal of an attempt that timed out, so no fetch dangles", async () => {
    const slow = new FakeAIProvider("slow");
    let signal: AbortSignal | undefined;
    slow.analyzeMeal = (_input, ctx) => {
      signal = ctx.signal;
      return new Promise(() => {});
    };
    await new AIGateway([slow], { timeoutMs: 20 }).analyzeMeal(mealInput);
    expect(signal?.aborted).toBe(true);
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

  it("does not retry a rate limit or a server error: it goes straight to the next provider", async () => {
    let calls = 0;
    const limited = new FakeAIProvider("limited", { failWith: "rate_limited" });
    const original = limited.analyzeMeal.bind(limited);
    limited.analyzeMeal = (input, ctx) => {
      calls++;
      return original(input, ctx);
    };
    const result = await new AIGateway([limited, new FakeAIProvider("next")]).analyzeMeal(mealInput);
    expect(calls).toBe(1);
    expect(result).toMatchObject({ ok: true, provider: "next" });
  });

  it("uses a per-call timeout when one is given", async () => {
    const slow = new FakeAIProvider("slow");
    slow.analyzeMeal = () => new Promise(() => {});
    const started = Date.now();
    const result = await new AIGateway([slow], { timeoutMs: 10_000 }).analyzeMeal(mealInput, { timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: "all_providers_failed" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  describe("recorder", () => {
    it("is called once per attempt, retries and timeouts included, with the right outcome", async () => {
      const { records, recorder } = collector();
      const slow = new FakeAIProvider("slow");
      slow.analyzeMeal = () => new Promise(() => {});
      const gateway = new AIGateway([slow, new FakeAIProvider("bad", { invalid: true }), new FakeAIProvider("limited", { failWith: "rate_limited" }), new FakeAIProvider("good")], {
        timeoutMs: 20,
        recorder,
      });
      const result = await gateway.analyzeMeal(mealInput);
      expect(result).toMatchObject({ ok: true, provider: "good" });
      expect(records.map((r) => [r.provider, r.outcome, r.errorKind])).toEqual([
        ["slow", "timeout", null],
        ["bad", "invalid_output", null],
        ["bad", "invalid_output", null], // the one repair retry
        ["limited", "error", "rate_limited"],
        ["good", "ok", null],
      ]);
      const ok = records[records.length - 1];
      expect(ok).toMatchObject({ operation: "analyzeText", model: "fake-1", inputTokens: 10, outputTokens: 20 });
      expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("names the operation for text and records nothing for the operations outside the ledger", async () => {
      const { records, recorder } = collector();
      const gateway = new AIGateway([new FakeAIProvider()], { recorder });
      await gateway.analyzeText({ text: "x", locale: "en" });
      await gateway.coach([], { locale: "en", facts: {} });
      expect(records).toHaveLength(1);
      expect(records[0].operation).toBe("analyzeText");
    });

    it("names the operation by what was sent: a photo is analyzeMeal, text through analyzeMeal is analyzeText", async () => {
      const { records, recorder } = collector();
      const gateway = new AIGateway([new FakeAIProvider()], { recorder });
      await gateway.analyzeMeal({ image: { bytes: new Uint8Array([1]), mime: "image/jpeg" }, locale: "he" });
      await gateway.analyzeMeal({ text: "x", locale: "he" });
      expect(records.map((r) => r.operation)).toEqual(["analyzeMeal", "analyzeText"]);
    });

    it("never changes the result when it throws or hangs", async () => {
      const throwing: AIRecorder = {
        record() {
          throw new Error("ledger down");
        },
      };
      expect(await new AIGateway([new FakeAIProvider()], { recorder: throwing }).analyzeMeal(mealInput)).toMatchObject({ ok: true });

      const rejecting: AIRecorder = { record: () => Promise.reject(new Error("ledger down")) };
      expect(await new AIGateway([new FakeAIProvider()], { recorder: rejecting }).analyzeMeal(mealInput)).toMatchObject({ ok: true });
    });

    it("is not waited for longer than its cap", async () => {
      const hanging: AIRecorder = { record: () => new Promise(() => {}) };
      const started = Date.now();
      const result = await new AIGateway([new FakeAIProvider()], { recorder: hanging }).analyzeMeal(mealInput);
      expect(result).toMatchObject({ ok: true });
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });

  describe("total budget", () => {
    it("does not start an attempt when under 2 s are left, and says so", async () => {
      let now = 0;
      const providers = ["a", "b", "c"].map((id) => {
        const p = new FakeAIProvider(id);
        p.analyzeMeal = () => {
          now += 4_000; // each attempt "takes" 4 s on the injected clock, then fails
          return Promise.reject(new ProviderError("server"));
        };
        return p;
      });
      const result = await new AIGateway(providers, { totalBudgetMs: 9_000, clock: () => now }).analyzeMeal(mealInput);
      // a: 9 s left -> runs (now 4 s). b: 5 s left -> runs (now 8 s). c: 1 s left -> not started.
      expect(result).toMatchObject({ ok: false, reason: "budget_exhausted" });
      if (!result.ok) expect(result.attempts.map((a) => a.provider)).toEqual(["a", "b"]);
    });

    it("caps an attempt at the time that is left", async () => {
      let now = 0;
      const slow = new FakeAIProvider("slow");
      let signal: AbortSignal | undefined;
      slow.analyzeMeal = (_input, ctx) => {
        signal = ctx.signal;
        now += 100; // the injected clock barely moves; the real timer is what ends the attempt
        return new Promise(() => {});
      };
      // 2.05 s left on the injected clock, per-attempt timeout 10 s: the attempt gets min(10 s, 2.05 s).
      const started = Date.now();
      const gateway = new AIGateway([slow], { timeoutMs: 10_000, totalBudgetMs: 2_050, clock: () => now });
      const result = await gateway.analyzeMeal(mealInput);
      expect(result).toMatchObject({ ok: false });
      expect(signal?.aborted).toBe(true);
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });
});
