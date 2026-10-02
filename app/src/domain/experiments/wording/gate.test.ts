import { afterEach, describe, expect, it } from "vitest";
import { PATTERN_THRESHOLDS } from "../../patternLifecycle";
import { AI_WORDING } from "./constants";
import { WORDING_GATE_REASONS, decideWordingGate, isWordingGateReason } from "./gate";

type Input = Parameters<typeof decideWordingGate>[0];

/** Everything open: a Candidate with 3 evenings on 3 days, 4 available days, an allowance with room to spare. */
const base = (over: Partial<Input> = {}, ai: Partial<Input["ai"]> = {}): Input => ({
  view: "CANDIDATE",
  occurrences: 3,
  distinctDays: 3,
  availableDays: 4,
  ...over,
  ai: { configured: true, dailyCap: 40, allowance: { allowed: true, usedToday: 0 }, ...ai },
});

const reasonOf = (input: Input) => {
  const gate = decideWordingGate(input);
  return gate.open ? "open" : gate.reason;
};

const original = { ...AI_WORDING };
afterEach(() => {
  Object.assign(AI_WORDING, original);
});
const tune = (over: Partial<Record<keyof typeof AI_WORDING, unknown>>) => Object.assign(AI_WORDING, over);

describe("decideWordingGate: the boundaries the owner set", () => {
  it("opens with the boundary values: 3 evenings, 3 days, 4 available days", () => {
    expect(decideWordingGate(base())).toEqual({ open: true });
  });

  it("occurrences: 2 is closed, 3 is open", () => {
    expect(reasonOf(base({ occurrences: 2 }))).toBe("too_few_occurrences");
    expect(reasonOf(base({ occurrences: 3 }))).toBe("open");
    expect(reasonOf(base({ occurrences: 7 }))).toBe("open");
  });

  it("distinct days: 2 is closed, 3 is open", () => {
    expect(reasonOf(base({ distinctDays: 2 }))).toBe("too_few_days");
    expect(reasonOf(base({ distinctDays: 3 }))).toBe("open");
  });

  it("available days: 3 is closed, 4 is open", () => {
    expect(reasonOf(base({ availableDays: 3 }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: 4 }))).toBe("open");
    expect(reasonOf(base({ availableDays: 15 }))).toBe("open");
  });

  it("the view: only CANDIDATE and VALIDATED pass", () => {
    for (const view of ["NONE", "EARLY_SIGNAL", "REJECTED"] as const) expect(reasonOf(base({ view }))).toBe("pattern_not_established");
    expect(reasonOf(base({ view: "CANDIDATE" }))).toBe("open");
    expect(reasonOf(base({ view: "VALIDATED" }))).toBe("open");
  });

  it("an unconfigured AI is closed with ai_unconfigured", () => {
    expect(reasonOf(base({}, { configured: false }))).toBe("ai_unconfigured");
  });

  it("the master switch comes first, whatever else is true", () => {
    tune({ enabled: false });
    expect(reasonOf(base())).toBe("switch_off");
    expect(reasonOf(base({ view: "NONE" }, { configured: false }))).toBe("switch_off");
  });
});

describe("decideWordingGate: the allowance", () => {
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
    tune({ reserveCalls: 5 });
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 35 } }))).toBe("open");
    expect(reasonOf(base({}, { dailyCap: 40, allowance: { allowed: true, usedToday: 36 } }))).toBe("allowance_reserve");
  });

  it("a daily cap of 0: the allowance's own daily_cap names the reason; allowed with cap 0 would only be the reserve", () => {
    expect(reasonOf(base({}, { dailyCap: 0, allowance: { allowed: false, reason: "daily_cap" } }))).toBe("allowance_daily_cap");
    // usedToday 0 + 10 <= 0 is false: only the reserve clause could close it, which pins the order of the two.
    expect(reasonOf(base({}, { dailyCap: 0, allowance: { allowed: true, usedToday: 0 } }))).toBe("allowance_reserve");
  });

  it("an infinite cap with the placeholder allowance can never be closed by the reserve", () => {
    expect(reasonOf(base({}, { dailyCap: Number.POSITIVE_INFINITY, allowance: { allowed: true, usedToday: 0 } }))).toBe("open");
  });

  it("an allowance without usedToday counts as 0", () => {
    expect(reasonOf(base({}, { allowance: { allowed: true } }))).toBe("open");
  });
});

describe("decideWordingGate: order, source of the numbers, totality", () => {
  it("several failures at once report the FIRST in the order of the list", () => {
    expect(WORDING_GATE_REASONS).toEqual([
      "switch_off",
      "ai_unconfigured",
      "pattern_not_established",
      "too_few_occurrences",
      "too_few_days",
      "allowance_daily_cap",
      "allowance_rate_limited",
      "allowance_ledger_unavailable",
      "allowance_reserve",
    ]);
    const worst = base({ view: "NONE", occurrences: 0, distinctDays: 0, availableDays: 0 }, { configured: false, allowance: null });
    expect(reasonOf(worst)).toBe("ai_unconfigured");
    expect(reasonOf({ ...worst, ai: { ...worst.ai, configured: true } })).toBe("pattern_not_established");
    expect(reasonOf({ ...worst, view: "CANDIDATE", ai: { ...worst.ai, configured: true } })).toBe("too_few_occurrences");
    expect(reasonOf({ ...worst, view: "CANDIDATE", occurrences: 3, ai: { ...worst.ai, configured: true } })).toBe("too_few_days");
    expect(reasonOf({ ...worst, view: "CANDIDATE", occurrences: 3, distinctDays: 3, availableDays: 4, ai: { ...worst.ai, configured: true } })).toBe(
      "allowance_ledger_unavailable",
    );
  });

  it("reads every threshold from AI_WORDING: changing a value changes the result", () => {
    tune({ minAvailableDays: 5 });
    expect(reasonOf(base({ availableDays: 4 }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: 5 }))).toBe("open");
    tune({ minOccurrences: 4 });
    expect(reasonOf(base({ occurrences: 3 }))).toBe("too_few_occurrences");
    tune({ minOccurrences: 3, minDistinctDays: 4 });
    expect(reasonOf(base({ distinctDays: 3 }))).toBe("too_few_days");
  });

  it("minOccurrences and minDistinctDays are the pattern threshold of a Candidate (the same value)", () => {
    expect(AI_WORDING.minOccurrences).toBe(PATTERN_THRESHOLDS.candidate);
    expect(AI_WORDING.minDistinctDays).toBe(PATTERN_THRESHOLDS.candidate);
    expect(AI_WORDING.minAvailableDays).toBe(4);
  });

  it("is total: NaN, undefined and negative numbers close the gate and never throw", () => {
    expect(reasonOf(base({ occurrences: Number.NaN }))).toBe("too_few_occurrences");
    expect(reasonOf(base({ distinctDays: Number.NaN }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: undefined as unknown as number }))).toBe("too_few_days");
    expect(reasonOf(base({ availableDays: -1 }))).toBe("too_few_days");
    expect(reasonOf(base({}, { dailyCap: Number.NaN }))).toBe("allowance_reserve");
    expect(reasonOf(base({}, { allowance: { allowed: true, usedToday: Number.NaN } }))).toBe("allowance_reserve");
  });

  it("recognises its own reasons", () => {
    for (const reason of WORDING_GATE_REASONS) expect(isWordingGateReason(reason)).toBe(true);
    for (const other of ["provider_failed", "no_providers", "invalid_output", "rejected_digits", "", "open"]) expect(isWordingGateReason(other)).toBe(false);
  });
});
