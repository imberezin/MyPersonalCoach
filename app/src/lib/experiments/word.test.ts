import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_WORDING } from "@/domain/experiments/wording/constants";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import type { checkAiAllowance } from "@/lib/ai/allowance";
import { readAiConfig } from "@/lib/ai/config";
import type { AiRuntime } from "@/lib/ai/factory";
import { AIGateway } from "@/lib/ai/gateway";
import type { logAppError } from "@/lib/ai/ledger";
import { FakeAIProvider, type FakeBehavior } from "@/lib/ai/providers/fake";
import { produceExperimentWording, type WordingDeps, type WordingInput } from "./word";

const original = { ...AI_WORDING };
afterEach(() => {
  Object.assign(AI_WORDING, original);
  vi.restoreAllMocks();
});
const tune = (over: Partial<Record<keyof typeof AI_WORDING, unknown>>) => Object.assign(AI_WORDING, over);

const APPROVED = { he: he.interventions.eat_intentionally.default, en: en.interventions.eat_intentionally.default };

type Allowance = Awaited<ReturnType<typeof checkAiAllowance>>;

interface Harness {
  deps: WordingDeps;
  providerCalls: () => number;
  allowanceCalls: ReturnType<typeof vi.fn>;
  logCalls: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    behavior?: FakeBehavior;
    configured?: boolean;
    dailyCap?: number;
    allowance?: Allowance | "throw";
    providers?: "none" | "fake";
    gateway?: AIGateway;
    logError?: () => Promise<void>;
  } = {},
): Harness {
  let calls = 0;
  const provider = new FakeAIProvider("fake", options.behavior ?? {});
  const original = provider.generateInsight.bind(provider);
  provider.generateInsight = (context, ctx) => {
    calls++;
    return original(context, ctx);
  };
  const base = readAiConfig({}, "development");
  const runtime: AiRuntime = {
    gateway: options.gateway ?? new AIGateway(options.providers === "none" ? [] : [provider]),
    configured: options.configured ?? true,
    providers: options.providers === "none" ? [] : ["fake"],
    config: { ...base, caps: { dailyCalls: options.dailyCap ?? 40, perMinuteCalls: 3 } },
    promptVersion: "meal-v2",
  };
  const allowanceCalls = vi.fn(async () => {
    if (options.allowance === "throw") throw new Error("ledger exploded");
    return options.allowance ?? ({ allowed: true, usedToday: 0 } as Allowance);
  });
  const logCalls = vi.fn(options.logError ?? (async () => undefined));
  return {
    deps: {
      runtime,
      supabase: {} as SupabaseClient,
      userId: "user-1",
      now: new Date("2026-10-07T09:00:00Z"),
      timeZone: "Asia/Jerusalem",
      checkAllowance: allowanceCalls as unknown as typeof checkAiAllowance,
      logError: logCalls as unknown as typeof logAppError,
    },
    providerCalls: () => calls,
    allowanceCalls,
    logCalls,
  };
}

const input = (over: Partial<WordingInput> = {}, locale: "he" | "en" = "he"): WordingInput => ({
  offer: { key: "eat_intentionally", variantId: "default", scope: "next_meal" },
  approvedText: APPROVED[locale],
  locale,
  signal: { view: "CANDIDATE", occurrences: 3, distinctDays: 3 },
  availableDays: 5,
  ...over,
});

describe("produceExperimentWording: the open gate", () => {
  it.each(["he", "en"] as const)("a faithful reword becomes source ai, with the provider and model (%s)", async (locale) => {
    const h = harness();
    const outcome = await produceExperimentWording(h.deps, input({}, locale));
    expect(outcome).toMatchObject({ source: "ai", provider: "fake", model: "fake-1" });
    if (outcome.source === "ai") {
      expect(outcome.text).not.toBe(APPROVED[locale]);
      expect(outcome.text.startsWith(APPROVED[locale].replace(/\.$/, ""))).toBe(true);
    }
    expect(h.providerCalls()).toBe(1);
    expect(h.allowanceCalls).toHaveBeenCalledTimes(1);
    expect(h.logCalls).not.toHaveBeenCalled();
  });

  it("asks the allowance with the user's own time zone and the configured caps", async () => {
    const h = harness({ dailyCap: 25 });
    await produceExperimentWording(h.deps, input());
    expect(h.allowanceCalls).toHaveBeenCalledWith(h.deps.supabase, { now: h.deps.now, timeZone: "Asia/Jerusalem", dailyCap: 25, perMinuteCap: 3 });
  });

  it("a VALIDATED pattern opens it too", async () => {
    const outcome = await produceExperimentWording(harness().deps, input({ signal: { view: "VALIDATED", occurrences: 5, distinctDays: 5 } }));
    expect(outcome.source).toBe("ai");
  });
});

describe("produceExperimentWording: a closed gate shows the library text, calls no provider", () => {
  const closed = async (h: Harness, i: WordingInput) => {
    const outcome = await produceExperimentWording(h.deps, i);
    expect(outcome.source).toBe("library");
    expect(outcome.text).toBe(i.approvedText);
    expect(h.providerCalls()).toBe(0);
    return outcome as Extract<typeof outcome, { source: "library" }>;
  };

  it("switch_off comes first and reads nothing", async () => {
    tune({ enabled: false });
    const h = harness();
    expect((await closed(h, input())).reason).toBe("switch_off");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it("ai_unconfigured: the runtime says the AI is not configured", async () => {
    const h = harness({ configured: false });
    expect((await closed(h, input())).reason).toBe("ai_unconfigured");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it.each(["NONE", "EARLY_SIGNAL", "REJECTED"] as const)("pattern_not_established for a %s pattern", async (view) => {
    const h = harness();
    expect((await closed(h, input({ signal: { view, occurrences: 3, distinctDays: 3 } }))).reason).toBe("pattern_not_established");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it("too_few_occurrences and too_few_days (distinct days, and available days)", async () => {
    let h = harness();
    expect((await closed(h, input({ signal: { view: "CANDIDATE", occurrences: 2, distinctDays: 2 } }))).reason).toBe("too_few_occurrences");
    h = harness();
    expect((await closed(h, input({ signal: { view: "CANDIDATE", occurrences: 3, distinctDays: 2 } }))).reason).toBe("too_few_days");
    h = harness();
    expect((await closed(h, input({ availableDays: 3 }))).reason).toBe("too_few_days");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it("the allowance is read only after the pre-check passed, and its own refusal names the reason", async () => {
    for (const [allowance, reason] of [
      [{ allowed: false, reason: "daily_cap" }, "allowance_daily_cap"],
      [{ allowed: false, reason: "rate_limited" }, "allowance_rate_limited"],
      [{ allowed: false, reason: "ledger_unavailable" }, "allowance_ledger_unavailable"],
    ] as const) {
      const h = harness({ allowance });
      expect((await closed(h, input())).reason).toBe(reason);
      expect(h.allowanceCalls).toHaveBeenCalledTimes(1);
    }
  });

  it("an allowance read that throws is allowance_ledger_unavailable", async () => {
    const h = harness({ allowance: "throw" });
    expect((await closed(h, input())).reason).toBe("allowance_ledger_unavailable");
  });

  it("the pre-check uses a placeholder allowance and an infinite cap: with the real cap 0 the reason is the allowance's own, with cap 9 it is the reserve", async () => {
    const zero = harness({ dailyCap: 0, allowance: { allowed: false, reason: "daily_cap" } });
    expect((await closed(zero, input())).reason).toBe("allowance_daily_cap");

    const nine = harness({ dailyCap: 9, allowance: { allowed: true, usedToday: 0 } });
    expect((await closed(nine, input())).reason).toBe("allowance_reserve");
  });

  it("the reserve boundary: usedToday + 10 = cap is open, one more is closed", async () => {
    expect((await produceExperimentWording(harness({ dailyCap: 40, allowance: { allowed: true, usedToday: 30 } }).deps, input())).source).toBe("ai");
    const h = harness({ dailyCap: 40, allowance: { allowed: true, usedToday: 31 } });
    expect((await closed(h, input())).reason).toBe("allowance_reserve");
  });
});

describe("produceExperimentWording: any failure after the gate falls back to the library text", () => {
  const library = async (behavior: FakeBehavior, locale: "he" | "en" = "he") => {
    const h = harness({ behavior });
    const outcome = await produceExperimentWording(h.deps, input({}, locale));
    expect(outcome.source).toBe("library");
    expect(outcome.text).toBe(APPROVED[locale]);
    return { outcome: outcome as Extract<typeof outcome, { source: "library" }>, h };
  };

  it.each([
    ["wording_numbers", "rejected_digits"],
    ["wording_advice", "rejected_advice"],
    ["wording_food", "rejected_foods"],
    ["wording_negate", "rejected_negation"],
    ["wording_long", "rejected_length"],
  ] as const)("%s is rejected by the validator: %s", async (wordingBehavior, reason) => {
    for (const locale of ["he", "en"] as const) {
      const { outcome, h } = await library({ wording: wordingBehavior }, locale);
      expect(outcome.reason).toBe(reason);
      expect(h.providerCalls()).toBe(1);
      expect(h.logCalls).toHaveBeenCalledWith({ userId: "user-1", area: "ai", message: "wording_rejected", context: { check: reason.replace("rejected_", "") } });
    }
  });

  it("a provider that is down is provider_failed, and a rate limit too", async () => {
    expect((await library({ wording: "wording_fail" })).outcome.reason).toBe("provider_failed");
    const { outcome, h } = await library({ failWith: "rate_limited" });
    expect(outcome.reason).toBe("provider_failed");
    expect(h.logCalls).toHaveBeenCalledWith({ userId: "user-1", area: "ai", message: "wording_failed", context: { kind: "provider_failed" } });
  });

  it("a wrong shape is invalid_output (one attempt: retries are 0)", async () => {
    const { outcome, h } = await library({ wording: "wording_invalid" });
    expect(outcome.reason).toBe("invalid_output");
    expect(h.providerCalls()).toBe(1);
  });

  it("a provider that never answers is provider_failed after the attempt timeout", async () => {
    tune({ attemptTimeoutMs: 20, totalBudgetMs: 9_000 });
    const { outcome } = await library({ wording: "wording_slow" });
    expect(outcome.reason).toBe("provider_failed");
  });

  it("a total budget under the minimum attempt is budget_exhausted, with no provider call", async () => {
    tune({ totalBudgetMs: 1_000 });
    const { outcome, h } = await library({});
    expect(outcome.reason).toBe("budget_exhausted");
    expect(h.providerCalls()).toBe(0);
  });

  it("no providers at all (but configured) is no_providers", async () => {
    const h = harness({ providers: "none" });
    const outcome = await produceExperimentWording(h.deps, input());
    expect(outcome).toEqual({ source: "library", text: APPROVED.he, reason: "no_providers" });
  });

  it("passes the timeouts, the budget and zero retries from AI_WORDING to the gateway", async () => {
    const h = harness();
    const wordExperiment = vi.spyOn(h.deps.runtime.gateway, "wordExperiment");
    await produceExperimentWording(h.deps, input());
    expect(wordExperiment).toHaveBeenCalledTimes(1);
    expect(wordExperiment.mock.calls[0][1]).toEqual({ timeoutMs: 12_000, totalBudgetMs: 13_000, retries: 0 });
    // The closed fact shape, nothing else.
    expect(wordExperiment.mock.calls[0][0]).toEqual({
      locale: "he",
      interventionKey: "eat_intentionally",
      variantId: "default",
      facts: {
        approved_text: APPROVED.he,
        scope: "next_meal",
        max_chars: 140,
        tone: "calm",
        // wording-v2: derived from the approved sentence alone, never typed in by a caller.
        anchors: JSON.stringify({ verbatim: ["כמה דקות", "בלי מסך"], actions: ["בארוחה", "הבאה", "שים", "בצלחת", "וקח"] }),
      },
    });
  });
});

describe("produceExperimentWording: never throws, never logs content", () => {
  it("whatever the dependencies do", async () => {
    const rejecting = new AIGateway([new FakeAIProvider()]);
    vi.spyOn(rejecting, "wordExperiment").mockRejectedValue(new Error("gateway exploded"));
    const outcome = await produceExperimentWording(harness({ gateway: rejecting }).deps, input());
    expect(outcome).toEqual({ source: "library", text: APPROVED.he, reason: "provider_failed" });

    const throwingLog = harness({ behavior: { wording: "wording_numbers" }, logError: () => Promise.reject(new Error("log down")) });
    expect(await produceExperimentWording(throwingLog.deps, input())).toMatchObject({ source: "library", reason: "rejected_digits" });

    const throwingAllowance = harness({ allowance: "throw" });
    await expect(produceExperimentWording(throwingAllowance.deps, input())).resolves.toMatchObject({ source: "library" });
  });

  it("an approved sentence that cannot be sent (over 400 characters) is refused before any provider attempt", async () => {
    const h = harness();
    const outcome = await produceExperimentWording(h.deps, input({ approvedText: "ש".repeat(401) }));
    expect(outcome).toMatchObject({ source: "library", reason: "provider_failed" });
    expect(h.providerCalls()).toBe(0);
  });

  it("the library text is the SAME string the caller passed", async () => {
    const approved = `${APPROVED.he}`;
    const outcome = await produceExperimentWording(harness({ behavior: { wording: "wording_food" } }).deps, input({ approvedText: approved }));
    expect(outcome.text).toBe(approved);
  });

  it("no console call and no logError argument contains the candidate or the approved text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const secrets = [APPROVED.he, APPROVED.en, "SHIRA-the-person-typed-this"];
    for (const behavior of [{ wording: "wording_numbers" }, { wording: "wording_fail" }, { wording: "wording_invalid" }, { wording: "wording_negate" }] as const) {
      for (const locale of ["he", "en"] as const) {
        const h = harness({ behavior });
        await produceExperimentWording(h.deps, input({}, locale));
        const logged = JSON.stringify(h.logCalls.mock.calls);
        for (const secret of secrets) expect(logged).not.toContain(secret.slice(0, 12));
        // Candidate words (the fake appends ", אם בא לך" / "for 5 more minutes") never reach the log either.
        expect(logged).not.toMatch(/אם בא לך|5 more|chocolate|שוקולד|should|כדאי/);
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
