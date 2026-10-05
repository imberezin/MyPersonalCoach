import { describe, expect, it } from "vitest";
import { GOAL_FOCUS_KEYS } from "@/domain/onboarding/model";
import {
  DEFAULT_GOALS,
  DEFAULT_MOTIVATION,
  DEFAULT_SEED_EMAIL,
  SEED_PRESETS,
  SEED_SCENARIOS,
  parseSeedArgs,
  type SeedOptions,
} from "../../scripts/seed-demo/args";

type Flags = Record<string, string | number | boolean | string[]>;
const parse = (flags: Flags) => parseSeedArgs(JSON.stringify(flags));
function ok(flags: Flags): SeedOptions {
  const result = parse(flags);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}
function error(flags: Flags): string {
  const result = parse(flags);
  if (result.ok) throw new Error(`expected an error for ${JSON.stringify(flags)}`);
  return result.error;
}

describe("defaults", () => {
  it("no flags is a seeding run with the documented defaults (16.5)", () => {
    expect(parseSeedArgs(undefined)).toEqual(parseSeedArgs(""));
    expect(parseSeedArgs("{}")).toEqual(parseSeedArgs(undefined));
    expect(ok({})).toEqual({
      email: DEFAULT_SEED_EMAIL,
      scenario: null,
      action: "seed",
      days: 8,
      startDate: "2026-09-13",
      mode: "fixed",
      mealsPerDay: 3,
      lateDays: [2, 3, 4, 8],
      doubleLateDays: [],
      gapDays: [5],
      shabbat: true,
      aggregatedSaturdayNight: null,
      totalMeals: null,
      seed: 1,
      timeZone: "Asia/Jerusalem",
      asOf: null,
      clockShift: null,
      clockOff: false,
      clockOnly: false,
      fresh: false,
      reset: false,
      explain: false,
      dropMeals: null,
      goals: ["improve_eating", "understand_overeating"],
      motivation: DEFAULT_MOTIVATION,
      explainDailyCap: 40,
      dropWeights: null,
      lifecycle: "first_week",
      startWeightKg: 80,
      goalWeightKg: 72,
      weights: "none",
      weightSeries: null,
      weighDay: 5,
      weighTime: "08:00",
      weightDrift: -0.1,
      weightNoise: 0.6,
      junkWeights: false,
      junkDay: 30,
      observesShabbat: true,
      transitionDay: null,
      firstWeighDay: null,
      experiments: [],
      patternAnswer: null,
      weeklyOpened: null,
    });
  });

  it("the default goals and the default motivation are the documented ones, and the motivation has no digit", () => {
    expect(DEFAULT_GOALS).toEqual(["improve_eating", "understand_overeating"]);
    expect(DEFAULT_MOTIVATION).not.toMatch(/\d/);
    expect(DEFAULT_MOTIVATION.length).toBeGreaterThan(5);
    expect(DEFAULT_MOTIVATION.length).toBeLessThan(60);
  });
});

describe("every flag parses", () => {
  it("a value for each", () => {
    const o = ok({
      email: "Other@Eating-Coach.test",
      scenario: "day3",
      days: "10",
      "meals-per-day": "4",
      "late-days": "1,3",
      "double-late-days": "3",
      "gap-days": "2",
      shabbat: "false",
      "aggregated-saturday-night": "true",
      "total-meals": "12",
      mode: "relative",
      tz: "Europe/London",
      seed: "42",
      "daily-cap": "9",
      goals: "lose_weight,be_active",
      motivation: "  to feel better  ",
    });
    expect(o).toMatchObject({
      email: "other@eating-coach.test",
      scenario: "day3",
      days: 10,
      mealsPerDay: 4,
      lateDays: [1, 3],
      doubleLateDays: [3],
      gapDays: [2],
      shabbat: false,
      aggregatedSaturdayNight: true,
      totalMeals: 12,
      mode: "relative",
      timeZone: "Europe/London",
      seed: 42,
      explainDailyCap: 9,
      goals: ["lose_weight", "be_active"],
      motivation: "to feel better",
    });
  });

  it("--start and --as-of in fixed mode", () => {
    expect(ok({ start: "2026-10-04", "as-of": "day 3 21:30" })).toMatchObject({ startDate: "2026-10-04", asOf: "day 3 21:30" });
    expect(ok({ "as-of": "day 12" }).asOf).toBe("day 12");
    expect(ok({ "as-of": "2026-09-17T09:00:00+03:00" }).asOf).toBe("2026-09-17T09:00:00+03:00");
    expect(ok({ "as-of": "2026-09-17T06:00:00Z" }).asOf).toBe("2026-09-17T06:00:00Z");
  });

  it("the switches take no value, or an explicit true", () => {
    expect(ok({ fresh: true })).toMatchObject({ fresh: true, action: "seed" });
    expect(ok({ explain: true, scenario: "day3" })).toMatchObject({ explain: true, action: "seed" });
    expect(ok({ reset: true })).toMatchObject({ reset: true, action: "reset" });
    expect(ok({ "clock-only": true })).toMatchObject({ clockOnly: true, action: "clock" });
    expect(ok({ "clock-off": true })).toMatchObject({ clockOff: true, clockOnly: true, action: "clock" });
    expect(ok({ "clock-shift": "+25h" })).toMatchObject({ clockShift: "+25h", clockOnly: true, action: "clock" });
    expect(ok({ fresh: "true" }).fresh).toBe(true);
  });

  it("--drop-meals takes a count or all", () => {
    expect(ok({ "drop-meals": "3" })).toMatchObject({ dropMeals: 3, action: "drop" });
    expect(ok({ "drop-meals": "all", explain: true })).toMatchObject({ dropMeals: "all", action: "drop", explain: true });
  });

  it("--late-days, --double-late-days and --gap-days accept none", () => {
    expect(ok({ "late-days": "none", "double-late-days": "none", "gap-days": "none" })).toMatchObject({ lateDays: [], doubleLateDays: [], gapDays: [] });
  });

  it("day lists are sorted and de-duplicated", () => {
    expect(ok({ "late-days": "4, 2,2,3" }).lateDays).toEqual([2, 3, 4]);
  });
});

describe("what is refused", () => {
  it("an unknown flag", () => {
    expect(error({ nope: "1" })).toMatch(/Unknown flag --nope/);
  });

  it("there is no flag for a password, a key or a URL (the parser has no such option)", () => {
    for (const flag of ["password", "pass", "secret", "key", "token", "api-key", "service-role", "supabase-url", "url", "env", "env-file", "user-id"]) {
      expect(error({ [flag]: "x" }), flag).toMatch(/Unknown flag/);
    }
  });

  it("--days must be a whole number from 1 to 60", () => {
    for (const days of ["0", "-1", "3.5", "abc", "", "61", "400", "1e2"]) expect(error({ days }), `days=${days}`).toMatch(/--days/);
    expect(error({ days: true })).toMatch(/--days/);
    expect(ok({ days: "1" }).days).toBe(1);
    expect(ok({ days: "60" }).days).toBe(60);
    expect(ok({ days: 7 }).days).toBe(7);
  });

  it("--late-days are 1-based", () => {
    expect(error({ "late-days": "0,2" })).toMatch(/1-based/);
    expect(error({ "late-days": "a" })).toMatch(/--late-days/);
    expect(error({ "late-days": "61" })).toMatch(/--late-days/);
    expect(error({ "late-days": "" })).toMatch(/--late-days/);
  });

  it("a malformed --as-of", () => {
    for (const asOf of ["tomorrow", "day", "day x", "day 3 25:00", "day 3 9:00", "2026-09-17", "2026-09-17T09:00:00", "2026-02-30T09:00:00+02:00", "day -1", ""]) {
      expect(error({ "as-of": asOf }), asOf).toMatch(/--as-of/);
    }
  });

  it("--meals-per-day, --total-meals, --seed, --daily-cap and --start", () => {
    expect(error({ "meals-per-day": "6" })).toMatch(/--meals-per-day/);
    expect(error({ "meals-per-day": "-1" })).toMatch(/--meals-per-day/);
    expect(error({ "total-meals": "x" })).toMatch(/--total-meals/);
    expect(error({ seed: "-3" })).toMatch(/--seed/);
    expect(error({ "daily-cap": "0" })).toMatch(/--daily-cap/);
    expect(error({ "daily-cap": "abc" })).toMatch(/--daily-cap/);
    expect(error({ start: "2026-02-30" })).toMatch(/--start/);
    expect(error({ start: "13/09/2026" })).toMatch(/--start/);
    expect(error({ tz: "Mars/Olympus" })).toMatch(/--tz/);
    expect(error({ mode: "later" })).toMatch(/--mode/);
    expect(error({ shabbat: "maybe" })).toMatch(/--shabbat/);
    expect(error({ scenario: "day99" })).toMatch(/--scenario/);
    expect(error({ "clock-shift": "25h" })).toMatch(/--clock-shift/);
    expect(error({ "clock-shift": "+25x" })).toMatch(/--clock-shift/);
    expect(error({ "drop-meals": "0" })).toMatch(/--drop-meals/);
    expect(error({ "drop-meals": "some" })).toMatch(/--drop-meals/);
  });

  it("an e-mail that is not a throwaway one", () => {
    for (const email of ["owner@gmail.com", "x@eating-coach.test.evil.com", "@eating-coach.test", "", "a b@eating-coach.test"]) {
      expect(error({ email }), email).toMatch(/--email/);
    }
  });

  it("SEED_ARGS that is not an object", () => {
    expect(parseSeedArgs("{")).toEqual({ ok: false, error: "SEED_ARGS is not valid JSON" });
    for (const raw of ["[]", "3", "null", '"x"']) expect(parseSeedArgs(raw)).toEqual({ ok: false, error: "SEED_ARGS must be an object" });
  });

  it("relative mode counts back from today, so it takes neither --start nor --as-of", () => {
    expect(error({ mode: "relative", "as-of": "day 3" })).toMatch(/--as-of/);
    expect(error({ mode: "relative", start: "2026-09-13" })).toMatch(/--start/);
  });
});

describe("--reset and --fresh", () => {
  it("are mutually exclusive", () => {
    expect(error({ reset: true, fresh: true })).toMatch(/--reset and --fresh/);
  });

  it("--reset accepts only --email (a reset is a reset)", () => {
    expect(ok({ reset: true, email: "x@eating-coach.test" })).toMatchObject({ action: "reset", email: "x@eating-coach.test" });
    for (const other of <Flags[]>[{ scenario: "day3" }, { explain: true }, { days: "3" }, { "clock-off": true }, { "drop-meals": "1" }, { goals: "none" }]) {
      expect(error({ reset: true, ...other }), JSON.stringify(other)).toMatch(/--reset accepts only --email/);
    }
  });

  it("--fresh takes the same flags as a seeding run", () => {
    expect(
      ok({ fresh: true, scenario: "day5-early-finish", "late-days": "none", "total-meals": "10", goals: "lose_weight", motivation: "none", mode: "relative", seed: "3" }),
    ).toMatchObject({
      fresh: true,
      action: "seed",
      scenario: "day5-early-finish",
      lateDays: [],
      totalMeals: 10,
      goals: ["lose_weight"],
      motivation: null,
    });
  });

  it("--drop-meals accepts only --email and --explain", () => {
    expect(error({ "drop-meals": "1", scenario: "day3" })).toMatch(/--drop-meals accepts only/);
    expect(error({ "drop-meals": "1", fresh: true })).toMatch(/--drop-meals accepts only/);
  });
});

describe("presets (16.5): each fills its documented defaults, and explicit flags win", () => {
  // The weight presets (15.3): weight only, the First Week is over, days = 3 mod 7 so the clock is a Wednesday.
  const W = { mealsPerDay: 0, lateDays: [], gapDays: [], doubleLateDays: [], aggregatedSaturdayNight: false, totalMeals: null, lifecycle: "weekly_cycle", startWeightKg: 80, goalWeightKg: 72, junkWeights: false } as const;
  const DOWN = { ...W, days: 45, weights: "weekly", weightSeries: [79.6, 78.9, 78.1, 77.4, 76.9, 76.2] } as const;
  // The Weekly Learning presets (15.2): the First Week ended on day 8, three meals a day, no gap, no after-Shabbat report, 80 -> 72 kg.
  const WK = {
    mealsPerDay: 3,
    gapDays: [],
    doubleLateDays: [],
    aggregatedSaturdayNight: false,
    totalMeals: null,
    lifecycle: "weekly_cycle",
    transitionDay: 8,
    startWeightKg: 80,
    goalWeightKg: 72,
    weighDay: 5,
    firstWeighDay: null,
    shabbat: true,
    observesShabbat: true,
    junkWeights: false,
    experiments: [],
    patternAnswer: null,
    weeklyOpened: null,
  } as const;
  const EXPECTED = {
    "w-none": { ...W, days: 24, weights: "none", weightSeries: null },
    "w-one": { ...W, days: 10, weights: "weekly", weightSeries: [79.5] },
    "w-down": DOWN,
    "w-milestone": { ...W, days: 45, weights: "weekly", weightSeries: [80.4, 79.6, 78.2, 77.0, 74.9, 74.6] },
    "w-goal": { ...W, days: 52, weights: "weekly", weightSeries: [79.0, 77.0, 74.8, 74.0, 72.6, 71.9, 71.6] },
    "w-steady": { ...W, days: 38, weights: "weekly", weightSeries: [78.2, 78.1, 78.3, 78.2, 78.1] },
    "w-rising": { ...W, days: 31, startWeightKg: 76, weights: "weekly", weightSeries: [76.4, 76.9, 77.5, 78.2] },
    "w-daily": { ...W, days: 31, weights: "daily", weightSeries: null },
    "w-junk": { ...DOWN, junkWeights: true },
    "w-nogoal": { ...DOWN, goalWeightKg: null },
    "day1-empty": { days: 1, mealsPerDay: 0, lateDays: [], gapDays: [], doubleLateDays: [], aggregatedSaturdayNight: false, totalMeals: null },
    day3: { days: 3, mealsPerDay: 3, lateDays: [2, 3], gapDays: [], doubleLateDays: [], aggregatedSaturdayNight: null, totalMeals: null },
    "day4-candidate": { days: 4, mealsPerDay: 3, lateDays: [2, 3, 4], gapDays: [], doubleLateDays: [4], aggregatedSaturdayNight: null, totalMeals: null },
    "day5-early-finish": { days: 5, mealsPerDay: 3, lateDays: [2, 3, 4, 5], gapDays: [], doubleLateDays: [], aggregatedSaturdayNight: null, totalMeals: null },
    absence: { days: 5, mealsPerDay: 3, lateDays: [], gapDays: [3, 4, 5], doubleLateDays: [], aggregatedSaturdayNight: null, totalMeals: null },
    "shabbat-week": { days: 8, mealsPerDay: 3, lateDays: [2, 3], gapDays: [5], doubleLateDays: [], aggregatedSaturdayNight: null, totalMeals: null },
    "max-days": { days: 17, mealsPerDay: 1, lateDays: [], gapDays: [], doubleLateDays: [], aggregatedSaturdayNight: false, totalMeals: 2 },
    "w2-learn": { ...WK, days: 14, lateDays: [2, 3, 9, 10, 11, 12], weights: "none", weightSeries: null },
    "w2-celebrate": { ...WK, days: 21, lateDays: [], goalWeightKg: 70, weights: "weekly", weightSeries: [75.9, 74.8, 74.6] },
    "w2-recover": { ...WK, days: 14, lateDays: [], gapDays: [9, 10, 11], weights: "none", weightSeries: null },
    "w2-quiet-none": { ...WK, days: 14, lateDays: [], gapDays: [9, 10, 11, 12, 13], weights: "none", weightSeries: null },
    "w2-quiet-card": { ...WK, days: 14, lateDays: [], gapDays: [9, 10, 12, 13], weights: "none", weightSeries: null },
    "w2-too-short": { ...WK, days: 14, lateDays: [], transitionDay: 12, weights: "none", weightSeries: null },
    "w2-first-weigh-in": { ...WK, days: 14, lateDays: [], firstWeighDay: 9, weighDay: 1, weights: "weekly", weightSeries: [79.8] },
    "w2-shabbat-rows-missing": { ...WK, days: 14, lateDays: [], gapDays: [9, 10, 11], shabbat: false, observesShabbat: true, weights: "none", weightSeries: null },
    "w3-result-due": { ...WK, days: 21, lateDays: [2, 3, 9, 10, 17], weights: "none", weightSeries: null, experiments: [{ status: "ACTIVE", day: 9, key: "eat_intentionally", result: null }] },
    "w4-history-rotation": {
      ...WK,
      days: 28,
      lateDays: [9, 10, 16, 17, 24],
      weights: "weekly",
      weightSeries: [79.4, 79.8, 80.3, 80.9],
      experiments: [
        { status: "DONE", day: 9, key: "eat_intentionally", result: "helpful" },
        { status: "DONE", day: 16, key: "slow_down", result: "not_tried" },
      ],
    },
    "w4-down": { ...WK, days: 28, lateDays: [], weights: "weekly", weightSeries: [79.6, 78.9, 78.1, 77.4] },
    "w4-goal": { ...WK, days: 28, lateDays: [], weights: "weekly", weightSeries: [78.0, 75.5, 71.9, 71.6] },
  } as const;

  it("covers every scenario", () => {
    expect([...SEED_SCENARIOS].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(SEED_PRESETS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(SEED_SCENARIOS)("%s", (scenario) => {
    expect(ok({ scenario })).toMatchObject({ scenario, action: "seed", ...EXPECTED[scenario] });
  });

  it("explicit flags override a preset", () => {
    expect(ok({ scenario: "day5-early-finish", "late-days": "none" }).lateDays).toEqual([]);
    expect(ok({ scenario: "day5-early-finish", "total-meals": "10" }).totalMeals).toBe(10);
    expect(ok({ scenario: "max-days", days: "16" }).days).toBe(16);
    expect(ok({ scenario: "max-days", "total-meals": "0" }).totalMeals).toBe(0);
    expect(ok({ scenario: "day3", "meals-per-day": "1" }).mealsPerDay).toBe(1);
    expect(ok({ scenario: "absence", "gap-days": "none" }).gapDays).toEqual([]);
    expect(ok({ scenario: "shabbat-week", shabbat: "false" }).shabbat).toBe(false);
  });
});

describe("the Weekly Learning flags (15.1)", () => {
  it("every flag parses", () => {
    const o = ok({
      days: "28",
      "transition-day": "8",
      "first-weigh-day": "9",
      weights: "weekly",
      exp: ["done@9:helpful:slow_down", "active@16"],
      "pattern-answer": "confirm@10",
      "weekly-opened": "15",
    });
    expect(o).toMatchObject({
      lifecycle: "weekly_cycle",
      transitionDay: 8,
      firstWeighDay: 9,
      weights: "weekly",
      patternAnswer: { answer: "confirm", day: 10 },
      weeklyOpened: 15,
      action: "seed",
      experiments: [
        { status: "DONE", day: 9, key: "slow_down", result: "helpful" },
        { status: "ACTIVE", day: 16, key: "eat_intentionally", result: null },
      ],
    });
  });

  it("--transition-day implies the weekly cycle, is refused next to --lifecycle first_week and must be a day of the run (2 up to the as-of day)", () => {
    expect(ok({ days: "10", "transition-day": "8" })).toMatchObject({ lifecycle: "weekly_cycle", transitionDay: 8 });
    expect(ok({ days: "10", lifecycle: "weekly_cycle", "transition-day": "10" }).transitionDay).toBe(10);
    expect(error({ days: "10", lifecycle: "first_week", "transition-day": "8" })).toMatch(/--transition-day/);
    for (const value of ["1", "0", "11", "x", "", "2.5", "-3"]) expect(error({ days: "10", "transition-day": value }), value).toMatch(/--transition-day/);
    expect(ok({ days: "10", "transition-day": "2" }).transitionDay).toBe(2);
    // The as-of day, not --days, is the limit.
    expect(ok({ days: "10", "as-of": "day 14", "transition-day": "14" }).transitionDay).toBe(14);
    expect(error({ days: "10", "as-of": "day 12", "transition-day": "13" })).toMatch(/--transition-day/);
  });

  it("--first-weigh-day is 2 up to the as-of day, and parses without a weekly weights mode (the plan then ignores it)", () => {
    expect(ok({ days: "12", "first-weigh-day": "9", weights: "weekly" }).firstWeighDay).toBe(9);
    expect(ok({ days: "12", "first-weigh-day": "9" })).toMatchObject({ firstWeighDay: 9, weights: "none" });
    for (const value of ["1", "0", "13", "x", ""]) expect(error({ days: "12", "first-weigh-day": value }), value).toMatch(/--first-weigh-day/);
  });

  it("--exp: the five statuses and their forms, the default key, and the sorted order", () => {
    const o = ok({ days: "30", exp: ["done@16:not_tried:slow_down", "skipped@5:eat_intentionally", "offered@28", "done@9:somewhat"] });
    expect(o.experiments.map((e) => [e.status, e.day, e.key, e.result])).toEqual([
      ["SKIPPED", 5, "eat_intentionally", null],
      ["DONE", 9, "eat_intentionally", "somewhat"],
      ["DONE", 16, "slow_down", "not_tried"],
      ["OFFERED", 28, "eat_intentionally", null],
    ]);
    expect(ok({ days: "12", exp: "active@9:slow_down" }).experiments).toEqual([{ status: "ACTIVE", day: 9, key: "slow_down", result: null }]);
    for (const result of ["helpful", "somewhat", "not_really", "unknown", "not_tried"]) expect(ok({ days: "20", exp: `done@9:${result}` }).experiments[0].result).toBe(result);
  });

  it("--exp refuses a malformed value, an unknown status, result or key, and a day outside the run", () => {
    const refused = [
      "active", "active@", "@9", "paused@9", "active@x", "ACTIVE@9", "active@9:", "active@9:nope", "active@9:eat_intentionally:extra",
      "done@9", "done@9:great", "done@9:HELPFUL", "done@9:helpful:nope", "done@9:helpful:slow_down:extra", "active@9:helpful",
    ];
    for (const exp of refused) expect(error({ days: "20", exp }), exp).toMatch(/--exp/);
    expect(error({ days: "20", exp: true })).toMatch(/--exp/);
    expect(error({ days: "12", exp: "active@13" })).toMatch(/--exp/);
    expect(error({ days: "12", exp: "active@1" })).toMatch(/--exp/);
    expect(error({ days: "12", exp: "done@7:helpful" })).toMatch(/--exp/); // it would end on day 14, after the clock
    expect(ok({ days: "12", exp: "done@6:helpful" }).experiments).toHaveLength(1); // ends day 13 09:00, the clock is day 13 09:00
  });

  it("--exp: at most one open row and it is the last; a row starts after the one before it ended", () => {
    expect(error({ days: "30", exp: ["active@9", "offered@20"] })).toMatch(/at most one experiment is open/);
    expect(error({ days: "30", exp: ["offered@9", "done@16:helpful"] })).toMatch(/at most one experiment is open/);
    expect(error({ days: "30", exp: ["done@9:helpful", "done@15:helpful"] })).toMatch(/starts after the one before it ended/);
    expect(error({ days: "30", exp: ["skipped@9", "skipped@9"] })).toMatch(/starts after the one before it ended/);
    expect(ok({ days: "30", exp: ["done@9:helpful", "done@16:helpful", "active@23"] }).experiments).toHaveLength(3);
    expect(ok({ days: "30", exp: ["skipped@9", "offered@10"] }).experiments).toHaveLength(2);
  });

  it("only --exp may be given twice", () => {
    for (const [flag, value] of [["days", ["3", "4"]], ["scenario", ["day3", "day4-candidate"]], ["goals", ["lose_weight", "feel_lighter"]], ["fresh", ["true", "true"]]] as const) {
      expect(error({ [flag]: [...value] }), flag).toMatch(new RegExp(`--${flag} may be given only once`));
    }
  });

  it("--pattern-answer takes the three answers and a day of the run", () => {
    for (const answer of ["confirm", "unsure", "reject"]) expect(ok({ days: "12", "pattern-answer": `${answer}@9` }).patternAnswer).toEqual({ answer, day: 9 });
    for (const value of ["confirm", "confirm@", "maybe@9", "CONFIRM@9", "confirm@x", "confirm@1", "confirm@13", "confirm@9@9", ""]) {
      expect(error({ days: "12", "pattern-answer": value }), value).toMatch(/--pattern-answer/);
    }
  });

  it("--weekly-opened is the Sunday that starts a week that has ended by the clock", () => {
    expect(ok({ days: "21", "weekly-opened": "15" }).weeklyOpened).toBe(15); // Sunday 09-27; the row is stamped Sunday day 22 09:00 = the clock
    expect(ok({ days: "21", "weekly-opened": "8" }).weeklyOpened).toBe(8);
    expect(error({ days: "21", "weekly-opened": "9" })).toMatch(/Sunday/); // a Monday
    expect(error({ days: "20", "weekly-opened": "15" })).toMatch(/not be after the clock/); // day 22 09:00 is after day 21 09:00
    expect(ok({ days: "21", "as-of": "day 22", "weekly-opened": "15" }).weeklyOpened).toBe(15);
    expect(error({ days: "21", "weekly-opened": "x" })).toMatch(/--weekly-opened/);
    expect(error({ days: "21", "weekly-opened": "0" })).toMatch(/--weekly-opened/);
    // Another start date moves the Sundays.
    expect(error({ days: "21", start: "2026-09-14", "weekly-opened": "15" })).toMatch(/Sunday/);
    expect(ok({ days: "21", start: "2026-09-14", "weekly-opened": "14" }).weeklyOpened).toBe(14);
  });

  it("--shabbat follows into observes_shabbat, except in the preset that keeps Shabbat with its rows missing", () => {
    expect(ok({ shabbat: "false" })).toMatchObject({ shabbat: false, observesShabbat: false });
    expect(ok({ shabbat: "true" })).toMatchObject({ shabbat: true, observesShabbat: true });
    expect(ok({ scenario: "w2-shabbat-rows-missing" })).toMatchObject({ shabbat: false, observesShabbat: true });
    expect(ok({ scenario: "w2-shabbat-rows-missing", shabbat: "true" })).toMatchObject({ shabbat: true, observesShabbat: true });
    expect(ok({ scenario: "w2-shabbat-rows-missing", shabbat: "false" })).toMatchObject({ shabbat: false, observesShabbat: false });
    expect(error({ "observes-shabbat": "true" })).toMatch(/Unknown flag/);
  });

  it("explicit flags override a weekly preset, and --exp replaces the preset's experiments", () => {
    expect(ok({ scenario: "w3-result-due", exp: "active@10" }).experiments).toEqual([{ status: "ACTIVE", day: 10, key: "eat_intentionally", result: null }]);
    expect(ok({ scenario: "w3-result-due", days: "28" }).experiments).toHaveLength(1);
    expect(ok({ scenario: "w2-learn", "transition-day": "9" }).transitionDay).toBe(9);
    expect(ok({ scenario: "w2-first-weigh-in", "weigh-day": "3" }).weighDay).toBe(3);
    expect(ok({ scenario: "w2-first-weigh-in", "first-weigh-day": "10" }).firstWeighDay).toBe(10);
    expect(ok({ scenario: "w2-learn", lifecycle: "first_week" }).lifecycle).toBe("first_week");
  });

  it("every weekly preset gives a valid run on its own (its experiments pass the same checks as the flag)", () => {
    for (const scenario of SEED_SCENARIOS.filter((s) => /^w[234]-/.test(s))) {
      const o = ok({ scenario });
      expect(o.lifecycle, scenario).toBe("weekly_cycle");
      expect(o.transitionDay, scenario).not.toBeNull();
      for (const e of o.experiments) {
        expect(e.day, scenario).toBeGreaterThanOrEqual(2);
        if (e.status === "DONE") expect(e.day + 7, scenario).toBeLessThanOrEqual(o.days + 1);
      }
    }
  });
});

describe("goals and motivation (the profile's 'Why we started')", () => {
  it("--goals accepts only the onboarding goal keys, and none", () => {
    for (const key of GOAL_FOCUS_KEYS) expect(ok({ goals: key }).goals).toEqual([key]);
    expect(ok({ goals: "none" }).goals).toEqual([]);
    expect(ok({ goals: "lose_weight,lose_weight,feel_lighter" }).goals).toEqual(["lose_weight", "feel_lighter"]);
    expect(error({ goals: "lose_weight,fly" })).toMatch(/--goals/);
    expect(error({ goals: "" })).toMatch(/--goals/);
    expect(error({ goals: true })).toMatch(/--goals/);
  });

  it("not_sure must be alone", () => {
    expect(error({ goals: "not_sure,lose_weight" })).toMatch(/not_sure must be alone/);
    expect(ok({ goals: "not_sure" }).goals).toEqual(["not_sure"]);
  });

  it("--motivation takes free text (kept as typed, trimmed) or none", () => {
    const withMarkup = "<b>5 ק\"ג</b> עד הקיץ";
    expect(ok({ motivation: withMarkup }).motivation).toBe(withMarkup);
    expect(ok({ motivation: "none" }).motivation).toBeNull();
    expect(error({ motivation: "   " })).toMatch(/--motivation/);
    expect(error({ motivation: "x".repeat(1001) })).toMatch(/--motivation/);
    expect(ok({ motivation: "x".repeat(1000) }).motivation).toHaveLength(1000);
    // Counted in code points, like the form: 1000 astral characters are 1000 characters.
    expect(ok({ motivation: "\u{1F600}".repeat(1000) }).motivation).not.toBeNull();
  });

  it("--motivation text never reaches an error message", () => {
    const private_ = "my-very-private-reason-1234";
    const messages = [
      error({ motivation: private_, days: "0" }),
      error({ motivation: private_, nope: "1" }),
      error({ motivation: private_, "late-days": "0" }),
      error({ motivation: private_, reset: true }),
      error({ motivation: private_, email: "x@gmail.com" }),
    ];
    for (const message of messages) expect(message).not.toContain(private_);
  });

  it("--daily-cap is a positive integer", () => {
    expect(ok({ "daily-cap": "9" }).explainDailyCap).toBe(9);
    expect(ok({}).explainDailyCap).toBe(40);
  });
});

describe("what a run does (action)", () => {
  it("--explain alone only explains; with any data flag it seeds first", () => {
    expect(ok({ explain: true }).action).toBe("explain");
    expect(ok({ explain: true, email: "x@eating-coach.test" }).action).toBe("explain");
    for (const data of <Flags[]>[{ scenario: "day3" }, { fresh: true }, { days: "3" }, { "late-days": "1" }, { goals: "none" }, { "as-of": "day 2" }]) {
      expect(ok({ explain: true, ...data }).action, JSON.stringify(data)).toBe("seed");
    }
  });

  it("the clock flags touch only the clock", () => {
    expect(ok({ "clock-only": true, "as-of": "day 3 08:00" })).toMatchObject({ action: "clock", asOf: "day 3 08:00" });
    expect(ok({ "clock-only": true, "clock-shift": "-2h" })).toMatchObject({ action: "clock", clockShift: "-2h" });
    expect(ok({ "clock-only": true, explain: true }).action).toBe("clock");
    expect(error({ "clock-off": true, "clock-shift": "+1h" })).toMatch(/cannot be combined/);
    expect(error({ "clock-only": true, fresh: true })).toMatch(/only the clock/);
  });

  it("--clock-off next to seeding flags is a seeding run that leaves no clock behind", () => {
    expect(ok({ scenario: "day3", "clock-off": true })).toMatchObject({ action: "seed", clockOff: true, clockOnly: false });
    expect(ok({ "clock-off": true, days: "3" })).toMatchObject({ action: "clock", clockOff: true });
  });
});
