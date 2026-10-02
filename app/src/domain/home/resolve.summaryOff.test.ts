import { describe, expect, it, vi } from "vitest";
import type { FirstWeekProgress } from "../firstWeekFlow/types";

// Runs the resolver with ONLY the summary switch off (the way to keep an account out of the one-way step) and the
// welcome-back switch on. It is a `const`, so the module is mocked (same technique as resolve.firstWeekOff.test.ts).
vi.mock("../firstWeekFlow/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../firstWeekFlow/types")>()),
  FIRST_WEEK_FLOW: { summaryEnabled: false, welcomeBackEnabled: true, acknowledgementEnabled: false },
}));

import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";
const MIDDAY = "2027-01-12T10:00:00Z"; // 12:00 local
// The counts say SUMMARY_READY (10 meals on 8 days) and also "3 available days without a meal".
const READY_AND_AWAY: FirstWeekProgress = { availableDays: 8, confirmedMeals: 10, availableDaysSinceLastMeal: 3 };
const DAY_15_AND_AWAY: FirstWeekProgress = { availableDays: 15, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };
const READY_NOT_AWAY: FirstWeekProgress = { availableDays: 15, confirmedMeals: 0, availableDaysSinceLastMeal: null };

function facts(overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(MIDDAY),
    timeZone: TZ,
    offlinePeriods: [],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: READY_AND_AWAY,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    ...overrides,
  };
}

const label = (state: HomeState): string =>
  state.key !== "SILENCE" ? state.key : state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : "SILENCE/OFFLINE";

describe("resolveHome with the summary off and the welcome-back on", () => {
  it("shows the welcome-back although the counts also say the summary is ready", () => {
    for (const firstWeek of [READY_AND_AWAY, DAY_15_AND_AWAY]) {
      const decision = resolveHome(facts({ firstWeek }));
      expect(decision.state).toEqual({ key: "FIRST_WEEK_WELCOME_BACK" });
      expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "WELCOME_BACK" });
    }
  });

  it("still shows no summary card, and nothing when there is no absence", () => {
    const decision = resolveHome(facts({ firstWeek: READY_NOT_AWAY }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.action).toBeNull();
  });

  it("respects the welcome-back's own snooze, and needs FIRST_WEEK and a loaded fact", () => {
    expect(label(resolveHome(facts({ firstWeekSnoozed: { summary: false, welcomeBack: true } })).state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(label(resolveHome(facts({ lifecycle: "WEEKLY_CYCLE" })).state)).not.toBe("FIRST_WEEK_WELCOME_BACK");
    expect(label(resolveHome(facts({ firstWeek: null })).state)).not.toBe("FIRST_WEEK_WELCOME_BACK");
  });
});
