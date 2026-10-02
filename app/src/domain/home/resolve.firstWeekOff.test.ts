import { describe, expect, it, vi } from "vitest";
import type { FirstWeekProgress } from "../firstWeekFlow/types";

// Runs the resolver with FIRST_WEEK_FLOW all OFF. It is a `const`, so the module is mocked
// (same technique as resolve.flagOff.test.ts).
vi.mock("../firstWeekFlow/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../firstWeekFlow/types")>()),
  FIRST_WEEK_FLOW: { summaryEnabled: false, welcomeBackEnabled: false, acknowledgementEnabled: false },
}));

import { NOT_SNOOZED } from "../firstWeekFlow/types";
import { resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";
const MIDDAY = "2027-01-12T10:00:00Z"; // 12:00 local
const READY: FirstWeekProgress = { availableDays: 15, confirmedMeals: 1, availableDaysSinceLastMeal: 0 };
// No confirmed meal: during FIRST_WEEK this is what keeps the first-report invitation up.
const READY_NO_MEALS: FirstWeekProgress = { availableDays: 15, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const WELCOME_BACK: FirstWeekProgress = { availableDays: 3, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: READY,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: null,
    ...overrides,
  };
}

const label = (state: HomeState): string =>
  state.key !== "SILENCE" ? state.key : state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : "SILENCE/OFFLINE";

describe("resolveHome with the First Week switches off", () => {
  it("shows no summary state and offers no summary action, even when the rules say ready", () => {
    const decision = resolveHome(facts(MIDDAY));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.action).toBeNull();
  });

  it("shows no welcome-back state", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: WELCOME_BACK }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.action).toBeNull();
  });

  it("does not suppress First Week Start by a ready summary (the summary does not exist)", () => {
    const decision = resolveHome(facts(MIDDAY, { hasAnyReport: false, firstWeek: READY_NO_MEALS }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });
  });

  it("leaves the clock states unchanged", () => {
    expect(resolveHome(facts("2027-01-12T17:00:00Z")).state).toEqual({ key: "EVENING" });
    expect(resolveHome(facts("2027-01-12T05:00:00Z")).state).toEqual({ key: "MORNING" });
  });

  it("does not degrade the decision by the summary being off", () => {
    expect(resolveHome(facts(MIDDAY)).degraded).toBe(false);
  });
});
