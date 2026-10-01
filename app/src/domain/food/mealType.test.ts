import { describe, expect, it } from "vitest";
import { MEAL_TYPE_DEFAULT_MINUTE, MEAL_TYPE_WINDOWS, inferMealType, isMealType } from "./mealType";
import { MEAL_TYPES, type MealType } from "./types";

const at = (hh: number, mm: number) => hh * 60 + mm;

describe("inferMealType", () => {
  it.each<[string, number, MealType]>([
    ["04:59", at(4, 59), "snack"],
    ["05:00", at(5, 0), "breakfast"],
    ["10:59", at(10, 59), "breakfast"],
    ["11:00", at(11, 0), "lunch"],
    ["15:59", at(15, 59), "lunch"],
    ["16:00", at(16, 0), "snack"],
    ["17:59", at(17, 59), "snack"],
    ["18:00", at(18, 0), "dinner"],
    ["22:59", at(22, 59), "dinner"],
    ["23:00", at(23, 0), "snack"],
    ["23:59", at(23, 59), "snack"],
    ["00:00", 0, "snack"],
  ])("%s is %s", (_label, minute, expected) => {
    expect(inferMealType(minute)).toBe(expected);
  });

  it("is total over the whole day and always gives a known type", () => {
    for (let m = 0; m < 1440; m++) expect(MEAL_TYPES).toContain(inferMealType(m));
  });

  it("takes a value outside the day modulo 24 hours and a non-number as other", () => {
    expect(inferMealType(1440 + at(12, 0))).toBe("lunch");
    expect(inferMealType(-1)).toBe("snack");
    expect(inferMealType(Number.NaN)).toBe("other");
  });
});

describe("the tables", () => {
  it("windows cover the whole day with no gap and no overlap", () => {
    const covered = new Array<number>(1440).fill(0);
    for (const w of MEAL_TYPE_WINDOWS) {
      for (let m = w.fromMinute; m !== w.toMinute; m = (m + 1) % 1440) covered[m] += 1;
    }
    expect(covered.every((n) => n === 1)).toBe(true);
  });

  it("has a default minute for every type, and each lands inside its own window", () => {
    expect(Object.keys(MEAL_TYPE_DEFAULT_MINUTE).sort()).toEqual([...MEAL_TYPES].sort());
    for (const type of MEAL_TYPES) {
      if (type !== "other") expect(inferMealType(MEAL_TYPE_DEFAULT_MINUTE[type])).toBe(type);
    }
  });
});

describe("isMealType", () => {
  it("accepts the five types only", () => {
    for (const type of MEAL_TYPES) expect(isMealType(type)).toBe(true);
    for (const bad of ["Breakfast", "brunch", "", null, undefined, 1, {}]) expect(isMealType(bad)).toBe(false);
  });
});
