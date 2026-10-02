import { describe, expect, it } from "vitest";
import { FIRST_WEEK } from "../firstWeek";
import { instantAfterDays } from "../asOf";
import type { OfflinePeriod } from "../offline";
import { decideFirstWeekStep, deriveFirstWeekProgress } from "./progress";
import { FIRST_WEEK_RECOVERY, type FirstWeekProgress } from "./types";

const TZ = "Asia/Jerusalem";

// Sunday 2027-01-10 10:00 local (UTC+2). The following days have no offline period in these fixtures.
const STARTED = new Date("2027-01-10T08:00:00Z");

/** `n` meal times on one local day, all well before `now` in the cases that use them. */
const mealsOn = (isoDay: string, n: number): Date[] =>
  Array.from({ length: n }, (_, i) => new Date(`${isoDay}T${String(6 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`));

const step = (input: Parameters<typeof deriveFirstWeekProgress>[0]) => decideFirstWeekStep(deriveFirstWeekProgress(input));

function derive(days: number, recentMealTimes: readonly Date[], periods: readonly OfflinePeriod[] = []) {
  return deriveFirstWeekProgress({
    periods,
    timeZone: TZ,
    startedAt: STARTED,
    now: instantAfterDays({ startedAt: STARTED, days, timeZone: TZ }),
    recentMealTimes,
  });
}

describe("decideFirstWeekStep: the thresholds, through the real derive", () => {
  // The meals sit on the last full day so the welcome-back rule never interferes.
  const lastDayMeals = (days: number, n: number) => {
    const day = instantAfterDays({ startedAt: STARTED, days: days - 1, time: "08:00", timeZone: TZ });
    return Array.from({ length: n }, (_, i) => new Date(day.getTime() + i * 60_000));
  };

  it.each([
    // [available days, meals, expected]
    [4, 10, "KEEP_GOING"],
    [5, 10, "SUMMARY_READY"],
    [5, 9, "KEEP_GOING"],
    [4, 9, "KEEP_GOING"],
    [6, 10, "SUMMARY_READY"],
  ] as const)("%i available days and %i meals -> %s", (days, meals, expected) => {
    const now = instantAfterDays({ startedAt: STARTED, days, timeZone: TZ });
    const progress = deriveFirstWeekProgress({
      periods: [],
      timeZone: TZ,
      startedAt: STARTED,
      now,
      recentMealTimes: lastDayMeals(days, meals),
    });
    expect(progress.availableDays).toBe(days);
    expect(decideFirstWeekStep(progress).kind).toBe(expected);
  });

  it("reports enough_data with hadEnoughData true at 5 days and 10 meals", () => {
    const now = instantAfterDays({ startedAt: STARTED, days: 5, timeZone: TZ });
    expect(step({ periods: [], timeZone: TZ, startedAt: STARTED, now, recentMealTimes: lastDayMeals(5, 10) })).toEqual({
      kind: "SUMMARY_READY",
      reason: "enough_data",
      hadEnoughData: true,
    });
  });

  it("14 available days with no meals is KEEP_GOING; 15 is SUMMARY_READY max_days_reached without enough data", () => {
    expect(step({ periods: [], timeZone: TZ, startedAt: STARTED, now: instantAfterDays({ startedAt: STARTED, days: 14, timeZone: TZ }), recentMealTimes: [] }).kind).toBe("KEEP_GOING");
    expect(step({ periods: [], timeZone: TZ, startedAt: STARTED, now: instantAfterDays({ startedAt: STARTED, days: 15, timeZone: TZ }), recentMealTimes: [] })).toEqual({
      kind: "SUMMARY_READY",
      reason: "max_days_reached",
      hadEnoughData: false,
    });
  });

  it("15 available days with 10 meals says it had enough data", () => {
    const now = instantAfterDays({ startedAt: STARTED, days: 15, timeZone: TZ });
    expect(step({ periods: [], timeZone: TZ, startedAt: STARTED, now, recentMealTimes: lastDayMeals(15, 10) })).toMatchObject({
      reason: expect.any(String),
      hadEnoughData: true,
    });
  });

  it("uses the thresholds of firstWeek.ts, not copies", () => {
    expect(FIRST_WEEK).toEqual({ minAvailableDays: 5, maxAvailableDays: 15, minConfirmedMeals: 10 });
    expect(FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal).toBe(3);
  });
});

describe("deriveFirstWeekProgress: the counts", () => {
  it("caps confirmedMeals at the 10 meals the rules need", () => {
    expect(derive(2, mealsOn("2027-01-11", 25)).confirmedMeals).toBe(10);
    expect(derive(2, mealsOn("2027-01-11", 10)).confirmedMeals).toBe(10);
    expect(derive(2, mealsOn("2027-01-11", 9)).confirmedMeals).toBe(9);
    expect(derive(2, []).confirmedMeals).toBe(0);
  });

  it("caps availableDays at the 15 the rules need (no walk past the maximum)", () => {
    expect(derive(40, []).availableDays).toBe(FIRST_WEEK.maxAvailableDays);
  });

  it("excludes offline days: a Shabbat inside the range gives one fewer day", () => {
    const shabbat: OfflinePeriod = {
      type: "SHABBAT",
      start: new Date("2027-01-15T14:10:00Z"), // Friday 16:10 local
      end: new Date("2027-01-16T15:25:00Z"), // Saturday 17:25 local
    };
    // Sunday 10 to Monday 18: eight whole days have ended (Sun..Sun), Saturday is not available.
    expect(derive(8, [], []).availableDays).toBe(8);
    expect(derive(8, [], [shabbat]).availableDays).toBe(7);
  });

  it("is null for the days since the last meal when there is no meal", () => {
    expect(derive(3, []).availableDaysSinceLastMeal).toBeNull();
  });

  describe("availableDaysSinceLastMeal", () => {
    // Monday 2027-01-11 10:00 local (08:00Z) is the newest meal.
    const monday = new Date("2027-01-11T08:00:00Z");
    const since = (now: string, meals: readonly Date[] = [monday], periods: readonly OfflinePeriod[] = []) =>
      deriveFirstWeekProgress({ periods, timeZone: TZ, startedAt: STARTED, now: new Date(now), recentMealTimes: meals }).availableDaysSinceLastMeal;

    it("is 3 on Friday 00:00 and 2 on Thursday 23:59 (the count starts at the end of the meal's own day)", () => {
      expect(since("2027-01-14T22:00:00Z")).toBe(3); // Friday 00:00 local: Tue, Wed, Thu have ended
      expect(since("2027-01-14T21:59:00Z")).toBe(2); // Thursday 23:59 local
    });

    it("is 0 on the day of the meal itself and the day after", () => {
      expect(since("2027-01-11T18:00:00Z")).toBe(0);
      expect(since("2027-01-12T10:00:00Z")).toBe(0);
    });

    it("stops counting at the welcome-back threshold (3)", () => {
      expect(since("2027-01-25T10:00:00Z")).toBe(FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal);
    });

    it("does not count a Shabbat in between: Thursday meal, Shabbat, Monday morning is Friday and Sunday only", () => {
      const thursday = new Date("2027-01-07T08:00:00Z");
      const shabbat: OfflinePeriod = {
        type: "SHABBAT",
        start: new Date("2027-01-08T14:10:00Z"),
        end: new Date("2027-01-09T15:25:00Z"),
      };
      expect(since("2027-01-11T07:00:00Z", [thursday], [shabbat])).toBe(2);
      expect(since("2027-01-11T07:00:00Z", [thursday], [])).toBe(3);
    });

    it("is 0 for a meal after `now`", () => {
      expect(since("2027-01-10T20:00:00Z", [monday])).toBe(0);
    });
  });
});

describe("the welcome-back step", () => {
  // Monday 2027-01-11: First Week started that morning and the one meal is at 10:00.
  const startedAt = new Date("2027-01-11T06:00:00Z");
  const meal = new Date("2027-01-11T08:00:00Z");
  const at = (now: string) => step({ periods: [], timeZone: TZ, startedAt, now: new Date(now), recentMealTimes: [meal] }).kind;

  it("is WELCOME_BACK at 3 whole days without a meal and KEEP_GOING at 2", () => {
    expect(at("2027-01-14T21:59:00Z")).toBe("KEEP_GOING"); // Thursday 23:59: two days
    expect(at("2027-01-14T22:00:00Z")).toBe("WELCOME_BACK"); // Friday 00:00: three days
  });

  it("is overtaken by SUMMARY_READY, which is overtaken by nothing", () => {
    expect(decideFirstWeekStep({ availableDays: 15, confirmedMeals: 0, availableDaysSinceLastMeal: 3 }).kind).toBe("SUMMARY_READY");
    expect(decideFirstWeekStep({ availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 3 }).kind).toBe("SUMMARY_READY");
    expect(decideFirstWeekStep({ availableDays: 5, confirmedMeals: 9, availableDaysSinceLastMeal: 3 }).kind).toBe("WELCOME_BACK");
    expect(decideFirstWeekStep({ availableDays: 2, confirmedMeals: 3, availableDaysSinceLastMeal: 0 }).kind).toBe("KEEP_GOING");
  });

  it("is never WELCOME_BACK when there has been no meal at all (that is B1, not an absence)", () => {
    expect(decideFirstWeekStep({ availableDays: 4, confirmedMeals: 0, availableDaysSinceLastMeal: null }).kind).toBe("KEEP_GOING");
  });
});

describe("deriveFirstWeekProgress: robustness", () => {
  const now = instantAfterDays({ startedAt: STARTED, days: 6, timeZone: TZ });
  const meals = [
    new Date("2027-01-12T08:00:00Z"),
    new Date("2027-01-13T08:00:00Z"),
    new Date("2027-01-15T08:00:00Z"),
    new Date("2027-01-11T08:00:00Z"),
  ];
  const base = { periods: [] as OfflinePeriod[], timeZone: TZ, startedAt: STARTED, now };

  it("does not depend on the order of the meal times (it sorts a copy itself)", () => {
    const expected = deriveFirstWeekProgress({ ...base, recentMealTimes: meals });
    const oldestFirst = [...meals].sort((a, b) => a.getTime() - b.getTime());
    const newestFirst = [...oldestFirst].reverse();
    const shuffled = [meals[2], meals[0], meals[3], meals[1]];
    for (const order of [oldestFirst, newestFirst, shuffled]) {
      expect(deriveFirstWeekProgress({ ...base, recentMealTimes: order })).toEqual(expected);
    }
    // The newest meal is Friday the 15th, so the absence is measured from there, not from element 0.
    expect(expected.availableDaysSinceLastMeal).toBe(0);
  });

  it("does not mutate its input", () => {
    const input = [...meals];
    const snapshot = input.map((d) => d.getTime());
    const periods: OfflinePeriod[] = [];
    deriveFirstWeekProgress({ ...base, periods, recentMealTimes: input });
    expect(input.map((d) => d.getTime())).toEqual(snapshot);
    expect(periods).toEqual([]);
  });

  it("gives zeros and null, and never throws, for an invalid start or now", () => {
    const zeros: FirstWeekProgress = { availableDays: 0, confirmedMeals: 0, availableDaysSinceLastMeal: null };
    expect(deriveFirstWeekProgress({ ...base, startedAt: new Date("nope"), recentMealTimes: meals })).toEqual(zeros);
    expect(deriveFirstWeekProgress({ ...base, now: new Date("nope"), recentMealTimes: meals })).toEqual(zeros);
  });

  it("ignores an invalid meal time", () => {
    const withBad = [new Date("nope"), ...meals];
    expect(deriveFirstWeekProgress({ ...base, recentMealTimes: withBad })).toEqual(
      deriveFirstWeekProgress({ ...base, recentMealTimes: meals }),
    );
    expect(deriveFirstWeekProgress({ ...base, recentMealTimes: [new Date("nope")] })).toMatchObject({
      confirmedMeals: 0,
      availableDaysSinceLastMeal: null,
    });
  });

  it.each(["Not/AZone", "", "123"])("treats the time zone %j like Jerusalem", (timeZone) => {
    expect(deriveFirstWeekProgress({ ...base, timeZone, recentMealTimes: meals })).toEqual(
      deriveFirstWeekProgress({ ...base, recentMealTimes: meals }),
    );
  });

  it("answers in the zone given: a meal at 22:30Z on Sunday is Monday in Jerusalem but still Sunday in UTC", () => {
    const late = [new Date("2027-01-10T22:30:00Z")];
    const nowAt = new Date("2027-01-13T00:00:00Z"); // Wednesday 00:00 UTC, 02:00 Jerusalem
    const jerusalem = deriveFirstWeekProgress({ periods: [], timeZone: TZ, startedAt: STARTED, now: nowAt, recentMealTimes: late });
    const utc = deriveFirstWeekProgress({ periods: [], timeZone: "UTC", startedAt: STARTED, now: nowAt, recentMealTimes: late });
    // Jerusalem: meal on Monday, so Mon end .. Wed 00:00 local: Tue = 1. UTC: meal on Sunday: Mon, Tue = 2.
    expect(jerusalem.availableDaysSinceLastMeal).toBe(1);
    expect(utc.availableDaysSinceLastMeal).toBe(2);
  });
});
