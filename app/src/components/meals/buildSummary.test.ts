// One meal in words, with the REAL catalogs in both languages: the day word, the isolated time, the zone,
// the food names as parts, the cut-off count and the empty line.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import type { MealEntrySummary } from "@/domain/food";
import { LOCALES, catalogs, type TestLocale } from "../food/foodTestKit";
import type { FoodTranslator } from "../food/formatPortion";
import { buildMealSummary } from "./buildSummary";

function translator(locale: TestLocale, namespace: "food" | "meals"): FoodTranslator {
  const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, namespace: namespace as never, timeZone: "UTC" });
  return (key, values) => t(key as never, values as never);
}

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const ZONE = "Asia/Jerusalem";
// 13:00 on 2026-10-01 in Jerusalem (UTC+3 until 25 October).
const NOW = new Date("2026-10-01T10:00:00Z");

const meal = (over: Partial<MealEntrySummary> = {}): MealEntrySummary => ({
  id: ID,
  occurredAt: new Date("2026-10-01T10:05:00Z"),
  mealType: "lunch",
  foods: ["לחם", "גבינה", "קפה"],
  ...over,
});

const build = (locale: TestLocale, entry: MealEntrySummary, over: { now?: Date; timeZone?: string } = {}) =>
  buildMealSummary(entry, {
    now: over.now ?? NOW,
    timeZone: over.timeZone ?? ZONE,
    locale,
    food: translator(locale, "food"),
    meals: translator(locale, "meals"),
  });

const names = (parts: Array<{ kind: string; text: string }>) => parts.filter((part) => part.kind === "food").map((part) => part.text);
const joined = (parts: Array<{ text: string }>) => parts.map((part) => part.text).join("");
const names7 = ["א", "ב", "ג", "ד", "ה", "ו", "ז"];

describe.each(LOCALES)("buildMealSummary in %s", (locale) => {
  const food = catalogs[locale].food;

  it("names the meal type, 'today' and the time, with the time isolated", () => {
    const summary = build(locale, meal());
    expect(summary.whenText).toContain(food.mealType.lunch);
    expect(summary.whenText).toContain(food.day.today);
    expect(summary.whenText).toContain("⁦13:05⁩");
  });

  it("says 'yesterday' for the local day before", () => {
    const summary = build(locale, meal({ occurredAt: new Date("2026-09-30T10:05:00Z") }));
    expect(summary.whenText).toContain(food.day.yesterday);
    expect(summary.whenText).not.toContain(food.day.today);
  });

  it("uses a short date from Intl for an older day, in the language and zone, with Western digits", () => {
    const summary = build(locale, meal({ occurredAt: new Date("2026-09-28T09:00:00Z") }));
    expect(summary.whenText).not.toContain(food.day.today);
    expect(summary.whenText).not.toContain(food.day.yesterday);
    expect(summary.whenText).toContain("28");
    expect(summary.whenText).toContain("⁦12:00⁩");
    if (locale === "en") expect(summary.whenText).toMatch(/Mon.*Sep/);
  });

  it("writes the short date in the person's own language, not the other one", () => {
    const at = new Date("2026-09-28T09:00:00Z");
    const dateIn = (lang: TestLocale) => new Intl.DateTimeFormat(lang, { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" }).format(at);
    const other = locale === "he" ? "en" : "he";
    expect(dateIn(locale)).not.toBe(dateIn(other));
    const { whenText } = build(locale, meal({ occurredAt: at }));
    expect(whenText).toContain(dateIn(locale));
    expect(whenText).not.toContain(dateIn(other));
  });

  it("takes the day of the short date in the person's zone: 22:30Z on the 27th is already the 28th in Jerusalem", () => {
    const entry = meal({ occurredAt: new Date("2026-09-27T22:30:00Z") });
    const jerusalem = build(locale, entry, { timeZone: "Asia/Jerusalem" });
    const utc = build(locale, entry, { timeZone: "UTC" });
    expect(jerusalem.whenText).toContain("28");
    expect(jerusalem.whenText).not.toContain("27");
    expect(utc.whenText).toContain("27");
    expect(utc.whenText).not.toContain("28");
  });

  it("keeps a meal near local midnight on the person's day: 21:30Z is 00:30 on the 2nd in Jerusalem", () => {
    const now = new Date("2026-10-01T22:30:00Z");
    const summary = build(locale, meal({ occurredAt: new Date("2026-10-01T21:30:00Z") }), { now });
    expect(summary.whenText).toContain("⁦00:30⁩");
    expect(summary.whenText).toContain(food.day.today);
  });

  it("honours the zone: the same instant is a different day and time in UTC and in Jerusalem", () => {
    const now = new Date("2026-10-01T22:30:00Z");
    const entry = meal({ occurredAt: new Date("2026-10-01T10:05:00Z") });
    const jerusalem = build(locale, entry, { now, timeZone: "Asia/Jerusalem" });
    const utc = build(locale, entry, { now, timeZone: "UTC" });
    expect(jerusalem.whenText).toContain("⁦13:05⁩");
    expect(jerusalem.whenText).toContain(food.day.yesterday);
    expect(utc.whenText).toContain("⁦10:05⁩");
    expect(utc.whenText).toContain(food.day.today);
  });

  it("falls back to a valid zone instead of throwing on a garbage one", () => {
    expect(() => build(locale, meal({ occurredAt: new Date("2026-09-20T09:00:00Z") }), { timeZone: "Not/AZone" })).not.toThrow();
  });

  it("has a word for every meal type", () => {
    for (const type of ["breakfast", "lunch", "dinner", "snack", "other"] as const) {
      expect(build(locale, meal({ mealType: type })).whenText).toContain(food.mealType[type]);
    }
  });

  it("builds the id the controls point at", () => {
    expect(build(locale, meal()).id).toBe(`meal-${ID}`);
  });

  it("gives the empty line, and no food parts, for a meal with no readable foods", () => {
    const summary = build(locale, meal({ foods: [] }));
    expect(summary.foods).toEqual([]);
    expect(summary.moreText).toBeNull();
    expect(summary.emptyText).toBe(catalogs[locale].meals.row.noFoods);
  });

  it("lists one to four names with the language's own list words, every name a 'food' part", () => {
    for (const count of [1, 3, 4]) {
      const foods = names7.slice(0, count);
      const summary = build(locale, meal({ foods }));
      expect(names(summary.foods), `${count} names`).toEqual(foods);
      expect(summary.moreText, `${count} names`).toBeNull();
      expect(summary.emptyText, `${count} names`).toBeNull();
      for (const part of summary.foods.filter((p) => p.kind === "text")) expect(part.text.length).toBeGreaterThan(0);
    }
    const three = build(locale, meal({ foods: ["x", "y", "z"] }));
    expect(joined(three.foods)).toMatch(locale === "he" ? /^x, y ו-?z$/ : /^x, y,? and z$/);
    expect(build(locale, meal({ foods: ["x"] })).foods).toEqual([{ kind: "food", text: "x" }]);
  });

  it("cuts a long list to four names joined by commas, and counts the rest", () => {
    const summary = build(locale, meal({ foods: names7 }));
    expect(names(summary.foods)).toEqual(names7.slice(0, 4));
    expect(joined(summary.foods)).toBe("א, ב, ג, ד");
    expect(summary.moreText).toBe(locale === "he" ? "ועוד 3" : "and 3 more");
    expect(summary.emptyText).toBeNull();
  });

  it("says 'one more' for exactly one name over", () => {
    const summary = build(locale, meal({ foods: names7.slice(0, 5) }));
    expect(summary.moreText).toBe(locale === "he" ? "ועוד אחד" : "and 1 more");
    // Cut off, so the first four names are joined by plain commas, not by the language's "and".
    expect(joined(summary.foods)).toBe("א, ב, ג, ד");
  });

  it("shows names only: no portion, no number, no verdict", () => {
    const summary = build(locale, meal({ foods: ["לחם", "גבינה"] }));
    expect(`${summary.whenText} ${joined(summary.foods)}`).not.toMatch(/%|kcal|calor/i);
  });
});
