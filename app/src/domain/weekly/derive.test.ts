import { describe, expect, it } from "vitest";
import type { OfflinePeriod } from "../offline";
import { zonedInstantUtc } from "../time";
import { findReturn, mealDaysIn, type WeeklyMeal } from "./derive";
import { weekWindowOf } from "./week";

const TZ = "Asia/Jerusalem";

function local(day: string, time = "00:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedInstantUtc(y, m, d, hh, mm, TZ);
}

const shabbat = (friday: string, saturday: string): OfflinePeriod => ({ type: "SHABBAT", start: local(friday, "17:00"), end: local(saturday, "18:00") });
const meal = (day: string, time: string, over: Partial<WeeklyMeal> = {}): WeeklyMeal => ({
  id: `${day}T${time}`,
  occurredAt: local(day, time),
  aggregated: false,
  ...over,
});

describe("mealDaysIn", () => {
  const week = weekWindowOf(local("2026-10-14", "12:00"), TZ); // 2026-10-11 .. 2026-10-17
  const window = { start: week.start, end: week.end };
  const periods = [shabbat("2026-10-16", "2026-10-17")];
  const days = (meals: WeeklyMeal[], ps: OfflinePeriod[] = periods, w = window) => mealDaysIn({ meals, periods: ps, timeZone: TZ, window: w });

  it("is 0 without meals", () => {
    expect(days([])).toBe(0);
  });

  it("counts two meals on one day as one day", () => {
    expect(days([meal("2026-10-12", "08:00"), meal("2026-10-12", "19:00")])).toBe(1);
  });

  it("counts distinct days", () => {
    expect(days([meal("2026-10-11", "08:00"), meal("2026-10-12", "08:00"), meal("2026-10-14", "08:00")])).toBe(3);
  });

  it("excludes aggregated meals", () => {
    expect(days([meal("2026-10-12", "08:00", { aggregated: true }), meal("2026-10-13", "08:00")])).toBe(1);
  });

  it("excludes a meal inside a Shabbat period", () => {
    expect(days([meal("2026-10-16", "19:00")])).toBe(0);
    // The same day before candle lighting is an available day and counts.
    expect(days([meal("2026-10-16", "12:00")])).toBe(1);
  });

  it("does not count a meal on an offline Saturday, even one after havdalah (the day is mostly offline)", () => {
    expect(days([meal("2026-10-17", "20:00")])).toBe(0);
    expect(days([meal("2026-10-17", "10:00")])).toBe(0);
  });

  it("counts 23:59 and 00:01 local as two days", () => {
    expect(days([meal("2026-10-12", "23:59"), meal("2026-10-13", "00:01")])).toBe(2);
  });

  it("counts the same pair across the 25 hour fall-back Sunday and the 23 hour spring Friday as two days", () => {
    const fall = weekWindowOf(local("2026-10-27", "12:00"), TZ); // the week of 2026-10-25
    expect(days([meal("2026-10-24", "23:59"), meal("2026-10-25", "00:01")], [], { start: local("2026-10-24"), end: fall.end })).toBe(2);
    expect(days([meal("2026-10-25", "23:59"), meal("2026-10-26", "00:01")], [], { start: fall.start, end: fall.end })).toBe(2);
    const spring = weekWindowOf(local("2027-03-24", "12:00"), TZ); // the week of 2027-03-21
    expect(days([meal("2027-03-26", "23:59"), meal("2027-03-27", "00:01")], [], { start: spring.start, end: spring.end })).toBe(2);
  });

  it("ignores a meal outside the window, with the end exclusive and the start inclusive", () => {
    expect(days([meal("2026-10-10", "20:00"), meal("2026-10-18", "00:00")])).toBe(0);
    expect(days([{ id: "edge", occurredAt: week.start, aggregated: false }])).toBe(1);
    expect(days([{ id: "edge", occurredAt: week.end, aggregated: false }])).toBe(0);
  });

  it("counts only from the window start (the transition day is excluded)", () => {
    const from = { start: local("2026-10-12"), end: week.end };
    expect(days([meal("2026-10-11", "10:00"), meal("2026-10-12", "10:00")], periods, from)).toBe(1);
  });

  it("ignores a meal with an invalid time", () => {
    expect(days([{ id: "bad", occurredAt: new Date(Number.NaN), aggregated: false }, meal("2026-10-12", "08:00")])).toBe(1);
  });

  it("does not mutate its input", () => {
    const meals = [meal("2026-10-12", "08:00"), meal("2026-10-11", "08:00")];
    const copy = meals.map((m) => ({ ...m }));
    days(meals);
    expect(meals).toEqual(copy);
  });
});

describe("findReturn", () => {
  // The window is the week of 2026-10-18 .. 2026-10-24; Shabbat the Saturday before it and the one inside it.
  const week = weekWindowOf(local("2026-10-21", "12:00"), TZ);
  const window = { start: week.start, end: week.end };
  const periods = [shabbat("2026-10-16", "2026-10-17"), shabbat("2026-10-23", "2026-10-24")];
  const ret = (meals: WeeklyMeal[], lastMealBefore: Date | null = null, minGap = 3, ps: OfflinePeriod[] = periods) =>
    findReturn({ meals, lastMealBefore, periods: ps, timeZone: TZ, window, minGapAvailableDays: minGap });

  it("is true for a gap of exactly 3 available days (Monday meal, Friday meal) and false for 2", () => {
    expect(ret([meal("2026-10-19", "10:00"), meal("2026-10-23", "10:00")])).toBe(true);
    expect(ret([meal("2026-10-20", "10:00"), meal("2026-10-23", "10:00")])).toBe(false);
  });

  it("is false for consecutive days and for the same day", () => {
    expect(ret([meal("2026-10-19", "10:00"), meal("2026-10-20", "10:00")])).toBe(false);
    expect(ret([meal("2026-10-19", "08:00"), meal("2026-10-19", "20:00")])).toBe(false);
  });

  it("does not count Shabbat inside the gap: Thursday meal, next meal Monday is Friday + Sunday = 2", () => {
    expect(ret([meal("2026-10-19", "10:00")], local("2026-10-15", "20:00"))).toBe(false);
    // Wednesday meal: Thursday + Friday + Sunday = 3.
    expect(ret([meal("2026-10-19", "10:00")], local("2026-10-14", "20:00"))).toBe(true);
  });

  it("takes the preceding meal from `lastMealBefore` for the first meal of the window", () => {
    expect(ret([meal("2026-10-18", "10:00")], local("2026-10-13", "20:00"))).toBe(true);
    // Wednesday to Sunday leaves Thursday and Friday (Saturday is Shabbat): 2.
    expect(ret([meal("2026-10-18", "10:00")], local("2026-10-14", "20:00"))).toBe(false);
    expect(ret([meal("2026-10-18", "10:00")], local("2026-10-15", "20:00"))).toBe(false);
  });

  it("finds the preceding meal inside the window", () => {
    expect(ret([meal("2026-10-18", "10:00"), meal("2026-10-22", "10:00")])).toBe(true);
  });

  it("is false when there is no preceding meal at all: a first meal is not a return", () => {
    expect(ret([meal("2026-10-22", "10:00")], null)).toBe(false);
    expect(ret([], null)).toBe(false);
    expect(ret([], local("2026-10-01", "10:00"))).toBe(false);
  });

  it("is order independent", () => {
    expect(ret([meal("2026-10-23", "10:00"), meal("2026-10-19", "10:00")])).toBe(true);
  });

  it("never lets an aggregated meal form a return, as the new meal or as the preceding one", () => {
    expect(ret([meal("2026-10-19", "10:00"), meal("2026-10-23", "10:00", { aggregated: true })])).toBe(false);
    // An aggregated meal on Wednesday is not the preceding meal: Monday is, and Monday to Friday is 3 days.
    expect(ret([meal("2026-10-19", "10:00"), meal("2026-10-21", "10:00", { aggregated: true }), meal("2026-10-23", "10:00")])).toBe(true);
    // With the aggregated meal ignored, Monday and Friday leave 3 days, and with the real middle meal they do not.
    expect(ret([meal("2026-10-19", "10:00"), meal("2026-10-21", "10:00"), meal("2026-10-23", "10:00")])).toBe(false);
  });

  it("never lets a meal inside an offline period form a return", () => {
    const inShabbat = meal("2026-10-23", "19:00");
    expect(ret([meal("2026-10-18", "10:00"), inShabbat])).toBe(false);
  });

  it("ignores an offline `lastMealBefore`", () => {
    expect(ret([meal("2026-10-22", "10:00")], local("2026-10-16", "19:00"))).toBe(false);
  });

  it("considers only meals inside the window as the returning meal", () => {
    // The long gap ends in a meal of the NEXT window: not this week's return.
    expect(ret([meal("2026-10-18", "10:00"), meal("2026-10-26", "10:00")])).toBe(false);
  });

  it("is false for a threshold below one", () => {
    expect(ret([meal("2026-10-18", "10:00"), meal("2026-10-22", "10:00")], null, 0)).toBe(false);
    expect(ret([meal("2026-10-18", "10:00"), meal("2026-10-22", "10:00")], null, Number.NaN)).toBe(false);
  });

  it("without Shabbat rows a normal Friday-to-Monday gap reads one day longer (why periodsComplete exists)", () => {
    // Thursday meal, Monday meal: Friday, Saturday, Sunday = 3 when Saturday is not known to be offline.
    expect(ret([meal("2026-10-19", "10:00")], local("2026-10-15", "20:00"), 3, [])).toBe(true);
  });

  it("does not mutate its input", () => {
    const meals = [meal("2026-10-23", "10:00"), meal("2026-10-19", "10:00")];
    const copy = meals.map((m) => ({ ...m }));
    ret(meals);
    expect(meals).toEqual(copy);
  });
});
