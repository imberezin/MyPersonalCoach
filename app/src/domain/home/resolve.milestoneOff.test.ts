import { describe, expect, it, vi } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import type { OfflinePeriod } from "../offline";

// Runs the resolver with the milestone moment switched OFF. WEIGHT_FLOW is a `const`, so the module is mocked
// (same technique as resolve.flagOff.test.ts).
vi.mock("../weight/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../weight/types")>()),
  WEIGHT_FLOW: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: false },
}));

import { resolveHome, type HomeFacts } from "./index";

const TZ = "Asia/Jerusalem";

const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 },
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: { week: "2026-10-18", isGoal: false },
    weekly: null,
    ...overrides,
  };
}

describe("resolveHome with the milestone moment switched off", () => {
  it("never shows the state and offers no progress action, even when a moment is given", () => {
    for (const now of ["2027-01-12T01:00:00Z", "2027-01-12T05:00:00Z", "2027-01-12T10:00:00Z", "2027-01-12T17:00:00Z"]) {
      const decision = resolveHome(facts(now));
      expect(decision.state.key).not.toBe("MILESTONE_REACHED");
      expect(decision.action === null || decision.action.kind !== "OPEN_PROGRESS").toBe(true);
    }
  });

  it("falls back to the clock states", () => {
    expect(resolveHome(facts("2027-01-12T05:00:00Z")).state).toEqual({ key: "MORNING" });
    expect(resolveHome(facts("2027-01-12T17:00:00Z")).state).toEqual({ key: "EVENING" });
    expect(resolveHome(facts("2027-01-12T10:00:00Z")).state).toEqual({ key: "SILENCE", reason: "NOTHING_TO_SAY" });
  });

  it("lets the Early Signal and the First Week cards behave as if the moment did not exist", () => {
    const due = resolveHome(facts("2027-01-12T05:00:00Z", { earlySignal: { due: true, level: "EARLY_SIGNAL" }, quietHours: { kind: "NONE" } }));
    expect(due.state.key).toBe("EARLY_SIGNAL");
    const summary = resolveHome(facts("2027-01-12T10:00:00Z", { firstWeek: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 } }));
    expect(summary.state.key).toBe("FIRST_WEEK_SUMMARY_READY");
  });
});
