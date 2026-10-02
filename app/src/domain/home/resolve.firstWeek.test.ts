import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOT_SNOOZED, type FirstWeekProgress, type FirstWeekSnoozed } from "../firstWeekFlow/types";
import type { OfflinePeriod, OfflineType } from "../offline";
import { homeCopyKey, resolveHome, type HomeFacts, type HomeState } from "./index";

const TZ = "Asia/Jerusalem";

// Winter Shabbat: candle lighting 16:10, havdalah 17:25 local (UTC+2).
const WINTER_SHABBAT: OfflinePeriod = {
  type: "SHABBAT",
  start: new Date("2027-01-08T14:10:00Z"),
  end: new Date("2027-01-09T15:25:00Z"),
};

// 12:00 local on an ordinary Tuesday: the clock alone would say SILENCE.
const MIDDAY = "2027-01-12T10:00:00Z";

const KEEP_GOING: FirstWeekProgress = { availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 };
// During FIRST_WEEK the first-report invitation keys on confirmed meals, so a fixture with no report at all has none.
const NO_MEALS_YET: FirstWeekProgress = { availableDays: 2, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const READY_ENOUGH: FirstWeekProgress = { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 };
const READY_LITTLE: FirstWeekProgress = { availableDays: 15, confirmedMeals: 4, availableDaysSinceLastMeal: 1 };
const READY_NO_MEALS: FirstWeekProgress = { availableDays: 15, confirmedMeals: 0, availableDaysSinceLastMeal: null };
const WELCOME_BACK: FirstWeekProgress = { availableDays: 3, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };

function facts(now: string, overrides: Partial<HomeFacts> = {}): HomeFacts {
  return {
    now: new Date(now),
    timeZone: TZ,
    offlinePeriods: [WINTER_SHABBAT],
    hasAnyReport: true,
    lifecycle: "FIRST_WEEK",
    firstWeek: overrides.hasAnyReport === false ? NO_MEALS_YET : KEEP_GOING,
    firstWeekSnoozed: NOT_SNOOZED,
    earlySignal: null,
    quietHours: null,
    milestone: null,
    ...overrides,
  };
}

function label(state: HomeState): string {
  if (state.key !== "SILENCE") return state.key;
  return state.reason === "NOTHING_TO_SAY" ? "SILENCE/NOTHING_TO_SAY" : `SILENCE/OFFLINE:${state.periodType}`;
}

const snoozed = (overrides: Partial<FirstWeekSnoozed>): FirstWeekSnoozed => ({ ...NOT_SNOOZED, ...overrides });

describe("resolveHome: the First Week states and their actions", () => {
  it("shows the summary card when the rules say ready, with enough data", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: READY_ENOUGH }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: true });
    expect(decision.action).toEqual({ kind: "OPEN_FIRST_WEEK_SUMMARY" });
    expect(decision.degraded).toBe(false);
  });

  it("shows the summary card at the maximum number of days with fewer than ten meals, without claiming enough data", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: READY_LITTLE }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false });
    expect(decision.action).toEqual({ kind: "OPEN_FIRST_WEEK_SUMMARY" });
  });

  it("shows the summary (not First Week Start) after 15 available days with no meals at all", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: READY_NO_MEALS, hasAnyReport: false }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false });
    expect(decision.action).toEqual({ kind: "OPEN_FIRST_WEEK_SUMMARY" });
  });

  it("maps the two summary states to their two copy keys, and the others to theirs", () => {
    expect(homeCopyKey(resolveHome(facts(MIDDAY, { firstWeek: READY_ENOUGH })).state)).toBe("firstWeekSummaryReady");
    expect(homeCopyKey(resolveHome(facts(MIDDAY, { firstWeek: READY_LITTLE })).state)).toBe("firstWeekSummaryReadyLittle");
    expect(homeCopyKey(resolveHome(facts(MIDDAY, { firstWeek: WELCOME_BACK })).state)).toBe("firstWeekWelcomeBack");
  });

  it("shows the welcome-back card after an absence, with the Report sheet as its action", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: WELCOME_BACK }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_WELCOME_BACK" });
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "WELCOME_BACK" });
    expect(decision.degraded).toBe(false);
  });

  it("shows no First Week card in the middle of the week", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: KEEP_GOING }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.action).toBeNull();
  });

  it("carries the card at every hour of the day (it is content on the screen, not a notification)", () => {
    for (const now of ["2027-01-12T01:00:00Z", "2027-01-12T05:00:00Z", MIDDAY, "2027-01-12T17:00:00Z", "2027-01-12T21:30:00Z"]) {
      expect(resolveHome(facts(now, { firstWeek: READY_ENOUGH })).state.key).toBe("FIRST_WEEK_SUMMARY_READY");
    }
  });
});

describe("resolveHome: precedence of the First Week states", () => {
  const cards: Array<[string, FirstWeekProgress]> = [
    ["the summary", READY_ENOUGH],
    ["the welcome-back", WELCOME_BACK],
  ];
  const shabbat: Array<[string, string, string]> = [
    ["Shabbat in progress", "2027-01-09T10:00:00Z", "SILENCE/OFFLINE:SHABBAT"],
    ["Before Shabbat", "2027-01-08T12:00:00Z", "BEFORE_SHABBAT"],
    ["Motzei Shabbat", "2027-01-09T16:00:00Z", "MOTZEI_SHABBAT"],
  ];

  describe.each(cards)("%s", (_name, progress) => {
    it.each(shabbat)("is beaten by %s", (_state, now, expected) => {
      expect(label(resolveHome(facts(now, { firstWeek: progress })).state)).toBe(expected);
    });

    it.each<OfflineType>(["HOLIDAY", "VACATION", "USER_DEFINED"])("is beaten by a %s in progress", (type) => {
      const other: OfflinePeriod = { type, start: new Date("2027-01-11T00:00:00Z"), end: new Date("2027-01-14T00:00:00Z") };
      const decision = resolveHome(facts(MIDDAY, { firstWeek: progress, offlinePeriods: [other] }));
      expect(decision.state).toEqual({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: type });
      expect(decision.action).toBeNull();
    });

    it("still shows when the periods are unknown (Shabbat cannot be known, the First Week fact can)", () => {
      const decision = resolveHome(facts(MIDDAY, { firstWeek: progress, offlinePeriods: null }));
      expect(decision.state.key).toMatch(/^FIRST_WEEK_(SUMMARY_READY|WELCOME_BACK)$/);
      expect(decision.degraded).toBe(true);
    });
  });

  it("lets the summary beat the welcome-back for a person who is both ready and away", () => {
    const both: FirstWeekProgress = { availableDays: 15, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };
    expect(resolveHome(facts(MIDDAY, { firstWeek: both })).state).toEqual({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false });
  });

  it("lets both beat First Week Start", () => {
    for (const firstWeek of [READY_ENOUGH, READY_NO_MEALS, WELCOME_BACK]) {
      const decision = resolveHome(facts(MIDDAY, { firstWeek, hasAnyReport: false }));
      expect(decision.state.key).not.toBe("FIRST_WEEK_START");
      expect(decision.state.key).toMatch(/^FIRST_WEEK_(SUMMARY_READY|WELCOME_BACK)$/);
    }
  });

  it("beats the evening and the morning", () => {
    expect(resolveHome(facts("2027-01-12T17:00:00Z", { firstWeek: READY_ENOUGH })).state.key).toBe("FIRST_WEEK_SUMMARY_READY");
    expect(resolveHome(facts("2027-01-12T05:00:00Z", { firstWeek: WELCOME_BACK })).state.key).toBe("FIRST_WEEK_WELCOME_BACK");
  });

  it("keeps First Week Start for a FIRST_WEEK person with no report and nothing ready", () => {
    const decision = resolveHome(facts(MIDDAY, { hasAnyReport: false, firstWeek: { availableDays: 1, confirmedMeals: 0, availableDaysSinceLastMeal: null } }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });
  });
});

describe("resolveHome: First Week Start needs the lifecycle FIRST_WEEK", () => {
  it.each<LifecycleState | null>(["WEEKLY_CYCLE", "ONBOARDING", "NEW", null])(
    "never shows it for the lifecycle %s, even with no report at all",
    (lifecycle) => {
      for (const now of [MIDDAY, "2027-01-12T05:00:00Z", "2027-01-12T17:00:00Z", "2027-01-12T01:00:00Z"]) {
        const decision = resolveHome(facts(now, { lifecycle, firstWeek: null, hasAnyReport: lifecycle === null ? null : false }));
        expect(decision.state.key).not.toBe("FIRST_WEEK_START");
      }
    },
  );

  it("gives a WEEKLY_CYCLE person with no report the clock states, with today's invitation where it applies", () => {
    const morning = resolveHome(facts("2027-01-12T05:00:00Z", { lifecycle: "WEEKLY_CYCLE", firstWeek: null, hasAnyReport: false }));
    expect(morning.state).toEqual({ key: "MORNING" });
    expect(morning.action).toEqual({ kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" });

    const midday = resolveHome(facts(MIDDAY, { lifecycle: "WEEKLY_CYCLE", firstWeek: null, hasAnyReport: false }));
    expect(label(midday.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(midday.action).toBeNull();
    expect(midday.degraded).toBe(false);
  });

  it("ignores a stale non-null First Week fact outside FIRST_WEEK (bad data never creates a card)", () => {
    for (const lifecycle of ["WEEKLY_CYCLE", null] as const) {
      for (const firstWeek of [READY_ENOUGH, WELCOME_BACK, READY_NO_MEALS]) {
        const decision = resolveHome(facts(MIDDAY, { lifecycle, firstWeek, hasAnyReport: true }));
        expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
        expect(decision.action).toBeNull();
      }
    }
  });
});

describe("resolveHome: 'Not now'", () => {
  it("lets a snoozed summary fall to the clock states and NEVER to First Week Start, even with no report", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: READY_NO_MEALS, hasAnyReport: false, firstWeekSnoozed: snoozed({ summary: true }) }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
    expect(decision.state.key).not.toBe("FIRST_WEEK_START");
    expect(decision.action).toBeNull();
  });

  it("lets a snoozed summary with enough meals fall to the clock state", () => {
    const decision = resolveHome(facts("2027-01-12T17:00:00Z", { firstWeek: READY_ENOUGH, firstWeekSnoozed: snoozed({ summary: true }) }));
    expect(decision.state).toEqual({ key: "EVENING" });
  });

  it("lets a snoozed welcome-back fall to the clock states", () => {
    const decision = resolveHome(facts("2027-01-12T17:00:00Z", { firstWeek: WELCOME_BACK, firstWeekSnoozed: snoozed({ welcomeBack: true }) }));
    expect(decision.state).toEqual({ key: "EVENING" });
    expect(decision.action).toBeNull();
  });

  it("does not let a snoozed summary hide the welcome-back, nor the reverse (independent flags)", () => {
    expect(resolveHome(facts(MIDDAY, { firstWeek: WELCOME_BACK, firstWeekSnoozed: snoozed({ summary: true }) })).state).toEqual({
      key: "FIRST_WEEK_WELCOME_BACK",
    });
    expect(resolveHome(facts(MIDDAY, { firstWeek: READY_ENOUGH, firstWeekSnoozed: snoozed({ welcomeBack: true }) })).state).toEqual({
      key: "FIRST_WEEK_SUMMARY_READY",
      hadEnoughData: true,
    });
  });

  it("does not let a summary snooze turn the welcome-back into the summary (they are different steps)", () => {
    // Ready and away, summary snoozed: the step is still SUMMARY_READY, so no second card and no First Week Start.
    const both: FirstWeekProgress = { availableDays: 15, confirmedMeals: 4, availableDaysSinceLastMeal: 3 };
    const decision = resolveHome(facts(MIDDAY, { firstWeek: both, firstWeekSnoozed: snoozed({ summary: true }) }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
  });

  it.each<LifecycleState | null>(["WEEKLY_CYCLE", null])("ignores snooze flags when the lifecycle is %s", (lifecycle) => {
    const decision = resolveHome(
      facts(MIDDAY, { lifecycle, firstWeek: null, hasAnyReport: lifecycle === null ? null : false, firstWeekSnoozed: { summary: true, welcomeBack: true } }),
    );
    expect(decision.state.key).not.toBe("FIRST_WEEK_START");
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
  });
});

describe("resolveHome: unknown First Week facts", () => {
  it("marks the decision degraded when the lifecycle is FIRST_WEEK and the counts could not be read", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: null }));
    expect(decision.degraded).toBe(true);
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
  });

  it("keeps First Week Start working when the counts could not be read (B1 does not depend on them)", () => {
    const decision = resolveHome(facts(MIDDAY, { firstWeek: null, hasAnyReport: false }));
    expect(decision.state).toEqual({ key: "FIRST_WEEK_START" });
    expect(decision.degraded).toBe(true);
  });

  it("is not degraded by a null First Week fact outside FIRST_WEEK", () => {
    expect(resolveHome(facts(MIDDAY, { lifecycle: "WEEKLY_CYCLE", firstWeek: null })).degraded).toBe(false);
    expect(resolveHome(facts(MIDDAY, { lifecycle: "FIRST_WEEK", firstWeek: KEEP_GOING })).degraded).toBe(false);
  });

  it("shows no First Week state at all for an unknown lifecycle", () => {
    const decision = resolveHome(facts(MIDDAY, { lifecycle: null, firstWeek: READY_ENOUGH }));
    expect(label(decision.state)).toBe("SILENCE/NOTHING_TO_SAY");
  });
});

describe("resolveHome: daylight saving time (the First Week rules use counts, not the clock)", () => {
  const ordinary = (progress: FirstWeekProgress) => resolveHome(facts(MIDDAY, { firstWeek: progress, offlinePeriods: [] })).state;

  it.each([
    ["spring forward 2027-03-26, 12:00 IDT", "2027-03-26T09:00:00Z"],
    ["spring forward 2027-03-26, 01:30 IST (before the jump)", "2027-03-25T23:30:00Z"],
    ["fall back 2026-10-25, 12:00 IST", "2026-10-25T10:00:00Z"],
    ["fall back 2026-10-25, the repeated 01:30 IST", "2026-10-24T23:30:00Z"],
  ])("gives the same state on %s as on an ordinary day", (_name, now) => {
    for (const progress of [READY_ENOUGH, READY_LITTLE, WELCOME_BACK, KEEP_GOING]) {
      expect(resolveHome(facts(now, { firstWeek: progress, offlinePeriods: [] })).state).toEqual(ordinary(progress));
    }
  });
});
