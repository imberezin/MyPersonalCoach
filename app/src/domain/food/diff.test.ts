import { describe, expect, it } from "vitest";
import { diffMeal, isDiffEmpty } from "./diff";
import type { FoodItem, MealDraft } from "./types";

const item = (name: string, portion: FoodItem["portion"] = null, uncertain = false): FoodItem => ({ name, portion, uncertain });
const meal = (items: FoodItem[], overrides: Partial<MealDraft> = {}): MealDraft => ({
  items,
  mealType: "lunch",
  occurredAt: new Date("2027-01-12T10:30:00Z"),
  ...overrides,
});

const cups = (n: number) => ({ kind: "amount", amount: n, unit: "cup", estimated: false }) as const;

describe("diffMeal", () => {
  it("finds no change between equal meals", () => {
    const a = meal([item("bread", cups(1)), item("coffee")]);
    const diff = diffMeal(a, meal([item("bread", cups(1)), item("coffee")]));
    expect(diff).toEqual({ foodChanged: false, portionChanged: false, typeChanged: false, timeChanged: false, added: 0, removed: 0 });
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it("counts a rename as one removed and one added", () => {
    const diff = diffMeal(meal([item("bread"), item("coffee")]), meal([item("bread"), item("tea")]));
    expect(diff).toMatchObject({ foodChanged: true, added: 1, removed: 1, portionChanged: false });
    expect(isDiffEmpty(diff)).toBe(false);
  });

  it("matches names case-insensitively", () => {
    expect(isDiffEmpty(diffMeal(meal([item("Bread")]), meal([item("bread")])))).toBe(true);
  });

  it("counts added and removed foods", () => {
    const diff = diffMeal(meal([item("a"), item("b"), item("c")]), meal([item("a"), item("d"), item("e"), item("f")]));
    expect(diff).toMatchObject({ foodChanged: true, added: 3, removed: 2 });
  });

  it("notices a changed portion on a food that stayed", () => {
    expect(diffMeal(meal([item("rice", cups(1))]), meal([item("rice", cups(2))]))).toMatchObject({ portionChanged: true, foodChanged: false });
    expect(diffMeal(meal([item("rice")]), meal([item("rice", cups(1))])).portionChanged).toBe(true);
    expect(diffMeal(meal([item("rice", cups(1))]), meal([item("rice")])).portionChanged).toBe(true);
    expect(diffMeal(meal([item("rice", { kind: "size", size: "small", estimated: false })]), meal([item("rice", { kind: "size", size: "large", estimated: false })])).portionChanged).toBe(true);
  });

  it("does not count the 'estimated' flag as a portion change", () => {
    const estimated = { kind: "amount", amount: 1, unit: "cup", estimated: true } as const;
    expect(isDiffEmpty(diffMeal(meal([item("rice", estimated)]), meal([item("rice", cups(1))])))).toBe(true);
  });

  it("notices a changed meal type", () => {
    expect(diffMeal(meal([item("a")]), meal([item("a")], { mealType: "dinner" }))).toMatchObject({ typeChanged: true, foodChanged: false });
  });

  it("notices a time change of one minute, but not of seconds inside a minute", () => {
    const base = new Date("2027-01-12T10:30:00Z");
    expect(diffMeal(meal([item("a")]), meal([item("a")], { occurredAt: new Date("2027-01-12T10:31:00Z") })).timeChanged).toBe(true);
    expect(diffMeal(meal([item("a")]), meal([item("a")], { occurredAt: new Date(base.getTime() + 59_000) })).timeChanged).toBe(false);
    expect(diffMeal(meal([item("a")]), meal([item("a")], { occurredAt: new Date(base.getTime() - 1000) })).timeChanged).toBe(true);
  });

  it("ignores the 'maybe' flag: a review that changes nothing is not a correction", () => {
    expect(isDiffEmpty(diffMeal(meal([item("a", null, true)]), meal([item("a", null, false)])))).toBe(true);
  });

  it("handles a food named twice", () => {
    expect(diffMeal(meal([item("egg"), item("egg")]), meal([item("egg")]))).toMatchObject({ removed: 1, added: 0, foodChanged: true });
    expect(isDiffEmpty(diffMeal(meal([item("egg"), item("egg")]), meal([item("egg"), item("egg")])))).toBe(true);
  });

  it("sees a changed portion on the second of two foods with the same name", () => {
    const before = meal([item("egg", cups(1)), item("egg", cups(2))]);
    expect(diffMeal(before, meal([item("egg", cups(1)), item("egg", cups(1))])).portionChanged).toBe(true);
    expect(diffMeal(before, meal([item("egg", cups(1)), item("egg", cups(2))])).portionChanged).toBe(false);
  });

  it("does not care about the order of the foods", () => {
    expect(isDiffEmpty(diffMeal(meal([item("a"), item("b")]), meal([item("b"), item("a")])))).toBe(true);
  });

  it("handles empty meals", () => {
    expect(isDiffEmpty(diffMeal(meal([]), meal([])))).toBe(true);
    expect(diffMeal(meal([]), meal([item("a")]))).toMatchObject({ added: 1, removed: 0 });
  });
});
