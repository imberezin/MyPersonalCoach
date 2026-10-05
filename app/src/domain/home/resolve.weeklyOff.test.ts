import { describe, expect, it, vi } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";

// Runs the resolver with Weekly Learning switched OFF. WEEKLY_FLOW is a `const`, so the module is mocked.
vi.mock("../weekly/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("../weekly/types")>();
  return { ...original, WEEKLY_FLOW: { ...original.WEEKLY_FLOW, enabled: false } };
});

import { resolveHome, type HomeFacts } from "./index";

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: "Asia/Jerusalem",
    offlinePeriods: [],
    hasAnyReport: true,
    lifecycle: "WEEKLY_CYCLE",
    firstWeek: null,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: null,
    weekly: { weekStart: "2027-01-03", card: true },
    activeExperiment: null,
    ...overrides,
  };
}

describe("resolveHome with Weekly Learning switched off", () => {
  it("never shows the weekly card, even when a card fact is given", () => {
    for (const now of ["2027-01-10T01:00:00Z", "2027-01-10T05:00:00Z", "2027-01-10T11:00:00Z", "2027-01-10T18:00:00Z"]) {
      const decision = resolveHome(facts(now));
      expect(decision.state.key).not.toBe("WEEKLY_SUMMARY_READY");
      expect(decision.action === null || decision.action.kind !== "OPEN_WEEKLY_STORY").toBe(true);
      expect(decision.weeklyLink).toBe(false);
    }
  });

  it("never shows the quiet link", () => {
    expect(resolveHome(facts("2027-01-10T05:00:00Z", { weekly: { weekStart: "2027-01-03", card: false } })).weeklyLink).toBe(false);
  });

  it("falls back to the clock states", () => {
    expect(resolveHome(facts("2027-01-10T05:00:00Z")).state.key).toBe("MORNING");
    expect(resolveHome(facts("2027-01-10T18:00:00Z")).state.key).toBe("EVENING");
  });
});
