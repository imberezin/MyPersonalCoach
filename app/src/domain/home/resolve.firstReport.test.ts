import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOT_SNOOZED, type FirstWeekProgress } from "../firstWeekFlow/types";
import { resolveHome, type HomeFacts } from "./index";

// The first-report invitation (First Week Start and the clock-state invitation) during FIRST_WEEK keys on a confirmed MEAL,
// not on `hasAnyReport`: a weight is a report, but the First Week exists to learn eating habits.

const TZ = "Asia/Jerusalem";
const MIDDAY = "2027-01-12T10:00:00Z"; // 12:00 local, the clock alone says silence
const MORNING = "2027-01-12T05:00:00Z"; // 07:00 local

const NO_MEALS: FirstWeekProgress = { availableDays: 1, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const SOME_MEALS: FirstWeekProgress = { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 };
const ONE_MEAL: FirstWeekProgress = { availableDays: 2, confirmedMeals: 1, availableDaysSinceLastMeal: 0 };

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: SOME_MEALS,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: null,
    weekly: null,
    ...overrides,
  };
}

const FIRST_REPORT = { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" } as const;

describe("the first-report invitation during FIRST_WEEK", () => {
  it("is not ended by a weight: hasAnyReport true with no confirmed meal still shows First Week Start", () => {
    const decision = resolveHome(facts(MIDDAY, { hasAnyReport: true, firstWeek: NO_MEALS }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.action).toEqual(FIRST_REPORT);
    expect(decision.degraded).toBe(false);
  });

  it("holds at every hour of the day when only a weight was reported", () => {
    // First Week Start holds at any hour, so it replaces the morning, the silence and the evening alike.
    for (const now of [MORNING, MIDDAY, "2027-01-12T17:00:00Z"]) {
      const decision = resolveHome(facts(now, { hasAnyReport: true, firstWeek: NO_MEALS }));
      expect(decision.state.key).toBe("FIRST_WEEK_START");
      expect(decision.action).toEqual(FIRST_REPORT);
    }
  });

  it("offers the invitation on the Shabbat states when the only report is a weight", () => {
    const shabbat = { offlinePeriods: [{ type: "SHABBAT" as const, start: new Date("2027-01-08T14:10:00Z"), end: new Date("2027-01-09T15:25:00Z") }] };
    const before = resolveHome(facts("2027-01-08T12:00:00Z", { ...shabbat, hasAnyReport: true, firstWeek: NO_MEALS }));
    expect(before.state.key).toBe("BEFORE_SHABBAT");
    expect(before.action).toEqual(FIRST_REPORT);
    const motzei = resolveHome(facts("2027-01-09T16:00:00Z", { ...shabbat, hasAnyReport: true, firstWeek: NO_MEALS }));
    expect(motzei.state.key).toBe("MOTZEI_SHABBAT");
    expect(motzei.action).toEqual(FIRST_REPORT);
  });

  it("is ended by the first meal: confirmedMeals 1 or 3 means no First Week Start and no invitation", () => {
    for (const firstWeek of [ONE_MEAL, SOME_MEALS]) {
      const decision = resolveHome(facts(MIDDAY, { hasAnyReport: true, firstWeek }));
      expect(decision.state).toEqual({ key: "SILENCE", reason: "NOTHING_TO_SAY" });
      expect(decision.action).toBeNull();
      const morning = resolveHome(facts(MORNING, { hasAnyReport: true, firstWeek }));
      expect(morning.state).toEqual({ key: "MORNING" });
      expect(morning.action).toBeNull();
    }
  });

  it("is ended by the first meal even if the report fact is false (the meals count is the authority in FIRST_WEEK)", () => {
    const decision = resolveHome(facts(MIDDAY, { hasAnyReport: false, firstWeek: SOME_MEALS }));
    expect(decision.state.key).not.toBe("FIRST_WEEK_START");
    expect(decision.action).toBeNull();
  });

  it("comes back when the only meal is deleted (and still no weight changes it)", () => {
    expect(resolveHome(facts(MIDDAY, { firstWeek: ONE_MEAL })).state.key).not.toBe("FIRST_WEEK_START");
    expect(resolveHome(facts(MIDDAY, { hasAnyReport: false, firstWeek: NO_MEALS })).state.key).toBe("FIRST_WEEK_START");
    expect(resolveHome(facts(MIDDAY, { hasAnyReport: true, firstWeek: NO_MEALS })).state.key).toBe("FIRST_WEEK_START");
  });

  it("falls back to hasAnyReport when the First Week facts are unknown", () => {
    const noReport = resolveHome(facts(MIDDAY, { firstWeek: null, hasAnyReport: false }));
    expect(noReport.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(noReport.action).toEqual(FIRST_REPORT);
    const reported = resolveHome(facts(MIDDAY, { firstWeek: null, hasAnyReport: true }));
    expect(reported.state.key).not.toBe("FIRST_WEEK_START");
    expect(reported.action).toBeNull();
  });

  it("never treats an unknown report fact as 'no report yet' when the First Week facts are unknown too", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: null, hasAnyReport: null }));
    expect(decision.state.key).not.toBe("FIRST_WEEK_START");
    expect(decision.action).toBeNull();
    expect(decision.degraded).toBe(true);
  });

  it("keeps hasAnyReport for a WEEKLY_CYCLE person", () => {
    for (const lifecycle of ["WEEKLY_CYCLE", "ONBOARDING", "NEW"] as const satisfies readonly LifecycleState[]) {
      const none = resolveHome(facts(MORNING, { lifecycle, firstWeek: null, hasAnyReport: false }));
      expect(none.state).toEqual({ key: "MORNING" });
      expect(none.action).toEqual(FIRST_REPORT); // the clock-state invitation, as before
      const some = resolveHome(facts(MORNING, { lifecycle, firstWeek: null, hasAnyReport: true }));
      expect(some.action).toBeNull();
    }
    // A leftover non-null First Week fact does not matter outside FIRST_WEEK.
    const stale = resolveHome(facts(MORNING, { lifecycle: "WEEKLY_CYCLE", firstWeek: NO_MEALS, hasAnyReport: true }));
    expect(stale.action).toBeNull();
  });

  it("does not change `degraded`: it is still `hasAnyReport === null`", () => {
    expect(resolveHome(facts(MIDDAY, { hasAnyReport: null, firstWeek: NO_MEALS })).degraded).toBe(true);
    expect(resolveHome(facts(MIDDAY, { hasAnyReport: true, firstWeek: NO_MEALS })).degraded).toBe(false);
    expect(resolveHome(facts(MIDDAY, { hasAnyReport: false, firstWeek: NO_MEALS })).degraded).toBe(false);
  });

  it("follows the same predicate for the invitation of the clock states when the report fact is unknown", () => {
    // FIRST_WEEK with a known meal count: confirmedMeals decides, not the unknown fact.
    const decision = resolveHome(facts(MIDDAY, { hasAnyReport: null, firstWeek: NO_MEALS }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.action).toEqual(FIRST_REPORT);
  });
});
