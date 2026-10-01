import { describe, expect, it } from "vitest";
import { FIRST_WEEK, canTransition, evaluateFirstWeek } from "./firstWeek";

describe("First Week transition", () => {
  it("does not end before 5 available days, even with plenty of data", () => {
    expect(evaluateFirstWeek({ availableDays: 4, confirmedMeals: 40 })).toEqual({ transition: false });
  });

  it("ends early at 5 available days with 10 confirmed meals", () => {
    expect(evaluateFirstWeek({ availableDays: 5, confirmedMeals: 10 })).toEqual({
      transition: true,
      reason: "enough_data",
      hadEnoughData: true,
    });
  });

  it("keeps going at 5 to 14 days without enough meals", () => {
    expect(evaluateFirstWeek({ availableDays: 9, confirmedMeals: 9 })).toEqual({ transition: false });
  });

  it("always ends at 15 available days, and says whether there was enough data", () => {
    expect(evaluateFirstWeek({ availableDays: 15, confirmedMeals: 2 })).toEqual({
      transition: true,
      reason: "max_days_reached",
      hadEnoughData: false,
    });
    expect(evaluateFirstWeek({ availableDays: 15, confirmedMeals: 30 })).toMatchObject({
      transition: true,
      reason: "max_days_reached",
      hadEnoughData: true,
    });
  });

  it("uses the agreed constants", () => {
    expect(FIRST_WEEK).toEqual({ minAvailableDays: 5, maxAvailableDays: 15, minConfirmedMeals: 10 });
  });
});

describe("lifecycle", () => {
  it("only moves forward, one step at a time", () => {
    expect(canTransition("NEW", "ONBOARDING")).toBe(true);
    expect(canTransition("ONBOARDING", "FIRST_WEEK")).toBe(true);
    expect(canTransition("FIRST_WEEK", "WEEKLY_CYCLE")).toBe(true);
    expect(canTransition("NEW", "FIRST_WEEK")).toBe(false);
    expect(canTransition("WEEKLY_CYCLE", "FIRST_WEEK")).toBe(false);
  });
});
