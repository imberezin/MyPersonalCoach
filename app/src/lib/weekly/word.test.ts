import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_WORDING } from "@/domain/experiments/wording/constants";
import { WEEKLY_FLOW, type OpeningMode } from "@/domain/weekly/types";
import type { checkAiAllowance } from "@/lib/ai/allowance";
import { readAiConfig } from "@/lib/ai/config";
import type { AiRuntime } from "@/lib/ai/factory";
import { AIGateway } from "@/lib/ai/gateway";
import type { logAppError } from "@/lib/ai/ledger";
import { FakeAIProvider, WORDING_BEHAVIORS, type FakeBehavior } from "@/lib/ai/providers/fake";
import type { AiCallRecord, AIRecorder } from "@/lib/ai/types";
import { produceWeeklyLineWording, type WeeklyLineDeps, type WeeklyLineInput } from "./word";

const originalWording = { ...AI_WORDING };
const originalFlow = { ...WEEKLY_FLOW };
afterEach(() => {
  Object.assign(AI_WORDING, originalWording);
  Object.assign(WEEKLY_FLOW, originalFlow);
  vi.restoreAllMocks();
});
const tune = (over: Partial<Record<keyof typeof AI_WORDING, unknown>>) => Object.assign(AI_WORDING, over);

// The LEARN sentence of the weekly catalog (blueprint section 10, key weekly.line.learn).
const APPROVED = {
  he: "עוד חלק קטן נכנס לתמונה של מה שמתאים לך.",
  en: "One more small piece fell into the picture of what suits you.",
};

type Allowance = Awaited<ReturnType<typeof checkAiAllowance>>;

interface Harness {
  deps: WeeklyLineDeps;
  providerCalls: () => number;
  allowanceCalls: ReturnType<typeof vi.fn>;
  logCalls: ReturnType<typeof vi.fn>;
  /** The ledger rows the gateway recorded (one per provider attempt). */
  records: AiCallRecord[];
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
  const records: AiCallRecord[] = [];
  const recorder: AIRecorder = { record: (rec) => void records.push(rec) };
  const provider = new FakeAIProvider("fake", options.behavior ?? {});
  const original = provider.generateInsight.bind(provider);
  provider.generateInsight = (context, ctx) => {
    calls++;
    return original(context, ctx);
  };
  const base = readAiConfig({}, "development");
  const runtime: AiRuntime = {
    gateway: options.gateway ?? new AIGateway(options.providers === "none" ? [] : [provider], { recorder }),
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
      now: new Date("2026-10-18T09:00:00Z"),
      timeZone: "Asia/Jerusalem",
      checkAllowance: allowanceCalls as unknown as typeof checkAiAllowance,
      logError: logCalls as unknown as typeof logAppError,
    },
    providerCalls: () => calls,
    allowanceCalls,
    logCalls,
    records,
  };
}

const input = (over: Partial<WeeklyLineInput> = {}, locale: "he" | "en" = "he"): WeeklyLineInput => ({
  mode: "LEARN",
  lineKey: "learn",
  approvedText: APPROVED[locale],
  locale,
  availableDays: 5,
  ...over,
});

describe("produceWeeklyLineWording: the open gate", () => {
  it.each(["he", "en"] as const)("a faithful reword becomes source ai, with the provider and model (%s)", async (locale) => {
    const h = harness();
    const outcome = await produceWeeklyLineWording(h.deps, input({}, locale));
    expect(outcome).toMatchObject({ source: "ai", provider: "fake", model: "fake-1" });
    if (outcome.source === "ai") {
      expect(outcome.text).not.toBe(APPROVED[locale]);
      expect(outcome.text.startsWith(APPROVED[locale].replace(/\.$/, ""))).toBe(true);
    }
    expect(h.providerCalls()).toBe(1);
    expect(h.allowanceCalls).toHaveBeenCalledTimes(1);
    expect(h.logCalls).not.toHaveBeenCalled();
    expect(h.records.map((r) => [r.operation, r.provider, r.outcome])).toEqual([["wordWeeklyLine", "fake", "ok"]]);
  });

  it("asks the allowance with the user's own time zone and the configured caps", async () => {
    const h = harness({ dailyCap: 25 });
    await produceWeeklyLineWording(h.deps, input());
    expect(h.allowanceCalls).toHaveBeenCalledWith(h.deps.supabase, { now: h.deps.now, timeZone: "Asia/Jerusalem", dailyCap: 25, perMinuteCap: 3 });
  });
});

describe("produceWeeklyLineWording: a closed gate shows the catalog sentence, calls no provider, writes no ledger row", () => {
  const closed = async (h: Harness, i: WeeklyLineInput) => {
    const outcome = await produceWeeklyLineWording(h.deps, i);
    expect(outcome.source).toBe("catalog");
    expect(outcome.text).toBe(i.approvedText);
    expect(h.providerCalls()).toBe(0);
    expect(h.records).toEqual([]);
    return outcome as Extract<typeof outcome, { source: "catalog" }>;
  };

  it("the weekly switch comes first and reads nothing", async () => {
    Object.assign(WEEKLY_FLOW, { aiLineEnabled: false });
    const h = harness();
    expect((await closed(h, input())).reason).toBe("switch_off");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it("the First Week's master wording switch closes it too", async () => {
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

  it.each(["CELEBRATE", "RECOVER", "RESET"] as const)("mode_fixed_text for %s: the sentence is derived from weights or is Brand wording", async (mode: OpeningMode) => {
    const h = harness();
    expect((await closed(h, input({ mode, lineKey: mode === "CELEBRATE" ? "celebrateMilestone" : mode === "RECOVER" ? "recover" : "quiet" }))).reason).toBe(
      "mode_fixed_text",
    );
    expect(h.allowanceCalls).not.toHaveBeenCalled();
  });

  it("too_few_days: 3 available days is closed, before the allowance is read", async () => {
    const h = harness();
    expect((await closed(h, input({ availableDays: 3 }))).reason).toBe("too_few_days");
    expect(h.allowanceCalls).not.toHaveBeenCalled();
    expect((await produceWeeklyLineWording(harness().deps, input({ availableDays: 4 }))).source).toBe("ai");
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
    expect((await produceWeeklyLineWording(harness({ dailyCap: 40, allowance: { allowed: true, usedToday: 30 } }).deps, input())).source).toBe("ai");
    const h = harness({ dailyCap: 40, allowance: { allowed: true, usedToday: 31 } });
    expect((await closed(h, input())).reason).toBe("allowance_reserve");
  });
});

describe("produceWeeklyLineWording: any failure after the gate falls back to the catalog sentence, byte for byte", () => {
  const catalog = async (behavior: FakeBehavior, locale: "he" | "en" = "he") => {
    const h = harness({ behavior });
    const outcome = await produceWeeklyLineWording(h.deps, input({}, locale));
    expect(outcome.source).toBe("catalog");
    expect(outcome.text).toBe(APPROVED[locale]);
    return { outcome: outcome as Extract<typeof outcome, { source: "catalog" }>, h };
  };

  it.each([
    ["wording_numbers", "rejected_digits"],
    ["wording_advice", "rejected_advice"],
    ["wording_food", "rejected_foods"],
    ["wording_negate", "rejected_negation"],
    ["wording_long", "rejected_length"],
  ] as const)("%s is rejected by the validator: %s", async (wordingBehavior, reason) => {
    for (const locale of ["he", "en"] as const) {
      const { outcome, h } = await catalog({ wording: wordingBehavior }, locale);
      expect(outcome.reason).toBe(reason);
      expect(h.providerCalls()).toBe(1);
      expect(h.records.map((r) => [r.operation, r.outcome])).toEqual([["wordWeeklyLine", "ok"]]);
      expect(h.logCalls).toHaveBeenCalledWith({ userId: "user-1", area: "ai", message: "weekly_line_rejected", context: { check: reason.replace("rejected_", "") } });
    }
  });

  it("a provider that is down is provider_failed, and a rate limit too", async () => {
    const down = await catalog({ wording: "wording_fail" });
    expect(down.outcome.reason).toBe("provider_failed");
    expect(down.h.records.map((r) => r.outcome)).toEqual(["error"]);
    const { outcome, h } = await catalog({ failWith: "rate_limited" });
    expect(outcome.reason).toBe("provider_failed");
    expect(h.logCalls).toHaveBeenCalledWith({ userId: "user-1", area: "ai", message: "weekly_line_failed", context: { kind: "provider_failed" } });
  });

  it("a wrong shape is invalid_output (one attempt: retries are 0)", async () => {
    const { outcome, h } = await catalog({ wording: "wording_invalid" });
    expect(outcome.reason).toBe("invalid_output");
    expect(h.providerCalls()).toBe(1);
    expect(h.records.map((r) => r.outcome)).toEqual(["invalid_output"]);
  });

  it("a provider that never answers is provider_failed after the attempt timeout", async () => {
    tune({ attemptTimeoutMs: 20, totalBudgetMs: 9_000 });
    const { outcome, h } = await catalog({ wording: "wording_slow" });
    expect(outcome.reason).toBe("provider_failed");
    expect(h.records.map((r) => r.outcome)).toEqual(["timeout"]);
  });

  it("a total budget under the minimum attempt is budget_exhausted, with no provider call", async () => {
    tune({ totalBudgetMs: 1_000 });
    const { outcome, h } = await catalog({});
    expect(outcome.reason).toBe("budget_exhausted");
    expect(h.providerCalls()).toBe(0);
  });

  it("no providers at all (but configured) is no_providers", async () => {
    const h = harness({ providers: "none" });
    const outcome = await produceWeeklyLineWording(h.deps, input());
    expect(outcome).toEqual({ source: "catalog", text: APPROVED.he, reason: "no_providers" });
  });

  it("every wording behavior of AI_FAKE_BEHAVIOR other than the default ends in the catalog sentence with a matching reason", async () => {
    const reasons: Record<string, string> = {
      wording_fail: "provider_failed",
      wording_invalid: "invalid_output",
      wording_numbers: "rejected_digits",
      wording_advice: "rejected_advice",
      wording_food: "rejected_foods",
      wording_long: "rejected_length",
      wording_negate: "rejected_negation",
      wording_slow: "provider_failed",
    };
    tune({ attemptTimeoutMs: 20 });
    for (const behavior of WORDING_BEHAVIORS) {
      for (const locale of ["he", "en"] as const) {
        const h = harness({ behavior: { wording: behavior } });
        const outcome = await produceWeeklyLineWording(h.deps, input({}, locale));
        if (behavior === "wording_ok") {
          expect(outcome.source).toBe("ai");
          continue;
        }
        expect(outcome).toEqual({ source: "catalog", text: APPROVED[locale], reason: reasons[behavior] });
      }
    }
  });

  it("passes the timeouts, the budget and zero retries from AI_WORDING to the gateway, and the closed fact shape and nothing else", async () => {
    const h = harness();
    const wordWeeklyLine = vi.spyOn(h.deps.runtime.gateway, "wordWeeklyLine");
    await produceWeeklyLineWording(h.deps, input());
    expect(wordWeeklyLine).toHaveBeenCalledTimes(1);
    expect(wordWeeklyLine.mock.calls[0][1]).toEqual({ timeoutMs: 12_000, totalBudgetMs: 13_000, retries: 0 });
    expect(wordWeeklyLine.mock.calls[0][0]).toEqual({
      locale: "he",
      facts: { purpose: "weekly_line", approved_text: APPROVED.he, max_chars: 140, tone: "calm" },
    });
  });

  it("an English line asks for the English cap", async () => {
    const h = harness();
    const wordWeeklyLine = vi.spyOn(h.deps.runtime.gateway, "wordWeeklyLine");
    await produceWeeklyLineWording(h.deps, input({}, "en"));
    expect(wordWeeklyLine.mock.calls[0][0]).toMatchObject({ locale: "en", facts: { max_chars: 180 } });
  });
});

describe("produceWeeklyLineWording: the order of the steps", () => {
  it("pre-check, then the allowance, then the real gate, then the call, then the validator", async () => {
    const order: string[] = [];
    const h = harness({ behavior: { wording: "wording_numbers" } });
    h.allowanceCalls.mockImplementation(async () => {
      order.push("allowance");
      return { allowed: true, usedToday: 0 };
    });
    const gateway = h.deps.runtime.gateway;
    const original = gateway.wordWeeklyLine.bind(gateway);
    vi.spyOn(gateway, "wordWeeklyLine").mockImplementation(async (context, options) => {
      order.push("call");
      const result = await original(context, options);
      order.push("answered");
      return result;
    });
    h.logCalls.mockImplementation(async () => {
      order.push("validator-rejected");
    });
    await produceWeeklyLineWording(h.deps, input());
    expect(order).toEqual(["allowance", "call", "answered", "validator-rejected"]);
  });
});

describe("produceWeeklyLineWording: never throws, never logs content", () => {
  it("whatever the dependencies do", async () => {
    const rejecting = new AIGateway([new FakeAIProvider()]);
    vi.spyOn(rejecting, "wordWeeklyLine").mockRejectedValue(new Error("gateway exploded"));
    const outcome = await produceWeeklyLineWording(harness({ gateway: rejecting }).deps, input());
    expect(outcome).toEqual({ source: "catalog", text: APPROVED.he, reason: "provider_failed" });

    const throwingLog = harness({ behavior: { wording: "wording_numbers" }, logError: () => Promise.reject(new Error("log down")) });
    expect(await produceWeeklyLineWording(throwingLog.deps, input())).toMatchObject({ source: "catalog", reason: "rejected_digits" });

    const throwingAllowance = harness({ allowance: "throw" });
    await expect(produceWeeklyLineWording(throwingAllowance.deps, input())).resolves.toMatchObject({ source: "catalog" });
  });

  it("an approved sentence that cannot be sent (over 400 characters) is refused before any provider attempt", async () => {
    const h = harness();
    const outcome = await produceWeeklyLineWording(h.deps, input({ approvedText: "ש".repeat(401) }));
    expect(outcome).toMatchObject({ source: "catalog", reason: "provider_failed" });
    expect(h.providerCalls()).toBe(0);
    expect(h.records).toEqual([]);
  });

  it("the catalog text is the SAME string the caller passed", async () => {
    const approved = `${APPROVED.he}`;
    const outcome = await produceWeeklyLineWording(harness({ behavior: { wording: "wording_food" } }).deps, input({ approvedText: approved }));
    expect(outcome.text).toBe(approved);
  });

  it("no console call and no logError argument contains the candidate or the approved text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const secrets = [APPROVED.he, APPROVED.en];
    for (const behavior of [{ wording: "wording_numbers" }, { wording: "wording_fail" }, { wording: "wording_invalid" }, { wording: "wording_negate" }] as const) {
      for (const locale of ["he", "en"] as const) {
        const h = harness({ behavior });
        await produceWeeklyLineWording(h.deps, input({}, locale));
        const logged = JSON.stringify(h.logCalls.mock.calls);
        for (const secret of secrets) expect(logged).not.toContain(secret.slice(0, 12));
        // Candidate words (the fake appends ", אם בא לך" / "for 5 more minutes") never reach the log either.
        expect(logged).not.toMatch(/אם בא לך|5 more|chocolate|שוקולד|should|כדאי/);
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
