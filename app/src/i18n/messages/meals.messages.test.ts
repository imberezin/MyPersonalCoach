// The meals namespace and the two lines Me adds: both catalogs agree, every key the screens read exists, every
// message formats, and the plural reads right in both languages. The forbidden words are scanned for this
// namespace in app.messages.test.ts and catalog-wide in interventions/library.test.ts.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { MEALS_MESSAGE_KEYS } from "@/components/meals/messageKeys";
import { MEAL_NOTICES } from "@/domain/food/routes";
import en from "./en.json";
import he from "./he.json";

type Tree = { [key: string]: string | Tree };

const catalogs = { he: he as Tree, en: en as Tree };
const locales = ["he", "en"] as const;

function leafPaths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`),
  );
}

function leaf(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const meals = (locale: (typeof locales)[number]) => catalogs[locale].meals as Tree;
const mealsLeaves = leafPaths(catalogs.he.meals as Tree);

/** The names a message takes: `{time}`, and the `count` of a plural. Nested plural branches (`#`) add none. */
function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();
}

const translate = (locale: (typeof locales)[number], key: string, values?: Record<string, string | number>) =>
  createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, namespace: "meals" as never, timeZone: "UTC" })(
    key as never,
    values as never,
  ) as string;

describe("the meals messages", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(meals("en")).sort()).toEqual(leafPaths(meals("he")).sort());
  });

  it("has no empty text", () => {
    for (const locale of locales) {
      for (const path of leafPaths(meals(locale))) expect(leaf(meals(locale), path)?.trim(), `${locale}: meals.${path}`).toBeTruthy();
    }
  });

  it("has every key of the contract in both languages", () => {
    expect(MEALS_MESSAGE_KEYS.length).toBeGreaterThan(20);
    for (const locale of locales) {
      for (const path of MEALS_MESSAGE_KEYS) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has no meals key that the contract does not list (so nothing is written that nothing reads)", () => {
    const listed = new Set(MEALS_MESSAGE_KEYS);
    expect(mealsLeaves.map((path) => `meals.${path}`).filter((path) => !listed.has(path))).toEqual([]);
  });

  it("has a notice for every notice the address can carry", () => {
    for (const locale of locales) expect(Object.keys((meals(locale).notice as Tree)).sort(), locale).toEqual([...MEAL_NOTICES].sort());
  });

  it("uses the same placeholders in both languages for every message", () => {
    for (const path of mealsLeaves) {
      expect(placeholders(leaf(meals("he"), path) as string), `meals.${path}`).toEqual(placeholders(leaf(meals("en"), path) as string));
    }
  });

  it("keeps the placeholders the list fills in", () => {
    const expected: Record<string, string[]> = { "row.when": ["day", "meal", "time"], "row.more": ["count"] };
    for (const [path, names] of Object.entries(expected)) {
      for (const locale of locales) expect(placeholders(leaf(meals(locale), path) as string), `${locale}: meals.${path}`).toEqual(names);
    }
  });

  it("gives every plural an 'other' branch", () => {
    for (const locale of locales) {
      for (const path of mealsLeaves) {
        const message = leaf(meals(locale), path) as string;
        if (/\bplural\b/.test(message)) expect(message, `${locale}: meals.${path}`).toMatch(/\bother\s*\{/);
      }
    }
  });

  it("formats every message without an error", () => {
    const values = { meal: "x", day: "x", time: "13:30", count: 2 };
    for (const locale of locales) {
      for (const path of mealsLeaves) {
        const text = translate(locale, path, values);
        expect(text, `${locale}: meals.${path}`).toBeTruthy();
        expect(text, `${locale}: meals.${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("counts the names left out: 'one more' and 'N more' in both languages", () => {
    expect(translate("he", "row.more", { count: 1 })).toBe("ועוד אחד");
    expect(translate("he", "row.more", { count: 2 })).toBe("ועוד 2");
    expect(translate("en", "row.more", { count: 1 })).toBe("and 1 more");
    expect(translate("en", "row.more", { count: 2 })).toBe("and 2 more");
  });

  it("joins the meal line from the pieces the caller passes", () => {
    expect(translate("he", "row.when", { meal: "ארוחת צהריים", day: "היום", time: "13:05" })).toBe("ארוחת צהריים · היום ב-13:05");
    expect(translate("en", "row.when", { meal: "Lunch", day: "today", time: "13:05" })).toBe("Lunch · today at 13:05");
  });

  it("states the one honest fact plainly and promises nothing it cannot keep", () => {
    expect(leaf(meals("en"), "confirm.body")).toContain("can't be undone");
    for (const locale of locales) {
      const text = JSON.stringify(meals(locale)).toLowerCase();
      for (const word of ["permanent", "completely", "forever", "warning", "careful", "בטוח", "לצמיתות", "לחלוטין", "זהירות", "אזהרה"]) {
        expect(text, `${locale}: ${word}`).not.toContain(word);
      }
    }
  });

  it("has the two lines the Me page adds", () => {
    for (const locale of locales) {
      expect(leaf(catalogs[locale], "me.mealsLink"), locale).toBeTruthy();
      expect(leaf(catalogs[locale], "me.mealsHint"), locale).toBeTruthy();
    }
  });
});
