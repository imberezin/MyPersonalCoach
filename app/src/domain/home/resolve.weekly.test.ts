import { describe, expect, it } from "vitest";
import { NOT_SNOOZED } from "../firstWeekFlow/types";
import type { OfflinePeriod } from "../offline";
import { homeCopyKey, resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2). The week of 2027-01-03 is the one a Sunday 2027-01-10 card is about.
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};
const NEXT_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-15T14:10:00Z"),
  end: new Date("2027-01-16T15:25:00Z"),
};

const CARD = { weekStart: "2027-01-03", card: true } as const;
const LINK = { weekStart: "2027-01-03", card: false } as const;

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT, NEXT_SHABBAT],
    hasAnyReport: true,
    lifecycle: "WEEKLY_CYCLE",
    firstWeek: null,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: null,
    weekly: CARD,
    ...overrides,
  };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

// Sunday 2027-01-10 in UTC+2.
const SUNDAY_03 = "2027-01-10T01:00:00Z"; // 03:00 local: silence
const SUNDAY_07 = "2027-01-10T05:00:00Z"; // 07:00 local: morning
const SUNDAY_13 = "2027-01-10T11:00:00Z"; // 13:00 local: silence
const SUNDAY_20 = "2027-01-10T18:00:00Z"; // 20:00 local: evening
// Shabbat of 2027-01-15 / 16.
const FRIDAY_14 = "2027-01-15T12:00:00Z"; // 14:00 local: 2 h 10 min before candle lighting
const SATURDAY_10 = "2027-01-16T08:00:00Z"; // 10:00 local: inside Shabbat
const SATURDAY_18 = "2027-01-16T16:00:00Z"; // 18:00 local: 35 min after havdalah

describe("resolveHome: the weekly card (row 3b)", () => {
  it.each([
    ["03:00", SUNDAY_03],
    ["07:00", SUNDAY_07],
    ["13:00", SUNDAY_13],
    ["20:00", SUNDAY_20],
  ])("shows WEEKLY_SUMMARY_READY with OPEN_WEEKLY_STORY at %s", (_label, now) => {
    const decision = resolveHome(facts(now));
    expect(decision.state).toEqual({ key: "WEEKLY_SUMMARY_READY" });
    expect(decision.action).toEqual({ kind: "OPEN_WEEKLY_STORY" });
    expect(decision.weeklyLink).toBe(false);
    expect(decision.degraded).toBe(false);
  });

  it("maps to the weeklyReady copy key", () => {
    expect(homeCopyKey(resolveHome(facts(SUNDAY_07)).state)).toBe("weeklyReady");
  });

  it("carries its own action, never the first-report invitation (even with no report at all)", () => {
    const decision = resolveHome(facts(SUNDAY_07, { hasAnyReport: false }));
    expect(decision.state.key).toBe("WEEKLY_SUMMARY_READY");
    expect(decision.action).toEqual({ kind: "OPEN_WEEKLY_STORY" });
  });

  it("beats the clock states (EVENING, MORNING and SILENCE)", () => {
    const without = (now: string) => label(resolveHome(facts(now, { weekly: null })).state);
    expect(without(SUNDAY_20)).toBe("EVENING");
    expect(without(SUNDAY_07)).toBe("MORNING");
    expect(without(SUNDAY_13)).toBe("SILENCE/NOTHING_TO_SAY");
    for (const now of [SUNDAY_20, SUNDAY_07, SUNDAY_13]) expect(resolveHome(facts(now)).state.key).toBe("WEEKLY_SUMMARY_READY");
  });

  it("yields to the Shabbat states: offline, before Shabbat and Motzei Shabbat each beat it", () => {
    expect(label(resolveHome(facts(SATURDAY_10)).state)).toBe("SILENCE/OFFLINE:SHABBAT");
    expect(resolveHome(facts(FRIDAY_14)).state.key).toBe("BEFORE_SHABBAT");
    expect(resolveHome(facts(SATURDAY_18)).state.key).toBe("MOTZEI_SHABBAT");
  });

  it("beats the milestone card while it is untouched, and lets it through once the card is opened or snoozed", () => {
    const milestone = { week: "2026-12-27", isGoal: false };
    expect(resolveHome(facts(SUNDAY_07, { milestone })).state.key).toBe("WEEKLY_SUMMARY_READY");
    expect(resolveHome(facts(SUNDAY_07, { milestone, weekly: LINK })).state.key).toBe("MILESTONE_REACHED");
  });

  it("is shown when the Shabbat rows are unknown (the clock decides alone)", () => {
    const decision = resolveHome(facts(SUNDAY_07, { offlinePeriods: null }));
    expect(decision.state.key).toBe("WEEKLY_SUMMARY_READY");
    expect(decision.degraded).toBe(true);
  });

  it("is the same state on the DST days (the fall-back Sunday and the spring-forward Sunday)", () => {
    expect(resolveHome(facts("2026-10-25T06:00:00Z", { offlinePeriods: [] })).state.key).toBe("WEEKLY_SUMMARY_READY"); // 08:00 local, UTC+2
    expect(resolveHome(facts("2027-03-28T05:00:00Z", { offlinePeriods: [] })).state.key).toBe("WEEKLY_SUMMARY_READY"); // 08:00 local, UTC+3
  });
});

describe("resolveHome: the weekly card needs WEEKLY_CYCLE and a fact", () => {
  it.each([["FIRST_WEEK"], ["NEW"], ["ONBOARDING"], [null]] as const)("lifecycle %s with a non-null weekly fact is ignored (clock state, no link)", (lifecycle) => {
    const firstWeek = lifecycle === "FIRST_WEEK" ? { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 } : null;
    for (const weekly of [CARD, LINK]) {
      const decision = resolveHome(facts(SUNDAY_07, { lifecycle, weekly, firstWeek }));
      expect(decision.state.key).toBe("MORNING");
      expect(decision.weeklyLink).toBe(false);
    }
  });

  it("weekly: null gives the clock states and no link", () => {
    const decision = resolveHome(facts(SUNDAY_07, { weekly: null }));
    expect(decision.state.key).toBe("MORNING");
    expect(decision.weeklyLink).toBe(false);
  });

  it("a caller that predates the fact (no `weekly` property at all) reads it as null", () => {
    const old = facts(SUNDAY_07) as Partial<HomeFacts>;
    delete old.weekly;
    const decision = resolveHome(old as HomeFacts);
    expect(decision.state.key).toBe("MORNING");
    expect(decision.weeklyLink).toBe(false);
  });

  it("the First Week states never co-occur: leftover First Week counts in WEEKLY_CYCLE do not produce them", () => {
    const leftover = { availableDays: 15, confirmedMeals: 12, availableDaysSinceLastMeal: 4 };
    expect(resolveHome(facts(SUNDAY_07, { weekly: LINK, firstWeek: leftover })).state.key).toBe("MORNING");
    expect(resolveHome(facts(SUNDAY_07, { weekly: null, firstWeek: leftover })).state.key).toBe("MORNING");
    expect(resolveHome(facts(SUNDAY_07, { firstWeek: leftover })).state.key).toBe("WEEKLY_SUMMARY_READY");
  });

  it("an unknown weekly fact does not degrade Home", () => {
    expect(resolveHome(facts(SUNDAY_07, { weekly: null })).degraded).toBe(false);
    expect(resolveHome(facts(SUNDAY_07, { weekly: null, hasAnyReport: null })).degraded).toBe(true);
  });
});

describe("resolveHome: the quiet 'Your week' link", () => {
  it.each([
    ["MORNING", SUNDAY_07],
    ["EVENING", SUNDAY_20],
    ["SILENCE/NOTHING_TO_SAY", SUNDAY_13],
    ["SILENCE/NOTHING_TO_SAY", SUNDAY_03],
  ])("is true in %s when the card was opened or snoozed", (state, now) => {
    const decision = resolveHome(facts(now, { weekly: LINK }));
    expect(label(decision.state)).toBe(state);
    expect(decision.weeklyLink).toBe(true);
  });

  it("is false in OFFLINE_PERIOD, BEFORE_SHABBAT and MOTZEI_SHABBAT", () => {
    for (const now of [SATURDAY_10, FRIDAY_14, SATURDAY_18]) {
      expect(resolveHome(facts(now, { weekly: LINK })).weeklyLink).toBe(false);
    }
  });

  it("is false while the card itself is shown: never both", () => {
    const decision = resolveHome(facts(SUNDAY_07, { weekly: CARD }));
    expect(decision.state.key).toBe("WEEKLY_SUMMARY_READY");
    expect(decision.weeklyLink).toBe(false);
  });

  it("is false in a state that is not a calm clock state (the milestone card)", () => {
    const decision = resolveHome(facts(SUNDAY_07, { weekly: LINK, milestone: { week: "2026-12-27", isGoal: false } }));
    expect(decision.state.key).toBe("MILESTONE_REACHED");
    expect(decision.weeklyLink).toBe(false);
  });

  it("does not change `state`, `action` or `degraded`", () => {
    const variants: Partial<HomeFacts>[] = [{}, { hasAnyReport: false }, { hasAnyReport: null }, { offlinePeriods: null }];
    for (const now of [SUNDAY_03, SUNDAY_07, SUNDAY_13, SUNDAY_20, FRIDAY_14, SATURDAY_10, SATURDAY_18]) {
      for (const overrides of variants) {
        const withLink = resolveHome(facts(now, { ...overrides, weekly: LINK }));
        const without = resolveHome(facts(now, { ...overrides, weekly: null }));
        expect(withLink.state).toEqual(without.state);
        expect(withLink.action).toEqual(without.action);
        expect(withLink.degraded).toBe(without.degraded);
      }
    }
  });

  it("keeps the first-report invitation as it was: the link is not an action", () => {
    const decision = resolveHome(facts(SUNDAY_07, { weekly: LINK, hasAnyReport: false }));
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });
    expect(decision.weeklyLink).toBe(true);
  });

  it("is false for an invalid instant", () => {
    const decision = resolveHome(facts(SUNDAY_07, { now: new Date(Number.NaN), weekly: LINK }));
    expect(decision).toEqual({ state: { key: "SILENCE", reason: "NOTHING_TO_SAY" }, action: null, degraded: true, weeklyLink: false });
  });
});
