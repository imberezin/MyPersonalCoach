import { describe, expect, it } from "vitest";
import { decideFirstWeekStep, deriveFirstWeekProgress, NOT_SNOOZED } from "@/domain/firstWeekFlow";
import { itemsToJson } from "@/domain/food/stored";
import { parseMealEntryRow } from "@/domain/food/entries";
import { sanitizeFoodName } from "@/domain/food/sanitize";
import { resolveHome } from "@/domain/home";
import type { OfflinePeriod } from "@/domain/offline";
import { decideEarlySignal, detectLateEvening, effectivePatternStatus } from "@/domain/patterns";
import { localDayOf, localMinuteOfDay } from "@/domain/time";
import { parseSeedArgs, SEED_SCENARIOS, type SeedOptions, type SeedScenario } from "../../scripts/seed-demo/args";
import { assumedWordingGate } from "../../scripts/seed-demo/explain";
import { FOODS, mealTypeOfSlot } from "../../scripts/seed-demo/foods";
import { buildSeedPlan, LATE_WINDOW, periodBeforeMeal, resolveRelative, type SeedPlan } from "../../scripts/seed-demo/plan";
import { seedShabbatRows, seedShabbatSeries, toPlanShabbat } from "../../scripts/seed-demo/shabbat";

function options(flags: Record<string, string | boolean>): SeedOptions {
  const parsed = parseSeedArgs(JSON.stringify(flags));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function planFor(o: SeedOptions): SeedPlan {
  return buildSeedPlan(o, toPlanShabbat(seedShabbatSeries(o)));
}

const DEFAULT_QUIET = { kind: "WINDOW", startMinute: 0, endMinute: 480 } as const;

/** What the app's own domain functions say about a plan at its clock (the loaders' queries, reproduced on the plan). */
function decide(plan: SeedPlan, o: SeedOptions) {
  const timeZone = o.timeZone;
  const periods: OfflinePeriod[] = plan.offline.map((p) => ({ type: p.type, start: p.start, end: p.end }));
  const newestFirst = [...plan.meals].sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime()).slice(0, 10);
  const progress = deriveFirstWeekProgress({ periods, timeZone, startedAt: plan.startedAt, now: plan.asOf, recentMealTimes: newestFirst.map((m) => m.confirmedAt) });
  const step = decideFirstWeekStep(progress);
  // The loader reads aggregated = false only.
  const stamps = plan.meals.filter((m) => !m.aggregated).map((m) => ({ id: m.id, occurredAt: m.occurredAt }));
  const occurrences = detectLateEvening({ meals: stamps, timeZone, asOf: plan.asOf });
  const view = effectivePatternStatus({ occurrences: occurrences.map((x) => x.occurredAt), timeZone, row: null });
  const gate = assumedWordingGate({
    view,
    occurrences: occurrences.length,
    distinctDays: new Set(occurrences.map((x) => x.localDay)).size,
    availableDays: progress.availableDays,
    dailyCap: 40,
  });
  const earlySignal = decideEarlySignal({ view, row: null, now: plan.asOf });
  const home = resolveHome({
    now: plan.asOf,
    timeZone,
    offlinePeriods: periods,
    hasAnyReport: plan.meals.length > 0,
    lifecycle: "FIRST_WEEK",
    firstWeek: progress,
    firstWeekSnoozed: { ...NOT_SNOOZED },
    earlySignal,
    quietHours: DEFAULT_QUIET,
    milestone: null,
  });
  return { progress, step, occurrences, view, gate, home, periods };
}

// The expected values of 16.5, one row per preset. The blueprint's table is the spec; the plan must reproduce it
// through the domain functions the app itself uses.
// (The weight presets are checked in tests/seed/weights.test.ts: they have no meals.)
type MealScenario = Exclude<SeedScenario, `w-${string}`>;
const MEAL_SCENARIOS = SEED_SCENARIOS.filter((s): s is MealScenario => !s.startsWith("w-"));
const EXPECTED: Record<
  MealScenario,
  {
    availableDays: number;
    meals: number;
    aggregated: number;
    evenings: number;
    level: string;
    step: string;
    hadEnoughData?: boolean;
    home: string;
    gate: "OPEN" | string;
  }
> = {
  "day1-empty": { availableDays: 1, meals: 0, aggregated: 0, evenings: 0, level: "NONE", step: "KEEP_GOING", home: "FIRST_WEEK_START", gate: "pattern_not_established" },
  day3: { availableDays: 3, meals: 10, aggregated: 0, evenings: 2, level: "EARLY_SIGNAL", step: "KEEP_GOING", home: "EARLY_SIGNAL", gate: "pattern_not_established" },
  "day4-candidate": { availableDays: 4, meals: 15, aggregated: 0, evenings: 3, level: "CANDIDATE", step: "KEEP_GOING", home: "EARLY_SIGNAL", gate: "OPEN" },
  "day5-early-finish": { availableDays: 5, meals: 18, aggregated: 0, evenings: 4, level: "CANDIDATE", step: "SUMMARY_READY", hadEnoughData: true, home: "FIRST_WEEK_SUMMARY_READY", gate: "OPEN" },
  absence: { availableDays: 5, meals: 5, aggregated: 0, evenings: 0, level: "NONE", step: "WELCOME_BACK", home: "FIRST_WEEK_WELCOME_BACK", gate: "pattern_not_established" },
  "shabbat-week": { availableDays: 7, meals: 18, aggregated: 1, evenings: 2, level: "EARLY_SIGNAL", step: "SUMMARY_READY", hadEnoughData: true, home: "FIRST_WEEK_SUMMARY_READY", gate: "pattern_not_established" },
  "max-days": { availableDays: 15, meals: 2, aggregated: 0, evenings: 0, level: "NONE", step: "SUMMARY_READY", hadEnoughData: false, home: "FIRST_WEEK_SUMMARY_READY", gate: "pattern_not_established" },
};

describe("presets verify themselves against the domain (16.5)", () => {
  it.each(MEAL_SCENARIOS)("%s", (scenario) => {
    const o = options({ scenario });
    const plan = planFor(o);
    const d = decide(plan, o);
    const want = EXPECTED[scenario];

    expect(d.progress.availableDays, "available days").toBe(want.availableDays);
    expect(plan.meals.filter((m) => !m.aggregated)).toHaveLength(want.meals);
    expect(plan.meals.filter((m) => m.aggregated)).toHaveLength(want.aggregated);
    expect(d.progress.confirmedMeals).toBe(Math.min(want.meals + want.aggregated, 10));
    expect(d.occurrences, "late evenings").toHaveLength(want.evenings);
    expect(d.view, "level").toBe(want.level);
    expect(d.step.kind, "step").toBe(want.step);
    if (want.hadEnoughData !== undefined && d.step.kind === "SUMMARY_READY") expect(d.step.hadEnoughData).toBe(want.hadEnoughData);
    expect(d.home.state.key, "Home").toBe(want.home);
    expect(d.gate.open ? "OPEN" : d.gate.reason, "wording gate").toBe(want.gate);
  });

  it("shows the preset documented clock: 09:00 of day N+1, a Wednesday for day3", () => {
    const plan = planFor(options({ scenario: "day3" }));
    expect(plan.asOf.toISOString()).toBe("2026-09-16T06:00:00.000Z"); // Wed 2026-09-16 09:00 Asia/Jerusalem (UTC+3)
    expect(plan.startedAt.toISOString()).toBe("2026-09-13T09:00:00.000Z"); // Sun 12:00 local
  });

  it("day4-candidate: Wednesday-night's two late meals count as ONE evening", () => {
    const o = options({ scenario: "day4-candidate" });
    const plan = planFor(o);
    const late = plan.meals.filter((m) => localMinuteOfDay(m.occurredAt, o.timeZone) >= 1260);
    const lastDay = localDayOf(late[late.length - 1].occurredAt, o.timeZone).key;
    expect(late.filter((m) => localDayOf(m.occurredAt, o.timeZone).key === lastDay)).toHaveLength(2);
    expect(late).toHaveLength(4);
    expect(decide(plan, o).occurrences).toHaveLength(3);
  });

  it("shabbat-week: the Saturday-night aggregated meal is a late-evening time and only its exclusion keeps the count at 2", () => {
    const o = options({ scenario: "shabbat-week" });
    const plan = planFor(o);
    const aggregated = plan.meals.find((m) => m.aggregated);
    expect(aggregated).toBeDefined();
    expect(localMinuteOfDay(aggregated!.occurredAt, o.timeZone)).toBeGreaterThanOrEqual(1260);
    expect(localDayOf(aggregated!.occurredAt, o.timeZone).key).toBe("2026-09-19"); // a Saturday
    const all = detectLateEvening({ meals: plan.meals.map((m) => ({ id: m.id, occurredAt: m.occurredAt })), timeZone: o.timeZone, asOf: plan.asOf });
    expect(all).toHaveLength(3);
    expect(decide(plan, o).occurrences).toHaveLength(2);
    // It belongs to the Shabbat that just ended.
    expect(periodBeforeMeal(aggregated!, plan.offline)?.end.getTime()).toBeLessThan(aggregated!.occurredAt.getTime());
  });

  it("the wording gate of the presets uses the fixed assumption, whatever the environment", () => {
    // 3 evenings, 4 available days, AI configured, nothing used: open. One day fewer: closed. A daily cap too small for the reserve: closed.
    expect(assumedWordingGate({ view: "CANDIDATE", occurrences: 3, distinctDays: 3, availableDays: 4, dailyCap: 40 })).toEqual({ open: true });
    expect(assumedWordingGate({ view: "CANDIDATE", occurrences: 3, distinctDays: 3, availableDays: 3, dailyCap: 40 })).toEqual({ open: false, reason: "too_few_days" });
    expect(assumedWordingGate({ view: "CANDIDATE", occurrences: 3, distinctDays: 3, availableDays: 4, dailyCap: 9 })).toEqual({ open: false, reason: "allowance_reserve" });
  });
});

describe("shape of every plan", () => {
  const scenarios = SEED_SCENARIOS.map((scenario) => ({ scenario, o: options({ scenario }) }));

  it.each(scenarios)("$scenario: times are ordered, in the past of the clock and after onboarding", ({ o }) => {
    const plan = planFor(o);
    for (const m of plan.meals) {
      expect(m.occurredAt.getTime()).toBeLessThanOrEqual(m.confirmedAt.getTime());
      const minutes = (m.confirmedAt.getTime() - m.occurredAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(2);
      expect(minutes).toBeLessThanOrEqual(6);
      expect(m.confirmedAt.getTime()).toBeLessThanOrEqual(plan.asOf.getTime());
      expect(m.occurredAt.getTime(), "no meal before the onboarding moment").toBeGreaterThanOrEqual(plan.startedAt.getTime());
    }
    const sorted = [...plan.meals].map((m) => m.occurredAt.getTime());
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });

  it.each(scenarios)("$scenario: ids are unique and the items satisfy the stored shape", ({ o }) => {
    const plan = planFor(o);
    expect(new Set(plan.meals.map((m) => m.id)).size).toBe(plan.meals.length);
    for (const m of plan.meals) {
      expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(m.items.length).toBeGreaterThanOrEqual(1);
      // Round trip through the app's own writer and reader.
      const row = parseMealEntryRow({ id: m.id, occurred_at: m.occurredAt.toISOString(), meal_type: m.mealType, items: itemsToJson(m.items) });
      expect(row?.foods).toEqual(m.items.map((i) => i.name));
      expect(row?.mealType).toBe(m.mealType);
    }
  });

  it("every food comes from the Hebrew demo list and passes the app's own name sanitizer unchanged", () => {
    const known = new Set(Object.values(FOODS).flatMap((dishes) => dishes.flatMap((dish) => dish.map((item) => item.name))));
    for (const name of known) {
      expect(name, name).toMatch(/[֐-׿]/);
      expect(sanitizeFoodName(name), name).toBe(name);
    }
    for (const { o } of scenarios) {
      for (const meal of planFor(o).meals) for (const item of meal.items) expect(known.has(item.name), item.name).toBe(true);
    }
  });

  it("the foods of a meal type fit it (a late meal is a snack, a breakfast is not a dinner)", () => {
    const o = options({ days: "10", "meals-per-day": "5", "late-days": "2,3,4,5,6", "gap-days": "none", shabbat: "false" });
    const types = new Set(planFor(o).meals.map((m) => m.mealType));
    expect([...types].sort()).toEqual(["breakfast", "dinner", "lunch", "snack"]);
    expect(mealTypeOfSlot("late")).toBe("snack");
  });

  it.each(scenarios)("$scenario: the plan carries no secret and no e-mail", ({ o }) => {
    const text = JSON.stringify(planFor(o));
    expect(text).not.toContain("@");
    expect(text).not.toContain(o.email);
    expect(text.toLowerCase()).not.toMatch(/password|secret|eyj|sb_/);
  });
});

describe("late evenings", () => {
  it("every late meal is at or after 21:00 local and before midnight, in the window the plan documents", () => {
    for (const seed of [1, 2, 3, 7, 11, 99, 12345]) {
      const o = options({ days: "14", "late-days": "1,2,3,4,5,6,8,9,10,11,12,13", "double-late-days": "2,9", seed: String(seed), shabbat: "false" });
      const plan = planFor(o);
      const late = plan.meals.filter((m) => !m.aggregated && localMinuteOfDay(m.occurredAt, o.timeZone) >= 1200);
      expect(late.length).toBeGreaterThan(10);
      for (const m of late) {
        const minute = localMinuteOfDay(m.occurredAt, o.timeZone);
        expect(minute).toBeGreaterThanOrEqual(1260); // 21:00, the detector's own boundary
        expect(minute).toBeGreaterThanOrEqual(LATE_WINDOW.startMinute);
        expect(minute).toBeLessThan(1440);
        expect(localMinuteOfDay(m.confirmedAt, o.timeZone)).toBeLessThan(1440);
      }
    }
  });

  it("regular meals never fall in the late-evening hours (no accidental evenings)", () => {
    const o = options({ days: "20", "late-days": "none", "meals-per-day": "5", shabbat: "false", "gap-days": "none" });
    const plan = planFor(o);
    expect(plan.meals.length).toBeGreaterThan(80);
    for (const m of plan.meals) expect(localMinuteOfDay(m.occurredAt, o.timeZone)).toBeLessThan(1260);
    expect(plan.lateDays).toEqual([]);
  });

  it("--late-days none removes every late meal and --double-late-days applies only to late days", () => {
    const none = planFor(options({ scenario: "day5-early-finish", "late-days": "none" }));
    expect(decide(none, options({ scenario: "day5-early-finish", "late-days": "none" })).occurrences).toHaveLength(0);
    const onlyDouble = planFor(options({ scenario: "day3", "late-days": "none", "double-late-days": "2" }));
    expect(onlyDouble.lateDays).toEqual([]);
  });

  it("plan.lateDays lists the days that really have a late meal", () => {
    const o = options({ scenario: "day5-early-finish" });
    expect(planFor(o).lateDays).toEqual([2, 3, 4, 5]);
  });
});

describe("gap days, Shabbat and the counts", () => {
  it("a gap day has no meals at all", () => {
    const o = options({ scenario: "shabbat-week" });
    const plan = planFor(o);
    expect(plan.meals.filter((m) => m.day === 5)).toHaveLength(0);
    expect(plan.meals.filter((m) => m.day === 4).length).toBeGreaterThan(0);
  });

  it("no non-aggregated meal is inside a Shabbat period, and a Saturday has no meals but the report", () => {
    const o = options({ days: "21", "late-days": "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21", "meals-per-day": "5", "gap-days": "none" });
    const plan = planFor(o);
    expect(plan.offline.length).toBeGreaterThanOrEqual(3);
    for (const m of plan.meals.filter((x) => !x.aggregated)) {
      expect(plan.offline.some((p) => m.occurredAt >= p.start && m.occurredAt < p.end), `meal on day ${m.day} inside Shabbat`).toBe(false);
      // Saturday: day 7, 14, 21 from a Sunday start.
      expect(m.day % 7, `meal on a Saturday (day ${m.day})`).not.toBe(0);
    }
    // Friday has no dinner and no late meal: the candle lighting comes first.
    const friday = plan.meals.filter((m) => m.day === 6);
    expect(friday.every((m) => localMinuteOfDay(m.occurredAt, o.timeZone) < 17 * 60)).toBe(true);
  });

  it("--shabbat false has no offline periods, no Saturday rule and no aggregated meal", () => {
    const o = options({ days: "8", shabbat: "false", "late-days": "none", "gap-days": "none" });
    const plan = planFor(o);
    expect(plan.offline).toEqual([]);
    expect(plan.meals.filter((m) => m.day === 7).length).toBe(3);
    expect(plan.meals.some((m) => m.aggregated)).toBe(false);
  });

  it("--aggregated-saturday-night false removes the report, and is automatic when a Saturday is in the span", () => {
    expect(planFor(options({ scenario: "shabbat-week", "aggregated-saturday-night": "false" })).meals.some((m) => m.aggregated)).toBe(false);
    expect(planFor(options({ scenario: "day5-early-finish" })).meals.some((m) => m.aggregated)).toBe(false); // no Saturday in 5 days
    expect(planFor(options({ days: "14" })).meals.filter((m) => m.aggregated)).toHaveLength(2);
  });

  it("counts per day follow --meals-per-day (day 1 only has the meals after noon)", () => {
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const o = options({ days: "4", "meals-per-day": String(k), "late-days": "none", "gap-days": "none", shabbat: "false" });
      const plan = planFor(o);
      const perDay = (day: number) => plan.meals.filter((m) => m.day === day).length;
      expect(perDay(2)).toBe(k);
      expect(perDay(3)).toBe(k);
      expect(perDay(1)).toBeLessThanOrEqual(k);
      if (k === 3) expect(perDay(1)).toBe(2);
    }
  });

  it("--total-meals keeps the first N in time order (exact boundaries 9 and 10)", () => {
    const base = { scenario: "day5-early-finish", "late-days": "none" } as const;
    const nine = options({ ...base, "total-meals": "9" });
    const ten = options({ ...base, "total-meals": "10" });
    const all = planFor(options(base));
    expect(planFor(nine).meals.map((m) => m.id)).toEqual(all.meals.slice(0, 9).map((m) => m.id));
    expect(decide(planFor(nine), nine).step.kind).toBe("KEEP_GOING");
    expect(decide(planFor(ten), ten).step.kind).toBe("SUMMARY_READY");
  });

  it("nothing is later than the clock: an earlier --as-of drops the later meals from the plan", () => {
    const o = options({ scenario: "day5-early-finish", "as-of": "day 3 08:00" });
    const plan = planFor(o);
    expect(plan.asOf.toISOString()).toBe("2026-09-16T05:00:00.000Z"); // Wed 08:00 (UTC+3)
    expect(plan.meals.every((m) => m.confirmedAt <= plan.asOf)).toBe(true);
    expect(plan.meals.some((m) => m.day >= 4 && localMinuteOfDay(m.occurredAt, o.timeZone) > 8 * 60)).toBe(false);
  });
});

describe("determinism", () => {
  it("the same options give the same plan, ids included", () => {
    const o = options({ scenario: "shabbat-week" });
    expect(planFor(o)).toEqual(planFor(o));
  });

  it("a different seed changes food choices and times but not the structure", () => {
    const a = planFor(options({ scenario: "day5-early-finish", seed: "1" }));
    const b = planFor(options({ scenario: "day5-early-finish", seed: "2" }));
    expect(b.meals.map((m) => m.day)).toEqual(a.meals.map((m) => m.day));
    expect(b.meals.map((m) => m.mealType)).toEqual(a.meals.map((m) => m.mealType));
    expect(b.lateDays).toEqual(a.lateDays);
    expect(b.meals.map((m) => m.id)).not.toEqual(a.meals.map((m) => m.id));
    expect(JSON.stringify(b.meals.map((m) => m.items))).not.toBe(JSON.stringify(a.meals.map((m) => m.items)));
  });

  it("another demo e-mail never shares a meal id (a primary key is global)", () => {
    const a = planFor(options({ scenario: "day3" }));
    const b = planFor(options({ scenario: "day3", email: "second@eating-coach.test" }));
    const ids = new Set(a.meals.map((m) => m.id));
    expect(b.meals.some((m) => ids.has(m.id))).toBe(false);
  });

  it("is additive: day 3 then day 4 share the ids of the days they have in common", () => {
    const three = planFor(options({ scenario: "day3" }));
    const four = planFor(options({ scenario: "day4-candidate" }));
    const fourIds = new Set(four.meals.map((m) => m.id));
    // Day 3's late meals were single, day 4's presets only double day 4: every meal of days 1 to 3 is in both plans.
    for (const m of three.meals) expect(fourIds.has(m.id), `day ${m.day}`).toBe(true);
    expect(four.meals.length).toBeGreaterThan(three.meals.length);
  });
});

describe("relative mode", () => {
  it("makes today day N+1 and ends the plan at the real clock", () => {
    const o = options({ scenario: "day3", mode: "relative" });
    const now = new Date("2026-10-02T12:34:56.000Z"); // Friday 15:34 Asia/Jerusalem
    const r = resolveRelative(o, now);
    expect(r.startDate).toBe("2026-09-29"); // today (10-02) minus 3 days
    expect(r.asOf).toBe(now.toISOString());
    const plan = planFor(r);
    expect(plan.asOf.getTime()).toBe(now.getTime());
    expect(plan.meals.every((m) => m.confirmedAt <= now)).toBe(true);
    expect(decide(plan, r).progress.availableDays).toBeGreaterThanOrEqual(2);
  });

  it("leaves a fixed-mode option untouched", () => {
    const o = options({ scenario: "day3" });
    expect(resolveRelative(o, new Date())).toBe(o);
  });
});

describe("Shabbat rows", () => {
  it("come from the same engine as onboarding and cover the clock plus two weeks", () => {
    const o = options({ scenario: "day3" });
    const series = seedShabbatSeries(o);
    const plan = planFor(o);
    expect(series.length).toBeGreaterThanOrEqual(3);
    expect(series[0].candleLighting.getTime()).toBeGreaterThan(plan.startedAt.getTime());
    expect(series[series.length - 1].havdalah.getTime()).toBeGreaterThan(plan.asOf.getTime() + 13 * 86_400_000);
    const rows = seedShabbatRows(series, plan.startedAt);
    expect(rows).toHaveLength(series.length);
    expect(rows[0].metadata).toMatchObject({ place_key: "jerusalem", city: "Jerusalem", candle_lighting_minutes: 40 });
  });
});
