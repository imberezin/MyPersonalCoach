import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_WORDING } from "../../experiments/wording/constants";
import { WEEKLY_FLOW, type OpeningMode } from "../types";
import { WEEKLY_LINE_GATE_REASONS, decideWeeklyLineGate } from "./gate";

type Input = Parameters<typeof decideWeeklyLineGate>[0];

/** Everything open: a LEARN week with 4 available days and an allowance with room to spare. */
const base = (over: Partial<Input> = {}, ai: Partial<Input["ai"]> = {}): Input => ({
  mode: "LEARN",
  availableDays: 4,
  ...over,
  ai: { configured: true, dailyCap: 40, allowance: { allowed: true, usedToday: 0 }, ...ai },
});

const reasonOf = (input: Input) => {
  const gate = decideWeeklyLineGate(input);
  return gate.open ? "open" : gate.reason;
};

const originalWording = { ...AI_WORDING };
// The AI opening line SHIPS OFF (types.test.ts pins that); these tests are about the gate's own rules, so the line is
// switched on for each of them and put back afterwards.
const originalFlow = { ...WEEKLY_FLOW, aiLineEnabled: true };
beforeEach(() => {
  Object.assign(WEEKLY_FLOW, { aiLineEnabled: true });
});
afterEach(() => {
  Object.assign(AI_WORDING, originalWording);
  Object.assign(WEEKLY_FLOW, originalFlow);
});
const tune = (over: Partial<Record<keyof typeof AI_WORDING, unknown>>) => Object.assign(AI_WORDING, over);
const flow = (over: Partial<Record<keyof typeof WEEKLY_FLOW, boolean>>) => Object.assign(WEEKLY_FLOW, over);

describe("decideWeeklyLineGate: the mode", () => {
  it("opens for LEARN with the boundary values", () => {
    expect(decideWeeklyLineGate(base())).toEqual({ open: true });
  });

  // CELEBRATE covers both the milestone and the goal sentences (same mode); RECOVER is the Brand "You came back" line;
  // RESET is the quiet-week sentence. None of them is ever sent to a provider.
  it.each(["CELEBRATE", "RECOVER", "RESET"] as const)("%s keeps the fixed catalog sentence: mode_fixed_text", (mode: OpeningMode) => {
    expect(reasonOf(base({ mode }))).toBe("mode_fixed_text");
    expect(reasonOf(base({ mode, availableDays: 15 }))).toBe("mode_fixed_text");
  });

  it("an unknown mode is closed too (only LEARN opens)", () => {
    expect(reasonOf(base({ mode: "learn" as unknown as OpeningMode }))).toBe("mode_fixed_text");
    expect(reasonOf(base({ mode: undefined as unknown as OpeningMode }))).toBe("mode_fixed_text");
  });
});

describe("decideWeeklyLineGate: the days and the configuration", () => {
  it("available days: 3 is closed, 4 is open", () => {
    expect(reasonOf(base({ availableDays: 3 }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: 4 }))).toBe("open");
    expect(reasonOf(base({ availableDays: 15 }))).toBe("open");
  });

  it("an unconfigured AI is closed with ai_unconfigured", () => {
    expect(reasonOf(base({}, { configured: false }))).toBe("ai_unconfigured");
  });

  it("the weekly switches come first, whatever else is true", () => {
    flow({ aiLineEnabled: false });
    expect(reasonOf(base())).toBe("switch_off");
    expect(reasonOf(base({ mode: "RECOVER", availableDays: 0 }, { configured: false }))).toBe("switch_off");
    flow({ aiLineEnabled: true, enabled: false });
    expect(reasonOf(base())).toBe("switch_off");
  });

  it("the First Week's master wording switch closes it as well", () => {
    tune({ enabled: false });
    expect(reasonOf(base())).toBe("switch_off");
  });
});

describe("decideWeeklyLineGate: the allowance", () => {
  it("not read (null) is closed with allowance_ledger_unavailable", () => {
    expect(reasonOf(base({}, { allowance: null }))).toBe("allowance_ledger_unavailable");
  });

  it("maps the allowance's own refusal reasons", () => {
    expect(reasonOf(base({}, { allowance: { allowed: false, reason: "daily_cap" } }))).toBe("allowance_daily_cap");
    expect(reasonOf(base({}, { allowance: { allowed: false, reason: "rate_limited" } }))).toBe("allowance_rate_limited");
    expect(reasonOf(base({}, { allowance: { allowed: false, reason: "ledger_unavailable" } }))).toBe("allowance_ledger_unavailable");
    expect(reasonOf(base({}, { allowance: { allowed: false } }))).toBe("allowance_ledger_unavailable");
  });

  it("the reserve: usedToday + reserveCalls = dailyCap is open, one more is closed", () => {
    expect(AI_WORDING.reserveCalls).toBe(10);
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 30 } }))).toBe("open");
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 31 } }))).toBe("allowance_reserve");
  });

  it("reserveCalls is read from AI_WORDING: a change there changes the result", () => {
    tune({ reserveCalls: 5 });
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 35 } }))).toBe("open");
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 36 } }))).toBe("allowance_reserve");
  });

  it("a daily cap of 0: the allowance's own daily_cap names the reason; allowed with cap 0 would only be the reserve", () => {
    expect(reasonOf(base({}, { dailyCap: 0, allowance: { allowed: false, reason: "daily_cap" } }))).toBe("allowance_daily_cap");
    expect(reasonOf(base({}, { dailyCap: 0, allowance: { allowed: true, usedToday: 0 } }))).toBe("allowance_reserve");
  });

  it("an infinite cap with the placeholder allowance can never be closed by the reserve", () => {
    expect(reasonOf(base({}, { dailyCap: Number.POSITIVE_INFINITY, allowance: { allowed: true, usedToday: 0 } }))).toBe("open");
  });

  it("an allowance without usedToday counts as 0", () => {
    expect(reasonOf(base({}, { allowance: { allowed: true } }))).toBe("open");
  });
});

describe("decideWeeklyLineGate: order, source of the numbers, totality", () => {
  it("several failures at once report the FIRST in the order of the list", () => {
    expect(WEEKLY_LINE_GATE_REASONS).toEqual([
      "switch_off",
      "ai_unconfigured",
      "mode_fixed_text",
      "too_few_days",
      "allowance_daily_cap",
      "allowance_rate_limited",
      "allowance_ledger_unavailable",
      "allowance_reserve",
    ]);
    const worst = base({ mode: "RESET", availableDays: 0 }, { configured: false, allowance: null });
    expect(reasonOf(worst)).toBe("ai_unconfigured");
    expect(reasonOf({ ...worst, ai: { ...worst.ai, configured: true } })).toBe("mode_fixed_text");
    expect(reasonOf({ ...worst, mode: "LEARN", ai: { ...worst.ai, configured: true } })).toBe("too_few_days");
    expect(reasonOf({ ...worst, mode: "LEARN", availableDays: 4, ai: { ...worst.ai, configured: true } })).toBe("allowance_ledger_unavailable");
  });

  it("reads the minimum days from AI_WORDING: changing it changes the result", () => {
    tune({ minAvailableDays: 5 });
    expect(reasonOf(base({ availableDays: 4 }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: 5 }))).toBe("open");
  });

  it("is total: NaN, undefined and negative numbers close the gate and never throw", () => {
    expect(reasonOf(base({ availableDays: Number.NaN }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: undefined as unknown as number }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: -1 }))).toBe("too_few_days");
    expect(reasonOf(base({}, { dailyCap: Number.NaN }))).toBe("allowance_reserve");
    expect(reasonOf(base({}, { allowance: { allowed: true, usedToday: Number.NaN } }))).toBe("allowance_reserve");
    expect(reasonOf(base({}, { configured: undefined as unknown as boolean }))).toBe("ai_unconfigured");
  });
});
