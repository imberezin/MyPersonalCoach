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

type Flags = Record<string, string | number | boolean>;
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
