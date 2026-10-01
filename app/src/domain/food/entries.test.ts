import { describe, expect, it } from "vitest";
import { MEAL_ENTRY_COLUMNS, MEAL_LIST, clampPages, parseMealEntryRow, summarizeFoods } from "./entries";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  occurred_at: "2026-10-01T10:30:00+00:00",
  meal_type: "lunch",
  items: [
    { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false } },
    { name: "  cheese ", portion: null },
  ],
  ...over,
});

describe("the constants", () => {
  it("are the ones the list is built on", () => {
    expect(MEAL_LIST).toEqual({ pageSize: 50, maxPages: 6, foodsShown: 4, foodsStoredMax: 30 });
    expect(MEAL_ENTRY_COLUMNS).toBe("id, occurred_at, meal_type, items");
  });
});

describe("parseMealEntryRow", () => {
  it("reads a good row: names only, no portions", () => {
    expect(parseMealEntryRow(row())).toEqual({ id: ID, occurredAt: new Date("2026-10-01T10:30:00Z"), mealType: "lunch", foods: ["bread", "cheese"] });
  });

  it("keeps the row, with no foods, when items is not a readable list", () => {
    for (const items of [null, undefined, "bread", 5, { name: "bread" }, [null, 3, "x", {}, { name: 5 }, { name: "" }], []]) {
      expect(parseMealEntryRow(row({ items })), JSON.stringify(items)).toMatchObject({ id: ID, foods: [] });
    }
  });

  it("drops names that are not foods (a link, markup) and keeps the others", () => {
    const items = [{ name: "https://example.test/x" }, { name: "<b>bold</b>" }, { name: "rice" }, { name: "{{template}}" }];
    expect(parseMealEntryRow(row({ items }))?.foods).toEqual(["rice"]);
  });

  it("cleans a name the way every other name is cleaned", () => {
    const dirty = "  ri‮ce\u0000\n  and   beans ";
    expect(parseMealEntryRow(row({ items: [{ name: dirty }] }))?.foods).toEqual(["rice and beans"]);
  });

  it("caps the foods at 30", () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ name: `food ${i}` }));
    const foods = parseMealEntryRow(row({ items }))?.foods;
    expect(foods).toHaveLength(30);
    expect(foods?.[29]).toBe("food 29");
  });

  it("turns a missing or unknown meal type into other", () => {
    for (const meal_type of [null, undefined, "brunch", 7, ""]) {
      expect(parseMealEntryRow(row({ meal_type }))?.mealType, String(meal_type)).toBe("other");
    }
    for (const meal_type of ["breakfast", "lunch", "dinner", "snack", "other"]) {
      expect(parseMealEntryRow(row({ meal_type }))?.mealType).toBe(meal_type);
    }
  });

  it("is null only when the id or the time is unusable", () => {
    expect(parseMealEntryRow(row({ id: undefined }))).toBeNull();
    expect(parseMealEntryRow(row({ id: "" }))).toBeNull();
    expect(parseMealEntryRow(row({ id: 5 }))).toBeNull();
    expect(parseMealEntryRow(row({ id: "x".repeat(65) }))).toBeNull();
    expect(parseMealEntryRow(row({ id: "x".repeat(64) }))).not.toBeNull();
    expect(parseMealEntryRow(row({ occurred_at: null }))).toBeNull();
    expect(parseMealEntryRow(row({ occurred_at: "soon" }))).toBeNull();
    expect(parseMealEntryRow(row({ occurred_at: 1_790_000_000_000 }))).toBeNull();
    // A time that parses on its own is still refused when it is longer than the cap.
    expect(parseMealEntryRow(row({ occurred_at: `2026-10-01T10:30:00.${"0".repeat(60)}Z` }))).toBeNull();
    expect(parseMealEntryRow(row({ occurred_at: `2026-10-01T10:30:00.${"0".repeat(40)}Z` }))).not.toBeNull();
  });

  it("never throws, whatever it is given", () => {
    for (const bad of [undefined, null, 5, "row", [], true, () => 1]) {
      expect(parseMealEntryRow(bad), String(bad)).toBeNull();
    }
  });
});

describe("clampPages", () => {
  it("defaults to 1", () => {
    for (const raw of [undefined, null, "", "abc", "0", "-3", "-0", " ", "NaN", "Infinity", {}, true, [], [""], ["abc"]]) {
      expect(clampPages(raw), JSON.stringify(raw)).toBe(1);
    }
  });

  it("accepts a number inside the range, cutting a fraction", () => {
    expect(clampPages("1")).toBe(1);
    expect(clampPages("2")).toBe(2);
    expect(clampPages("6")).toBe(6);
    expect(clampPages("2.7")).toBe(2);
    expect(clampPages("2.5")).toBe(2);
    expect(clampPages(3)).toBe(3);
    expect(clampPages(3.9)).toBe(3);
    expect(clampPages(" 4 ")).toBe(4);
  });

  it("clamps huge values to the maximum", () => {
    expect(clampPages("7")).toBe(6);
    expect(clampPages("99")).toBe(6);
    expect(clampPages("99999999999999999999999")).toBe(6);
    expect(clampPages("9".repeat(400))).toBe(6);
    expect(clampPages(Number.POSITIVE_INFINITY)).toBe(6);
    expect(clampPages(10_000)).toBe(6);
    expect(clampPages(Number.MAX_SAFE_INTEGER)).toBe(6);
  });

  it("uses the first element of an array", () => {
    expect(clampPages(["3", "4"])).toBe(3);
    expect(clampPages(["99", "2"])).toBe(6);
  });

  it("refuses notations other than plain decimals", () => {
    for (const raw of ["0x10", "1e3", "+2", ".5", "2,5", "٣"]) expect(clampPages(raw), raw).toBe(1);
  });
});

describe("summarizeFoods", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `food ${i + 1}`);

  it("shows everything up to four names", () => {
    expect(summarizeFoods([])).toEqual({ shown: [], more: 0 });
    expect(summarizeFoods(names(3))).toEqual({ shown: names(3), more: 0 });
    expect(summarizeFoods(names(4))).toEqual({ shown: names(4), more: 0 });
  });

  it("cuts after four and counts the rest", () => {
    expect(summarizeFoods(names(5))).toEqual({ shown: names(4), more: 1 });
    expect(summarizeFoods(names(20))).toEqual({ shown: names(4), more: 16 });
  });

  it("honours the `shown` override, including nonsense", () => {
    expect(summarizeFoods(names(5), 2)).toEqual({ shown: names(2), more: 3 });
    expect(summarizeFoods(names(5), 10)).toEqual({ shown: names(5), more: 0 });
    expect(summarizeFoods(names(3), 0)).toEqual({ shown: [], more: 3 });
    expect(summarizeFoods(names(3), -2)).toEqual({ shown: [], more: 3 });
    expect(summarizeFoods(names(3), 1.9)).toEqual({ shown: names(1), more: 2 });
    expect(summarizeFoods(names(6), Number.NaN)).toEqual({ shown: names(4), more: 2 });
  });

  it("does not change its input", () => {
    const input = names(6);
    summarizeFoods(input);
    expect(input).toEqual(names(6));
  });
});
