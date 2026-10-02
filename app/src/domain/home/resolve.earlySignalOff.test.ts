import { describe, expect, it, vi } from "vitest";

// Runs the resolver with PATTERN_FLOW all OFF. It is a `const`, so the module is mocked.
vi.mock("../patterns/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../patterns/types")>()),
  PATTERN_FLOW: { detectionEnabled: false, earlySignalEnabled: false, experimentEnabled: false, syncOnMealChange: false },
}));

import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    // During FIRST_WEEK the first-report invitation keys on confirmed meals, so a fixture with no report at all has none.
    firstWeek: { availableDays: 2, confirmedMeals: overrides.hasAnyReport === false ? 0 : 3, availableDaysSinceLastMeal: overrides.hasAnyReport === false ? null : 0 },
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: { due: true, level: "EARLY_SIGNAL" },
    quietHours: { kind: "NONE" },
    milestone: null,
    ...overrides,
  };
}

const label = (state: HomeState): string =>
  state.key !== "SILENCE" ? state.key : state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : "SILENCE/OFFLINE";

describe("resolveHome with the pattern switches off", () => {
  it("never shows the Early Signal state, even when the data says due", () => {
    for (const now of ["2027-01-12T08:00:00Z", "2027-01-12T05:00:00Z", "2027-01-12T11:00:00Z"]) {
      const decision = resolveHome(facts(now));
      expect(decision.state.key).not.toBe("EARLY_SIGNAL");
      expect(decision.action).toBeNull();
    }
  });

  it("leaves the other states unchanged", () => {
    expect(label(resolveHome(facts("2027-01-12T11:00:00Z")).state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(resolveHome(facts("2027-01-12T05:00:00Z")).state).toEqual({ key: "MORNING" });
    expect(resolveHome(facts("2027-01-12T17:00:00Z")).state).toEqual({ key: "EVENING" });
    expect(resolveHome(facts("2027-01-12T08:00:00Z", { hasAnyReport: false })).state).toEqual({ key: "FIRST_WEEK_START" });
    expect(resolveHome(facts("2027-01-12T08:00:00Z", { firstWeek: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 } })).state).toEqual({
      key: "FIRST_WEEK_SUMMARY_READY",
      hadEnoughData: true,
    });
  });
});
