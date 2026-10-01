// The food namespace: both catalogs agree, every key the screens and the server read exists, every message
// formats, and the voice rules hold (calm, no verdicts, no calories). The catalog-wide forbidden words are
// in interventions/library.test.ts and the stricter per-namespace list is in app.messages.test.ts.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { FOOD_MESSAGE_KEYS } from "@/components/food/messageKeys";
import { PHOTO_BODY_REASONS } from "@/components/food/client/problemActions";
import { PROBLEM_REASONS } from "@/domain/food/analyzeTypes";
import { MEAL_TYPES, PORTION_SIZES, PORTION_UNITS } from "@/domain/food/types";
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

const food = (locale: (typeof locales)[number]) => catalogs[locale].food as Tree;
const foodLeaves = leafPaths(catalogs.he.food as Tree);

/** The names a message takes: `{time}`, and the `count` of a plural. Nested plural branches (`{# slice}`) add none. */
function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();
}

describe("the food messages", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(food("en")).sort()).toEqual(leafPaths(food("he")).sort());
  });

  it("has no empty text", () => {
    for (const locale of locales) {
      for (const path of leafPaths(food(locale))) expect(leaf(food(locale), path)?.trim(), `${locale}: food.${path}`).toBeTruthy();
    }
  });

  it("has every key of the contract in both languages", () => {
    expect(FOOD_MESSAGE_KEYS.length).toBeGreaterThan(100);
    for (const locale of locales) {
      for (const path of FOOD_MESSAGE_KEYS) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has no key that the contract does not list (so nothing is written that nothing reads)", () => {
    const listed = new Set(FOOD_MESSAGE_KEYS);
    const unlisted = foodLeaves.map((path) => `food.${path}`).filter((path) => !listed.has(path));
    expect(unlisted).toEqual([]);
  });

  it("uses the same placeholders in both languages for every message", () => {
    for (const path of foodLeaves) {
      const hebrew = leaf(food("he"), path) as string;
      const english = leaf(food("en"), path) as string;
      expect(placeholders(hebrew), `food.${path}`).toEqual(placeholders(english));
    }
  });

  it("keeps the placeholders the screens and the server fill in", () => {
    const expected: Record<string, string[]> = {
      "confirm.when": ["day", "meal", "time"],
      "confirm.whenOther": ["meal", "time"],
      "edit.foodLabel": ["n"],
      "edit.removeFor": ["food"],
      "edit.errors.too_many_items": ["max"],
      "portion.about": ["portion"],
      "portion.half": ["unit"],
    };
    for (const [path, names] of Object.entries(expected)) {
      for (const locale of locales) expect(placeholders(leaf(food(locale), path) as string), `${locale}: food.${path}`).toEqual(names);
    }
  });

  it("gives every plural an 'other' branch", () => {
    for (const locale of locales) {
      for (const path of foodLeaves) {
        const message = leaf(food(locale), path) as string;
        if (/\bplural\b/.test(message)) expect(message, `${locale}: food.${path}`).toMatch(/\bother\s*\{/);
      }
    }
  });

  it("formats every message without an error", () => {
    const values = { time: "13:30", max: 20, n: 2, food: "x", meal: "x", day: "x", portion: "x", unit: "x", count: 2 };
    for (const locale of locales) {
      const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, namespace: "food", timeZone: "UTC" });
      for (const path of foodLeaves) {
        const text = t(path as never, values as never);
        expect(text, `${locale}: food.${path}`).toBeTruthy();
        expect(text, `${locale}: food.${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("names the unit list exactly as the domain does, singular and plural", () => {
    for (const locale of locales) {
      expect(Object.keys(food(locale).unit as Tree), locale).toEqual([...PORTION_UNITS]);
      expect(Object.keys(food(locale).unitOne as Tree), locale).toEqual([...PORTION_UNITS]);
    }
  });

  it("has a word for every meal type and every portion size", () => {
    for (const locale of locales) {
      expect(Object.keys(food(locale).mealType as Tree), locale).toEqual([...MEAL_TYPES]);
      expect(Object.keys((food(locale).portion as Tree).size as Tree), locale).toEqual([...PORTION_SIZES]);
    }
  });

  it("offers today and yesterday, the two days the edit form can choose", () => {
    for (const locale of locales) expect(Object.keys(food(locale).day as Tree), locale).toEqual(["today", "yesterday"]);
  });

  it("has a title and a body for every problem reason, and for nothing else", () => {
    const reasons = PROBLEM_REASONS.slice().sort();
    for (const locale of locales) {
      const problem = food(locale).problem as Tree;
      const present = Object.keys(problem).filter((key) => key !== "action").sort();
      expect(present, locale).toEqual(reasons);
      for (const reason of reasons) {
        expect(Object.keys(problem[reason] as Tree).filter((key) => key !== "bodyPhoto").sort(), `${locale}: ${reason}`).toEqual(["body", "title"]);
      }
    }
  });

  it("has no panel for the quiet-time answer: the client navigates to the chooser instead", () => {
    for (const locale of locales) expect(Object.keys(food(locale).problem as Tree)).not.toContain("quiet_time");
  });

  it("has the photo body for exactly the three reasons that offer keeping the written words", () => {
    for (const locale of locales) {
      const problem = food(locale).problem as Tree;
      const withPhotoBody = Object.keys(problem).filter((key) => key !== "action" && "bodyPhoto" in (problem[key] as Tree));
      expect(withPhotoBody.sort(), locale).toEqual(["ai_unavailable", "daily_cap", "rate_limited"]);
      expect(withPhotoBody.sort(), locale).toEqual([...PHOTO_BODY_REASONS].sort());
    }
  });

  it("has an edit message for every edit error code", () => {
    for (const locale of locales) {
      expect(Object.keys((food(locale).edit as Tree).errors as Tree).sort(), locale).toEqual(
        ["amount_invalid", "meal_type_invalid", "name_too_long", "no_items", "not_saved", "time_future", "time_invalid", "time_too_old", "too_many_items", "unit_missing"],
      );
    }
  });

  it("has the six actions the problem panel can offer", () => {
    for (const locale of locales) {
      expect(Object.keys((food(locale).problem as Tree).action as Tree).sort(), locale).toEqual(
        ["checkPending", "goHome", "retry", "saveAsWritten", "signIn", "writeInstead"],
      );
    }
  });

  it("changed the Report sheet note: the food rows are live now, the others are still being prepared", () => {
    expect(leaf(catalogs.he, "report.sheet.note")).toBe("האפשרויות האחרות עוד בהכנה.");
    expect(leaf(catalogs.en, "report.sheet.note")).toBe("The other options are still being prepared.");
  });
});

describe("the voice of the food messages", () => {
  // The stricter per-namespace list of app.messages.test.ts and the catalog-wide list of library.test.ts
  // both apply to this namespace; they are repeated here so a failure points at the food copy directly.
  const forbidden = {
    he: ["!", "החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "נכשל", "מתחילים מחדש", "להתחיל מחדש", "הרסת", "פיצוי", "קלוריות", "לשרוף", "קלוריה"],
    en: ["!", "missed", "score", "percent", "streak", "failed", "overdue", "behind", "start over", "ruined", "compensat", "calorie", "burn", "kcal"],
  };

  it.each(locales)("keeps the %s namespace free of verdict, shame and calorie words (keys count too)", (locale) => {
    const text = JSON.stringify(catalogs[locale].food).toLowerCase();
    for (const word of forbidden[locale]) expect(text, `${locale}: "${word}"`).not.toContain(word.toLowerCase());
  });

  it("never pairs a digit with kcal, in either language", () => {
    for (const locale of locales) expect(JSON.stringify(catalogs[locale].food)).not.toMatch(/\d\s*kcal/i);
  });

  it("writes amounts as digits and a unit noun, never as a gendered Hebrew number word", () => {
    const text = JSON.stringify(catalogs.he.food);
    for (const word of ["שתי ", "שני ", "שלוש ", "שלושה ", "ארבע ", "ארבעה "]) {
      // The one allowed place is the example sentence in the text field's placeholder.
      const stripped = text.replace(JSON.stringify(leaf(food("he"), "text.placeholder")).slice(1, -1), "");
      expect(stripped, word).not.toContain(word);
    }
  });

  it("writes the Hebrew millilitre sign with the real gershayim character", () => {
    expect(leaf(food("he"), "unitOne.ml")).toBe("מ״ל");
    expect(JSON.stringify(catalogs.he.food)).not.toContain('מ"ל');
  });

  it("makes no promise about speed, accuracy or outcome", () => {
    for (const locale of locales) {
      expect(JSON.stringify(catalogs[locale].food).toLowerCase(), locale).not.toMatch(/guarantee|always|never|תמיד|אף פעם|מובטח/);
    }
  });
});
