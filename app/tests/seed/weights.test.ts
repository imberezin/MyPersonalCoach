import { describe, expect, it } from "vitest";
import { NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { resolveHome } from "@/domain/home";
import type { OfflinePeriod } from "@/domain/offline";
import { localDayOf, localMinuteOfDay } from "@/domain/time";
import {
  WEIGHT_ENTRY,
  buildWeightTrend,
  decideMilestoneMoment,
  milestoneProgress,
  weeklyDirection,
  weeklyPoints,
  type MilestoneMoment,
  type MilestoneProgress,
  type TrendPoint,
  type WeightTrend,
} from "@/domain/weight";
import { JUNK_WEIGHT_KG, SEED_PRESETS, SEED_SCENARIOS, parseSeedArgs, type SeedOptions, type SeedScenario } from "../../scripts/seed-demo/args";
import { formatExplain, milestoneHiddenReason, momentWindow, type ExplainFacts, type WeightExplain } from "../../scripts/seed-demo/explain";
import { buildSeedPlan, firstWeekEndedAtOf, toProfileUpdate, type SeedPlan } from "../../scripts/seed-demo/plan";
import { seedShabbatSeries, toPlanShabbat } from "../../scripts/seed-demo/shabbat";
import { buildWeightPlan, generatedWeight, plannedWeightId, toWeightRow } from "../../scripts/seed-demo/weights";

type Flags = Record<string, string | number | boolean>;
const parse = (flags: Flags) => parseSeedArgs(JSON.stringify(flags));
function options(flags: Flags): SeedOptions {
  const result = parse(flags);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}
function error(flags: Flags): string {
  const result = parse(flags);
  if (result.ok) throw new Error(`expected an error for ${JSON.stringify(flags)}`);
  return result.error;
}
function planFor(o: SeedOptions): SeedPlan {
  return buildSeedPlan(o, toPlanShabbat(seedShabbatSeries(o)));
}

const WEIGHT_SCENARIOS = SEED_SCENARIOS.filter((s) => s.startsWith("w-"));
const TZ = "Asia/Jerusalem";

describe("the new flags (15.1)", () => {
  it("every flag parses", () => {
    const o = options({
      lifecycle: "weekly_cycle",
      "start-weight": "76.5",
      "goal-weight": "70",
      weights: "daily",
      "weigh-day": "0",
      "weigh-time": "07:30",
      "weight-drift": "-0.2",
      "weight-noise": "0",
      "junk-weights": "on",
      "junk-day": "12",
    });
    expect(o).toMatchObject({
      lifecycle: "weekly_cycle",
      startWeightKg: 76.5,
      goalWeightKg: 70,
      weights: "daily",
      weighDay: 0,
      weighTime: "07:30",
      weightDrift: -0.2,
      weightNoise: 0,
      junkWeights: true,
      junkDay: 12,
      action: "seed",
    });
    expect(options({ "junk-weights": "off" }).junkWeights).toBe(false);
    expect(options({ "goal-weight": "none" }).goalWeightKg).toBeNull();
    expect(options({ "start-weight": 76.5, "goal-weight": 70, "weigh-day": 6 })).toMatchObject({ startWeightKg: 76.5, goalWeightKg: 70, weighDay: 6 });
  });

  it("a series sets the weekly mode, from text or from one number", () => {
    expect(options({ "weight-series": "79.6, 78.9,78" })).toMatchObject({ weights: "weekly", weightSeries: [79.6, 78.9, 78] });
    expect(options({ "weight-series": 79.5 })).toMatchObject({ weights: "weekly", weightSeries: [79.5] });
    expect(options({ weights: "weekly" })).toMatchObject({ weights: "weekly", weightSeries: null });
    expect(options({ weights: "weekly", "weight-series": "80" }).weights).toBe("weekly");
  });

  it("--weights takes exactly three words", () => {
    for (const weights of ["none", "weekly", "daily"]) expect(options({ weights }).weights).toBe(weights);
    for (const weights of ["monthly", "", "Daily", "on"]) expect(error({ weights }), weights).toMatch(/--weights/);
  });

  it("--weight-series refuses anything that is not what the weight screen accepts", () => {
    for (const series of ["79.6,abc", "", "80,,79", "29.9", "350.1", "79.55", "-80", "8e1", "80;79"]) {
      expect(error({ "weight-series": series }), series).toMatch(/--weight-series/);
    }
    expect(options({ "weight-series": `${WEIGHT_ENTRY.minKg},${WEIGHT_ENTRY.maxKg}` }).weightSeries).toEqual([WEIGHT_ENTRY.minKg, WEIGHT_ENTRY.maxKg]);
    expect(error({ "weight-series": Array.from({ length: 121 }, () => "80").join(",") })).toMatch(/at most 120/);
    expect(error({ "weight-series": "80", weights: "daily" })).toMatch(/weekly/);
    expect(error({ "weight-series": "80", weights: "none" })).toMatch(/weekly/);
  });

  it("--weigh-day is 0 to 6 and --weigh-time is HH:mm", () => {
    for (const day of ["0", "3", "6"]) expect(options({ "weigh-day": day }).weighDay).toBe(Number(day));
    for (const day of ["7", "-1", "x", "1.5", ""]) expect(error({ "weigh-day": day }), day).toMatch(/--weigh-day/);
    for (const time of ["8:00", "24:00", "08:60", "noon", ""]) expect(error({ "weigh-time": time }), time).toMatch(/--weigh-time/);
  });

  it("--start-weight and --goal-weight are kilograms with one decimal inside the profile column's range", () => {
    expect(options({ "start-weight": "20" }).startWeightKg).toBe(20);
    expect(options({ "goal-weight": "500" }).goalWeightKg).toBe(500);
    for (const value of ["19.9", "19", "500.1", "abc", "70.55", "", "-70"]) {
      expect(error({ "goal-weight": value }), `goal ${value}`).toMatch(/--goal-weight/);
      expect(error({ "start-weight": value }), `start ${value}`).toMatch(/--start-weight/);
    }
  });

  it("--lifecycle takes the two words", () => {
    expect(options({ lifecycle: "first_week" }).lifecycle).toBe("first_week");
    for (const lifecycle of ["weekly", "WEEKLY_CYCLE", "", "NEW"]) expect(error({ lifecycle }), lifecycle).toMatch(/--lifecycle/);
  });

  it("--weight-drift, --weight-noise, --junk-weights and --junk-day are bounded", () => {
    expect(options({ "weight-drift": "0.05" }).weightDrift).toBe(0.05);
    expect(error({ "weight-drift": "3" })).toMatch(/--weight-drift/);
    expect(error({ "weight-drift": "x" })).toMatch(/--weight-drift/);
    expect(error({ "weight-noise": "-1" })).toMatch(/--weight-noise/);
    expect(error({ "weight-noise": "6" })).toMatch(/--weight-noise/);
    expect(error({ "junk-weights": "maybe" })).toMatch(/--junk-weights/);
    expect(error({ "junk-day": "1" })).toMatch(/--junk-day/);
    expect(error({ "junk-day": "61" })).toMatch(/--junk-day/);
  });

  it("a value never reaches an error message", () => {
    for (const flag of ["weight-series", "goal-weight", "start-weight", "weights", "lifecycle", "weigh-time"]) {
      expect(error({ [flag]: "private-xyz-123" }), flag).not.toContain("private-xyz-123");
    }
  });

  it("--drop-weights is its own run, next to --drop-meals at most", () => {
    expect(options({ "drop-weights": "3" })).toMatchObject({ dropWeights: 3, dropMeals: null, action: "drop" });
    expect(options({ "drop-weights": "all", explain: true })).toMatchObject({ dropWeights: "all", action: "drop", explain: true });
    expect(options({ "drop-weights": "2", "drop-meals": "1" })).toMatchObject({ dropWeights: 2, dropMeals: 1, action: "drop" });
    expect(error({ "drop-weights": "0" })).toMatch(/--drop-weights/);
    expect(error({ "drop-weights": "some" })).toMatch(/--drop-weights/);
    expect(error({ "drop-weights": "1", scenario: "w-down" })).toMatch(/accepts only/);
    expect(error({ "drop-weights": "1", fresh: true })).toMatch(/accepts only/);
    expect(error({ "drop-meals": "1", weights: "daily" })).toMatch(/accepts only/);
    expect(error({ "drop-weights": "1", "clock-only": true })).toMatch(/accepts only/);
  });

  it("--reset takes none of them, and --explain with a weight flag seeds first", () => {
    for (const other of <Flags[]>[{ weights: "daily" }, { "start-weight": "70" }, { lifecycle: "weekly_cycle" }]) {
      expect(error({ reset: true, ...other }), JSON.stringify(other)).toMatch(/--reset accepts only --email/);
    }
    expect(options({ explain: true, "weight-series": "80" }).action).toBe("seed");
    expect(options({ explain: true, lifecycle: "weekly_cycle" }).action).toBe("seed");
  });
});

describe("the ten presets fill their defaults and explicit flags win", () => {
  it("there are exactly ten, each with a preset entry", () => {
    expect(WEIGHT_SCENARIOS).toHaveLength(10);
    for (const scenario of WEIGHT_SCENARIOS) expect(SEED_PRESETS[scenario as SeedScenario], scenario).toBeDefined();
  });

  it.each(WEIGHT_SCENARIOS)("%s: weight only, the First Week is over, the clock is 3 mod 7 days in", (scenario) => {
    const o = options({ scenario });
    expect(o).toMatchObject({ lifecycle: "weekly_cycle", mealsPerDay: 0, lateDays: [], gapDays: [], action: "seed" });
    expect(o.days % 7, "a Wednesday 09:00 clock").toBe(3);
  });

  it("explicit flags override a preset", () => {
    expect(options({ scenario: "w-down", weights: "none" }).weights).toBe("none");
    expect(options({ scenario: "w-down", "goal-weight": "70" }).goalWeightKg).toBe(70);
    expect(options({ scenario: "w-down", "goal-weight": "none" }).goalWeightKg).toBeNull();
    expect(options({ scenario: "w-down", lifecycle: "first_week" }).lifecycle).toBe("first_week");
    expect(options({ scenario: "w-down", "weight-series": "70,69" }).weightSeries).toEqual([70, 69]);
    expect(options({ scenario: "w-down", days: "52" }).days).toBe(52);
    expect(options({ scenario: "w-down", "junk-weights": "on" }).junkWeights).toBe(true);
    expect(options({ scenario: "w-junk", "junk-weights": "off" }).junkWeights).toBe(false);
    expect(options({ scenario: "w-daily", weights: "weekly" })).toMatchObject({ weights: "weekly", weightSeries: null });
    expect(options({ scenario: "w-rising", "start-weight": "80" }).startWeightKg).toBe(80);
  });
});

describe("buildWeightPlan", () => {
  it("is deterministic for a seed, with stable ids; another seed or another e-mail changes the ids", () => {
    const o = options({ scenario: "w-daily" });
    expect(planFor(o).weights).toEqual(planFor(o).weights);
    const ids = planFor(o).weights.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    expect(planFor(options({ scenario: "w-daily", seed: "2" })).weights.map((w) => w.id)).not.toEqual(ids);
    const other = planFor(options({ scenario: "w-daily", email: "second@eating-coach.test" })).weights.map((w) => w.id);
    expect(other.some((id) => ids.includes(id))).toBe(false);
    // The ids are a function of (e-mail, seed, slot, index) alone.
    expect(plannedWeightId({ email: o.email, seed: 1 }, "w", 3)).toBe(plannedWeightId({ email: o.email, seed: 1 }, "w", 3));
    expect(plannedWeightId({ email: o.email, seed: 1 }, "w", 3)).not.toBe(plannedWeightId({ email: o.email, seed: 1 }, "d", 3));
  });

  it("a different seed changes the daily values, not the days", () => {
    const a = planFor(options({ scenario: "w-daily", seed: "1" })).weights;
    const b = planFor(options({ scenario: "w-daily", seed: "2" })).weights;
    expect(b.map((w) => w.day)).toEqual(a.map((w) => w.day));
    expect(b.map((w) => w.weightKg)).not.toEqual(a.map((w) => w.weightKg));
  });

  it("is additive: a longer run keeps the ids and values of the days they share", () => {
    const short = planFor(options({ scenario: "w-daily", days: "17" })).weights;
    const long = planFor(options({ scenario: "w-daily", days: "31" })).weights;
    const byId = new Map(long.map((w) => [w.id, w.weightKg]));
    expect(short.length).toBeGreaterThan(5);
    for (const w of short) expect(byId.get(w.id), `day ${w.day}`).toBe(w.weightKg);
  });

  it("daily: day 2 to --days at 08:00 local, no Saturday (Shabbat), 26 entries for w-daily", () => {
    const o = options({ scenario: "w-daily" });
    const plan = planFor(o);
    expect(plan.weights).toHaveLength(26);
    expect(plan.weights.map((w) => w.day)).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 29, 30, 31]);
    for (const w of plan.weights) {
      expect(localMinuteOfDay(w.measuredAt, TZ), `day ${w.day}`).toBe(8 * 60);
      expect(w.kind).toBe("daily");
      // Day 1 is a Sunday: a Saturday is a day whose number is a multiple of 7.
      expect(w.day % 7).not.toBe(0);
    }
    expect(localDayOf(plan.weights[0].measuredAt, TZ).key).toBe("2026-09-14");
  });

  it("--shabbat false keeps the Saturdays", () => {
    expect(planFor(options({ scenario: "w-daily", shabbat: "false" })).weights).toHaveLength(30);
  });

  it("nothing is later than the clock", () => {
    const o = options({ scenario: "w-daily", "as-of": "day 10" });
    const plan = planFor(o);
    expect(plan.asOf.toISOString()).toBe("2026-09-23T06:00:00.000Z"); // Wed 09:00 (UTC+3)
    expect(plan.weights.every((w) => w.measuredAt.getTime() <= plan.asOf.getTime())).toBe(true);
    // Days 2 to 11 without Saturday 7; day 11's 08:00 is before the 09:00 clock.
    expect(plan.weights.map((w) => w.day)).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11]);
    const early = planFor(options({ scenario: "w-daily", "as-of": "day 10 07:59" }));
    expect(early.weights.map((w) => w.day)).toEqual([2, 3, 4, 5, 6, 8, 9, 10]);
  });

  it("the 08:00 holds on both sides of the daylight-saving change (2026-10-25)", () => {
    const o = options({ weights: "daily", days: "14", start: "2026-10-18", shabbat: "false", "meals-per-day": "0", "late-days": "none", "gap-days": "none" });
    const plan = planFor(o);
    expect(plan.weights).toHaveLength(13);
    for (const w of plan.weights) expect(localMinuteOfDay(w.measuredAt, TZ), `day ${w.day}`).toBe(480);
    const keys = plan.weights.map((w) => localDayOf(w.measuredAt, TZ).key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("2026-10-25");
    expect(keys).toContain("2026-10-26");
  });

  it("weekly: one value per weigh-in, on Fridays by default, starting on the first weigh-day on or after day 2", () => {
    const plan = planFor(options({ scenario: "w-down" }));
    expect(plan.weights.map((w) => w.weightKg)).toEqual([79.6, 78.9, 78.1, 77.4, 76.9, 76.2]);
    expect(plan.weights.map((w) => w.day)).toEqual([6, 13, 20, 27, 34, 41]);
    expect(plan.weights.map((w) => localDayOf(w.measuredAt, TZ).key)).toEqual(["2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"]);
    for (const w of plan.weights) expect(localMinuteOfDay(w.measuredAt, TZ)).toBe(480);

    // Day 1 is itself a Sunday, but weigh-ins start on day 2: the first Sunday weigh-in is day 8.
    const sunday = planFor(options({ days: "20", weights: "weekly", "weigh-day": "0", "weight-series": "80,79,78", "meals-per-day": "0", "late-days": "none", "gap-days": "none" }));
    expect(sunday.weights.map((w) => w.day)).toEqual([8, 15]);
    expect(sunday.weights.map((w) => w.weightKg)).toEqual([80, 79]);
  });

  it("--weigh-time moves the weekly weigh-ins", () => {
    const plan = planFor(options({ scenario: "w-one", "weigh-time": "07:30" }));
    expect(localMinuteOfDay(plan.weights[0].measuredAt, TZ)).toBe(7 * 60 + 30);
  });

  it("the series is the whole list: values past the span are not yet, and a short list is not padded", () => {
    expect(planFor(options({ scenario: "w-one", "weight-series": "79.5,78.9" })).weights.map((w) => w.weightKg)).toEqual([79.5]);
    expect(planFor(options({ scenario: "w-down", "weight-series": "70,69" })).weights.map((w) => w.weightKg)).toEqual([70, 69]);
  });

  it("without a series the weekly values are generated from the start weight, the drift and the noise", () => {
    const o = options({ scenario: "w-down", "weight-series": "70" });
    const generated = planFor({ ...o, weightSeries: null });
    expect(generated.weights).toHaveLength(6);
    for (const w of generated.weights) {
      expect(w.weightKg).toBe(generatedWeight(o, w.day));
      expect(Math.abs(w.weightKg - (80 - 0.1 * (w.day - 1)))).toBeLessThanOrEqual(0.6 + 0.05);
    }
    expect(generatedWeight({ ...o, weightNoise: 0 }, 11)).toBe(79);
  });

  it("generated values are one decimal and inside what the weight screen accepts", () => {
    const o = options({ scenario: "w-daily", "start-weight": "31", "weight-drift": "-2", "weight-noise": "5", days: "40" });
    for (const w of planFor(o).weights) {
      expect(w.weightKg).toBeGreaterThanOrEqual(WEIGHT_ENTRY.minKg);
      expect(w.weightKg).toBeLessThanOrEqual(WEIGHT_ENTRY.maxKg);
      expect(Math.round(w.weightKg * 10) / 10).toBe(w.weightKg);
    }
  });

  it("a weigh-in inside a Shabbat period is dropped (a Saturday weigh-day), and kept with --shabbat false", () => {
    const base = { days: "20", weights: "weekly", "weigh-day": "6", "meals-per-day": "0", "late-days": "none", "gap-days": "none" } as const;
    expect(planFor(options(base)).weights).toEqual([]);
    expect(planFor(options({ ...base, shabbat: "false" })).weights.map((w) => w.day)).toEqual([7, 14]);
  });

  it("nothing is planned without a weights mode, a series or a junk entry", () => {
    expect(planFor(options({})).weights).toEqual([]);
    expect(planFor(options({ scenario: "w-none" })).weights).toEqual([]);
    expect(planFor(options({ scenario: "day5-early-finish" })).weights).toEqual([]);
  });

  describe("the junk entry", () => {
    it("is 181 kg at 08:00 on the junk day, dated inside the span", () => {
      const plan = planFor(options({ scenario: "w-junk" }));
      const junk = plan.weights.filter((w) => w.kind === "junk");
      expect(junk).toHaveLength(1);
      expect(junk[0]).toMatchObject({ day: 30, weightKg: JUNK_WEIGHT_KG });
      expect(localDayOf(junk[0].measuredAt, TZ).key).toBe("2026-10-12");
      expect(localMinuteOfDay(junk[0].measuredAt, TZ)).toBe(480);
      expect(junk[0].measuredAt.getTime()).toBeGreaterThan(plan.startedAt.getTime());
      expect(junk[0].measuredAt.getTime()).toBeLessThan(plan.asOf.getTime());
      expect(plan.weights).toHaveLength(7);
    });

    it("--junk-day moves it, and a day outside the span or after the clock drops it", () => {
      expect(planFor(options({ scenario: "w-junk", "junk-day": "12" })).weights.find((w) => w.kind === "junk")?.day).toBe(12);
      expect(planFor(options({ scenario: "w-junk", "junk-day": "50" })).weights.some((w) => w.kind === "junk")).toBe(false);
      expect(planFor(options({ scenario: "w-junk", days: "20" })).weights.some((w) => w.kind === "junk")).toBe(false);
      expect(planFor(options({ scenario: "w-junk", "as-of": "day 20" })).weights.some((w) => w.kind === "junk")).toBe(false);
      // The clock is later than the junk day, but the span (--days) ends before it: still not dated outside the span.
      expect(planFor(options({ scenario: "w-junk", days: "20", "as-of": "day 40" })).weights.some((w) => w.kind === "junk")).toBe(false);
    });

    it("works without any other weight, and not on a Saturday", () => {
      expect(planFor(options({ scenario: "w-none", "junk-weights": "on", days: "40" })).weights.map((w) => w.kind)).toEqual(["junk"]);
      expect(planFor(options({ scenario: "w-none", "junk-weights": "on", "junk-day": "14" })).weights).toEqual([]);
    });
  });

  it("the rows carry the id, the weight, the instant and the source, and no user id and no note", () => {
    const plan = planFor(options({ scenario: "w-one" }));
    expect(plan.weights.map(toWeightRow)).toEqual([{ id: plan.weights[0].id, weight_kg: 79.5, measured_at: plan.weights[0].measuredAt.toISOString(), source: "manual" }]);
  });

  it("the plan alone (called directly) uses only its inputs", () => {
    const o = options({ scenario: "w-one" });
    const startedAt = new Date("2026-09-13T09:00:00Z");
    const asOf = new Date("2026-09-23T06:00:00Z");
    expect(buildWeightPlan(o, { startedAt, asOf, offline: [] })).toHaveLength(1);
    expect(buildWeightPlan(o, { startedAt, asOf: new Date("2026-09-18T04:59:00Z"), offline: [] })).toHaveLength(0); // before Friday 08:00 local
    const friday = new Date("2026-09-18T05:00:00Z");
    expect(buildWeightPlan(o, { startedAt, asOf, offline: [{ start: new Date(friday.getTime() - 1000), end: new Date(friday.getTime() + 1000) }] })).toHaveLength(0);
  });
});

describe("the profile a weight run writes", () => {
  const update = (flags: Flags) => {
    const o = options(flags);
    return { o, update: toProfileUpdate(o, planFor(o).startedAt), startedAt: planFor(o).startedAt, asOf: planFor(o).asOf };
  };

  it("the defaults are the First Week with 80 -> 72, exactly as before", () => {
    const { update: u } = update({ scenario: "day3" });
    expect(u).toMatchObject({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null, goal_type: "numeric", start_weight_kg: 80, goal_weight_kg: 72 });
  });

  it("weekly_cycle: the First Week ended at the earlier of day 15 noon and an hour before the clock", () => {
    const long = update({ scenario: "w-down" }); // the clock is day 46: day 15 noon wins
    expect(long.update.lifecycle_state).toBe("WEEKLY_CYCLE");
    expect(long.update.first_week_ended_at).toBe("2026-09-27T09:00:00.000Z"); // Sun 12:00 local
    const short = update({ scenario: "w-one" }); // the clock is day 11 09:00: an hour before wins
    expect(short.update.first_week_ended_at).toBe(new Date(short.asOf.getTime() - 3_600_000).toISOString());
    expect(new Date(short.update.first_week_ended_at as string).getTime()).toBeGreaterThanOrEqual(short.startedAt.getTime());
  });

  it("is never before the First Week began, and is null in the First Week", () => {
    const early = update({ lifecycle: "weekly_cycle", "as-of": "day 0 05:00", days: "3" });
    expect(early.update.first_week_ended_at).toBe(early.startedAt.toISOString());
    expect(firstWeekEndedAtOf(options({ scenario: "day3" }), new Date())).toBeNull();
  });

  it("--start-weight and --goal-weight are stored; none stores goal_type none with no goal weight", () => {
    expect(update({ scenario: "w-rising" }).update).toMatchObject({ start_weight_kg: 76, goal_weight_kg: 72, goal_type: "numeric" });
    expect(update({ scenario: "w-nogoal" }).update).toMatchObject({ goal_type: "none", goal_weight_kg: null, start_weight_kg: 80 });
  });
});

// The expected values of 15.3, one row per preset. The blueprint's table is the spec; the plan must reproduce it through
// the domain functions the app itself uses.
interface Want {
  asOfDay: string;
  points: number;
  complete: number;
  state: WeightTrend["state"];
  direction: WeightTrend["direction"];
  plateau?: boolean;
  since: [string, number] | null | undefined;
  /** "kg:state" per landmark; "-" = no landmark section. */
  steps: string;
  moment: MilestoneMoment | null;
  window?: [string, string];
}
const WANT: Record<string, Want> = {
  "w-none": { asOfDay: "2026-10-07", points: 0, complete: 0, state: "START_ONLY", direction: null, since: null, steps: "80:R 75:N 72:A", moment: null },
  "w-one": { asOfDay: "2026-09-23", points: 1, complete: 1, state: "NOT_ENOUGH", direction: null, since: null, steps: "80:R 75:N 72:A", moment: null },
  "w-down": { asOfDay: "2026-10-28", points: 6, complete: 6, state: "LINE", direction: "DOWN", since: ["LOWER", 3.8], steps: "80:R 75:N 72:A", moment: null },
  "w-milestone": {
    asOfDay: "2026-10-28",
    points: 6,
    complete: 6,
    state: "LINE",
    direction: "DOWN",
    since: ["LOWER", 5.4],
    steps: "80:R 75:R 72:N",
    moment: { week: "2026-10-18", isGoal: false },
    window: ["2026-10-25", "2026-11-08"],
  },
  "w-goal": {
    asOfDay: "2026-11-04",
    points: 7,
    complete: 7,
    state: "LINE",
    direction: "DOWN",
    since: ["LOWER", 8.4],
    steps: "80:R 75:R 72:R",
    moment: { week: "2026-10-25", isGoal: true },
    window: ["2026-11-01", "2026-11-15"],
  },
  "w-steady": { asOfDay: "2026-10-21", points: 5, complete: 5, state: "LINE", direction: "STEADY", plateau: true, since: ["LOWER", 1.9], steps: "80:R 75:N 72:A", moment: null },
  "w-rising": { asOfDay: "2026-10-14", points: 4, complete: 4, state: "LINE", direction: "UP", since: ["HIGHER", 2.2], steps: "76:R 72:N", moment: null },
  // (15.3 leaves the since-the-start of the noisy preset open: it is LOWER whatever the noise; the kilograms are checked below.)
  "w-daily": { asOfDay: "2026-10-14", points: 5, complete: 4, state: "LINE", direction: "DOWN", since: undefined, steps: "80:R 75:N 72:A", moment: null },
  "w-junk": { asOfDay: "2026-10-28", points: 6, complete: 6, state: "LINE", direction: "UP", since: ["LOWER", 3.8], steps: "80:R 75:N 72:A", moment: null },
  "w-nogoal": { asOfDay: "2026-10-28", points: 6, complete: 6, state: "LINE", direction: "DOWN", since: ["LOWER", 3.8], steps: "-", moment: null },
};

/** What the app's domain functions say about a plan at its clock (the loaders' reads, reproduced on the plan). */
function evaluate(o: SeedOptions) {
  const plan = planFor(o);
  const entries = plan.weights.map((w) => ({ id: w.id, weightKg: w.weightKg, measuredAt: w.measuredAt }));
  const points = weeklyPoints(entries, o.timeZone, plan.asOf);
  const trend = buildWeightTrend({ points, baselineKg: o.startWeightKg, timeZone: o.timeZone, now: plan.asOf });
  const progress = milestoneProgress({
    startKg: o.startWeightKg,
    goalKg: o.goalWeightKg,
    goalType: o.goalWeightKg === null ? "none" : "numeric",
    weeklyPoints: points,
    complete: true,
  });
  const moment = decideMilestoneMoment({ progress, now: plan.asOf, timeZone: o.timeZone, acknowledged: new Set() });
  const periods: OfflinePeriod[] = plan.offline.map((p) => ({ type: p.type, start: p.start, end: p.end }));
  const home = resolveHome({
    now: plan.asOf,
    timeZone: o.timeZone,
    offlinePeriods: periods,
    hasAnyReport: plan.weights.length > 0,
    lifecycle: "WEEKLY_CYCLE",
    firstWeek: null,
    firstWeekSnoozed: { ...NOT_SNOOZED },
    earlySignal: null,
    quietHours: null,
    milestone: moment,
    weekly: null,
    activeExperiment: null,
  });
  return { plan, entries, points, trend, progress, moment, home };
}

const stepsText = (p: MilestoneProgress) => (p.kind === "LIST" ? p.steps.map((s) => `${s.kg}:${s.state[0]}`).join(" ") : "-");

describe("every preset through the domain functions, at its clock (15.3)", () => {
  it("covers every weight scenario", () => {
    expect(Object.keys(WANT).sort()).toEqual([...WEIGHT_SCENARIOS].sort());
  });

  it.each(WEIGHT_SCENARIOS)("%s", (scenario) => {
    const o = options({ scenario });
    const want = WANT[scenario];
    const r = evaluate(o);

    // The clock is a Wednesday 09:00 in the profile's zone, on the documented day.
    expect(localDayOf(r.plan.asOf, TZ).key, "as-of day").toBe(want.asOfDay);
    expect(localMinuteOfDay(r.plan.asOf, TZ), "09:00").toBe(540);
    expect(new Date(`${want.asOfDay}T00:00:00Z`).getUTCDay(), "Wednesday").toBe(3);

    expect(r.points, "weekly points").toHaveLength(want.points);
    expect(r.points.filter((p) => p.complete), "complete points").toHaveLength(want.complete);
    expect(r.trend.state, "state").toBe(want.state);
    expect(r.trend.direction, "direction").toBe(want.direction);
    expect(weeklyDirection(r.points)).toBe(want.direction);
    expect(r.trend.plateau, "plateau").toBe(want.plateau ?? false);
    expect(r.trend.stale, "stale").toBe(false);
    if (want.since !== undefined) expect(r.trend.sinceStart === null ? null : [r.trend.sinceStart.kind, r.trend.sinceStart.kg]).toEqual(want.since);
    else expect(r.trend.sinceStart?.kind).toBe("LOWER");
    expect(stepsText(r.progress), "landmarks").toBe(want.steps);
    expect(r.moment, "Home moment").toEqual(want.moment);

    // The card is the state the resolver gives, and no preset hides a Shabbat state behind it.
    if (want.moment === null) expect(r.home.state.key, "Home").not.toBe("MILESTONE_REACHED");
    else {
      expect(r.home.state).toEqual({ key: "MILESTONE_REACHED", ...want.moment });
      expect(r.home.action).toEqual({ kind: "OPEN_PROGRESS", week: want.moment.week });
    }

    if (want.window) {
      const window = momentWindow(want.moment!.week, o.timeZone)!;
      expect([localDayOf(window.start, TZ).key, localDayOf(window.end, TZ).key]).toEqual(want.window);
      expect(localMinuteOfDay(window.start, TZ)).toBe(0);
      expect(r.plan.asOf.getTime()).toBeGreaterThanOrEqual(window.start.getTime());
      expect(r.plan.asOf.getTime()).toBeLessThan(window.end.getTime());
    }
  });

  it("the expected averages and differences of 15.3", () => {
    const avg = (scenario: string) => evaluate(options({ scenario })).points.map((p) => [p.weekStart, p.averageKg]);
    expect(avg("w-down")).toEqual([
      ["2026-09-13", 79.6],
      ["2026-09-20", 78.9],
      ["2026-09-27", 78.1],
      ["2026-10-04", 77.4],
      ["2026-10-11", 76.9],
      ["2026-10-18", 76.2],
    ]);
    // 181.0 and 76.9 average to 128.95, which rounds half up to 129.0.
    expect(avg("w-junk")[4]).toEqual(["2026-10-11", 129]);
    expect(evaluate(options({ scenario: "w-junk" })).trend.latestComplete?.averageKg).toBe(76.2);
    // The daily preset: the unfinished week of 10-11 is a partial point made of days 29 to 31, drawn and deciding nothing.
    const daily = evaluate(options({ scenario: "w-daily" })).points;
    expect(daily.map((p) => p.weekStart)).toEqual(["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11"]);
    expect(daily[4]).toMatchObject({ complete: false, entries: 3 });
    expect(daily.slice(0, 4).map((p) => p.entries)).toEqual([5, 6, 6, 6]);
  });

  it("w-milestone: 75 is reached by the weeks 10-11 and 10-18 (74.9 alone in 10-11 did not count), confirmed 10-18", () => {
    const { progress } = evaluate(options({ scenario: "w-milestone" }));
    if (progress.kind !== "LIST") throw new Error("expected a list");
    expect(progress.steps[1]).toMatchObject({ kg: 75, state: "REACHED", reachedWeekStart: "2026-10-11", confirmedWeekStart: "2026-10-18" });
    expect(progress.goalReached).toBe(false);
  });

  it("w-goal: 75 by the weeks 09-27 and 10-04, the goal by 10-18 and 10-25 (72.6 on 10-11 is above it)", () => {
    const { progress } = evaluate(options({ scenario: "w-goal" }));
    if (progress.kind !== "LIST") throw new Error("expected a list");
    expect(progress.steps[1]).toMatchObject({ kg: 75, reachedWeekStart: "2026-09-27", confirmedWeekStart: "2026-10-04" });
    expect(progress.steps[2]).toMatchObject({ kg: 72, reachedWeekStart: "2026-10-18", confirmedWeekStart: "2026-10-25" });
    expect(progress.goalReached).toBe(true);
  });

  it("the direction values in tenths: d = -24, -57, -31, -1, +24, +497", () => {
    // d = (newest two) - (the two before), in tenths of a kilogram; the band is 10.
    const d = (points: readonly TrendPoint[]) => {
      const t = points.filter((p) => p.complete).slice(-4).map((p) => Math.round(p.averageKg * 10));
      return t[3] + t[2] - (t[1] + t[0]);
    };
    const of = (scenario: string) => d(evaluate(options({ scenario })).points);
    expect(of("w-down")).toBe(-24);
    expect(of("w-milestone")).toBe(-57);
    expect(of("w-goal")).toBe(-31);
    expect(of("w-steady")).toBe(-1);
    expect(of("w-rising")).toBe(24);
    expect(of("w-junk")).toBe(497);
  });

  it("each weight preset adds no meal at all", () => {
    for (const scenario of WEIGHT_SCENARIOS) {
      const plan = planFor(options({ scenario }));
      expect(plan.meals, scenario).toEqual([]);
    }
  });
});

describe("the --explain lines for the weights", () => {
  const BASE_FACTS = (scenario: string, over: Partial<WeightExplain> = {}, now?: Date): ExplainFacts => {
    const o = options({ scenario });
    const r = evaluate(o);
    const weight: WeightExplain = {
      entries: r.entries.length,
      afterClock: 0,
      truncated: false,
      points: r.trend.points,
      trend: r.trend,
      progress: r.progress,
      moment: r.moment,
      acknowledgedWeeks: [],
      quiet: false,
      reference: { kind: "previous", kg: 76.2 },
      ...over,
    };
    return {
      email: "demo@eating-coach.test",
      now: now ?? r.plan.asOf,
      clockFile: null,
      timeZone: TZ,
      lifecycle: "WEEKLY_CYCLE",
      progress: null,
      step: null,
      signal: null,
      excluded: [],
      storedEvidence: null,
      earlySignal: null,
      quietHours: null,
      home: r.home,
      selection: null,
      dailyCap: 40,
      weight,
      weekly: null,
    };
  };
  const text = (facts: ExplainFacts) => formatExplain(facts).join("\n");

  it("a falling series: the count, the weekly points, the trend, the landmarks, no card and its reason", () => {
    const out = text(BASE_FACTS("w-down"));
    expect(out).toContain("weights: 6 entries, 0 dated after the clock and ignored");
    expect(out).toContain("weekly points: 2026-09-13=79.6 complete, 2026-09-20=78.9 complete");
    expect(out).toContain("2026-10-18=76.2 complete");
    expect(out).toContain("weight trend: LINE, direction DOWN, stale no, plateau no, since the start LOWER 3.8 kg");
    expect(out).toContain("landmarks: 80 reached (the start); 75 next; 72 ahead");
    expect(out).toContain("Home milestone: none");
    expect(out).toContain("milestone card hidden because: no landmark is reached yet");
    expect(out).toContain("/report/weight now: open");
    expect(out).toContain("double-check reference: 76.2 kg (the previous weigh-in)");
  });

  it("a landmark: the card, the confirming week, the window and who thanked", () => {
    const out = text(BASE_FACTS("w-milestone"));
    expect(out).toContain("75 reached (first week 2026-10-11, confirmed 2026-10-18)");
    expect(out).toContain("Home milestone: landmark (confirming week 2026-10-18)");
    expect(out).toContain("milestone window for the week 2026-10-18: 2026-10-25T00:00:00+03:00 to 2026-11-08T00:00:00+02:00; acknowledged no");
    expect(out).not.toContain("milestone card hidden");
    expect(text(BASE_FACTS("w-goal"))).toContain("Home milestone: goal (confirming week 2026-10-25)");
    expect(text(BASE_FACTS("w-goal"))).toContain("; the goal is reached");
  });

  it("names why a landmark is hidden: acknowledged, before and after the window", () => {
    const acknowledged = BASE_FACTS("w-milestone", { moment: null, acknowledgedWeeks: ["2026-10-18"] });
    expect(text(acknowledged)).toContain("acknowledged yes");
    expect(text(acknowledged)).toContain("milestone card hidden because: acknowledged");

    const at = (iso: string) => BASE_FACTS("w-milestone", { moment: null }, new Date(iso));
    expect(text(at("2026-10-24T20:59:00Z"))).toContain("outside the window: it opens 2026-10-25T00:00:00+03:00"); // 23:59 local, the day before
    expect(text(at("2026-11-07T22:00:00Z"))).toContain("outside the window: it closed 2026-11-08T00:00:00+02:00"); // 00:00 local
    expect(milestoneHiddenReason(BASE_FACTS("w-milestone", { moment: null, acknowledgedWeeks: null }).weight!, TZ, new Date("2026-10-28T07:00:00Z"))).toMatch(/could not be read/);
  });

  it("names the other reasons: no goal, a truncated history, and an unreadable series", () => {
    expect(text(BASE_FACTS("w-nogoal"))).toContain("landmarks: none (no numeric goal below the start weight)");
    expect(text(BASE_FACTS("w-nogoal"))).toContain("milestone card hidden because: there is no numeric goal below the start weight");
    const truncated = text(BASE_FACTS("w-down", { truncated: true, progress: { kind: "UNKNOWN" } }));
    expect(truncated).toContain("landmarks: unknown (the history is truncated)");
    expect(truncated).toContain("truncated, so no landmark is claimed");
    expect(text({ ...BASE_FACTS("w-down"), weight: null })).toContain("weights: unknown (the series could not be read)");
  });

  it("no trend yet, entries dated after the clock, a quiet moment and the reference fallbacks", () => {
    const none = text(BASE_FACTS("w-none", { afterClock: 2 }));
    expect(none).toContain("weights: 0 entries, 2 dated after the clock and ignored");
    expect(none).toContain("weekly points: none");
    expect(none).toContain("weight trend: START_ONLY, direction none");
    expect(text(BASE_FACTS("w-down", { quiet: true }))).toContain("/report/weight now: quiet (an offline period)");
    expect(text(BASE_FACTS("w-down", { quiet: null }))).toContain("/report/weight now: unknown");
    expect(text(BASE_FACTS("w-down", { reference: { kind: "start", kg: 80 } }))).toContain("double-check reference: 80.0 kg (the start weight; no earlier weigh-in)");
    expect(text(BASE_FACTS("w-down", { reference: { kind: "none" } }))).toContain("double-check reference: none (it will not ask)");
    expect(text(BASE_FACTS("w-down", { reference: { kind: "unknown" } }))).toContain("double-check reference: unknown (it will not ask)");
  });

  it("a rising series is described with the same words as a falling one", () => {
    const up = text(BASE_FACTS("w-rising"));
    expect(up).toContain("direction UP");
    expect(up).toContain("since the start HIGHER 2.2 kg");
    // (The rest of the output has its own words, such as "a read failed" in the First Week line.)
    const weightLines = up
      .split("\n")
      .filter((line) => /^(weights|weekly points|weight trend|landmarks|Home milestone|milestone|\/report\/weight|double-check)/.test(line))
      .join("\n");
    expect(weightLines).not.toMatch(/error|warning|bad|worse|fail|wrong|careful/i);
  });

  it("never prints an e-mail other than the demo one, an id or a key", () => {
    const out = text(BASE_FACTS("w-junk"));
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(out).not.toMatch(/eyJ|sb_|service_role|\.env|password/i);
  });
});
