import { describe, expect, it } from "vitest";
import { validateWording, type WordingCheck } from "@/domain/experiments/wording/validate";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { experimentWordingSchema } from "../schemas";
import type { InsightContext } from "../types";
import { FakeAIProvider, WORDING_BEHAVIORS, parseWordingBehavior, type WordingBehavior } from "./fake";

type Locale = "he" | "en";

const APPROVED = {
  he: he.interventions.eat_intentionally.default,
  en: en.interventions.eat_intentionally.default,
};

const contextFor = (locale: Locale, approved = APPROVED[locale]): InsightContext => ({
  locale,
  interventionKey: "eat_intentionally",
  variantId: "default",
  facts: { approved_text: approved, scope: "next_meal", max_chars: locale === "he" ? 140 : 180, tone: "calm" },
});

const signal = () => new AbortController().signal;

async function candidateOf(behavior: WordingBehavior | undefined, locale: Locale, approved = APPROVED[locale]): Promise<string> {
  const provider = new FakeAIProvider("fake", { wording: behavior });
  const reply = await provider.generateInsight(contextFor(locale, approved), { signal: signal() });
  return experimentWordingSchema.parse(reply.output).text;
}

function checkOf(candidate: string, locale: Locale, approved = APPROVED[locale]): WordingCheck | "ok" {
  const result = validateWording({ candidate, approved, locale });
  return result.ok ? "ok" : result.check;
}

describe("FakeAIProvider.generateInsight: wording behaviors", () => {
  it("lists the behaviors and parses AI_FAKE_BEHAVIOR (unknown or empty values are ignored)", () => {
    expect([...WORDING_BEHAVIORS]).toEqual([
      "wording_ok",
      "wording_fail",
      "wording_invalid",
      "wording_numbers",
      "wording_advice",
      "wording_food",
      "wording_negate",
      "wording_long",
      "wording_slow",
    ]);
    expect(parseWordingBehavior("wording_negate")).toBe("wording_negate");
    expect(parseWordingBehavior(" Wording_OK ")).toBe("wording_ok");
    for (const value of [undefined, "", "nonsense", "fail", "wording_", "__proto__"]) expect(parseWordingBehavior(value)).toBeUndefined();
  });

  it.each(["he", "en"] as const)("wording_ok (the default) is a faithful reword that passes every check, in %s", async (locale) => {
    const text = await candidateOf(undefined, locale);
    expect(text).not.toBe(APPROVED[locale]);
    expect(checkOf(text, locale)).toBe("ok");
    expect(await candidateOf("wording_ok", locale)).toBe(text);
  });

  it("the English happy path comes back in English with the English tail", async () => {
    const text = await candidateOf("wording_ok", "en");
    expect(text).toBe("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, if you like.");
    expect(await candidateOf("wording_ok", "he")).toBe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, אם בא לך.");
  });

  it.each([
    ["wording_negate", "negation"],
    ["wording_numbers", "digits"],
    ["wording_advice", "advice"],
    ["wording_food", "foods"],
    ["wording_long", "length"],
  ] as const)("%s makes exactly the check %s fail, first, in both locales", async (behavior, expected) => {
    for (const locale of ["he", "en"] as const) {
      const text = await candidateOf(behavior, locale);
      expect(checkOf(text, locale), `${locale}: ${behavior}`).toBe(expected);
    }
  });

  it("wording_negate drops the approved sentence's negator, or adds one where there is none", async () => {
    expect(await candidateOf("wording_negate", "en")).toContain("with a screen");
    expect(await candidateOf("wording_negate", "en")).not.toContain("without");
    expect(await candidateOf("wording_negate", "he")).not.toContain("בלי");
    const walk = { he: he.interventions.micro_walk.default, en: en.interventions.micro_walk.default };
    for (const locale of ["he", "en"] as const) {
      const text = await candidateOf("wording_negate", locale, walk[locale]);
      expect(checkOf(text, locale, walk[locale]), locale).toBe("negation");
    }
  });

  it("wording_long is about 300 characters, under the 400-character wire bound", async () => {
    for (const locale of ["he", "en"] as const) {
      const text = await candidateOf("wording_long", locale);
      expect(text).toHaveLength(300);
    }
  });

  it("wording_fail throws a plain error, as a provider that is down", async () => {
    const provider = new FakeAIProvider("fake", { wording: "wording_fail" });
    await expect(provider.generateInsight(contextFor("he"), { signal: signal() })).rejects.toThrow("provider_down");
  });

  it("wording_invalid answers the wrong shape, which the schema rejects", async () => {
    const provider = new FakeAIProvider("fake", { wording: "wording_invalid" });
    const reply = await provider.generateInsight(contextFor("he"), { signal: signal() });
    expect(experimentWordingSchema.safeParse(reply.output).success).toBe(false);
  });

  it("wording_slow never answers until the attempt is aborted", async () => {
    const provider = new FakeAIProvider("fake", { wording: "wording_slow" });
    const controller = new AbortController();
    const pending = provider.generateInsight(contextFor("en"), { signal: controller.signal });
    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const already = new AbortController();
    already.abort();
    await expect(provider.generateInsight(contextFor("en"), { signal: already.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("the generic flags still apply to a wording request (fail, failWith, invalid)", async () => {
    await expect(new FakeAIProvider("f", { fail: true }).generateInsight(contextFor("he"), { signal: signal() })).rejects.toThrow("provider_down");
    await expect(new FakeAIProvider("f", { failWith: "rate_limited" }).generateInsight(contextFor("he"), { signal: signal() })).rejects.toMatchObject({
      kind: "rate_limited",
    });
    const reply = await new FakeAIProvider("f", { invalid: true }).generateInsight(contextFor("he"), { signal: signal() });
    expect(experimentWordingSchema.safeParse(reply.output).success).toBe(false);
  });

  it("an insight context without an approved sentence keeps the old fixed answer", async () => {
    const reply = await new FakeAIProvider().generateInsight({ locale: "en", facts: {} }, { signal: signal() });
    expect(reply.output).toEqual({ text: "Something small I noticed." });
  });

  it("the answer carries usage and the fake model, like the other operations", async () => {
    const reply = await new FakeAIProvider().generateInsight(contextFor("en"), { signal: signal() });
    expect(reply.model).toBe("fake-1");
    expect(reply.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});
