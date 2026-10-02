// The weight namespace and the two lines Me adds: both catalogs agree, every key the screens read exists, every message
// formats, and the copy rules of the weight item hold (no digit outside a placeholder, no "!", no plural, none of the
// judging words, one spelling of the unit). The lint of the app shell namespaces is in app.messages.test.ts.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { WEIGHT_ERROR_CODES, WEIGHT_MESSAGE_KEYS } from "@/components/weight/messageKeys";
import { WEIGHT_NOTICES } from "@/domain/weight/routes";
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

const weight = (locale: (typeof locales)[number]) => catalogs[locale].weight as Tree;
const weightLeaves = leafPaths(catalogs.he.weight as Tree);

/** The names a message takes: `{min}`, `{max}`. */
function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();
}

const translate = (locale: (typeof locales)[number], key: string, values?: Record<string, string | number>) =>
  createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, namespace: "weight" as never, timeZone: "UTC" })(
    key as never,
    values as never,
  ) as string;

/** The superset of the lint lists of the weight item (Brand voice): none of these may appear in the namespace. */
const FORBIDDEN = {
  he: ["!", "נכשל", "הרסת", "חרגת", "הצלחה", "מצוין", "כישלון", "עודף", "דיאטה", "מתחילים מחדש", "להתחיל מחדש", "פיצוי", "ציון", "אחוז", "רצף", "החמצת", "פספסת", "לפי התוכנית", "בדרך הנכונה", "בפיגור"],
  en: ["!", "failed", "ruined", "exceeded", "success", "great job", "good job", "overweight", "diet", "start over", "compensat", "score", "percent", "streak", "missed", "overdue", "on track", "off track", "behind", "ahead of"],
} as const;

describe("the weight messages", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(weight("en")).sort()).toEqual(leafPaths(weight("he")).sort());
  });

  it("has no empty text", () => {
    for (const locale of locales) {
      for (const path of leafPaths(weight(locale))) expect(leaf(weight(locale), path)?.trim(), `${locale}: weight.${path}`).toBeTruthy();
    }
  });

  it("has every key of the contract in both languages", () => {
    expect(WEIGHT_MESSAGE_KEYS.length).toBeGreaterThan(50);
    for (const locale of locales) {
      for (const path of WEIGHT_MESSAGE_KEYS) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has no weight key that the contract does not list (so nothing is written that nothing reads)", () => {
    const listed = new Set(WEIGHT_MESSAGE_KEYS);
    expect(weightLeaves.map((path) => `weight.${path}`).filter((path) => !listed.has(path))).toEqual([]);
  });

  it("has a notice for every notice the address can carry, and an error for every error code", () => {
    for (const locale of locales) {
      expect(Object.keys(weight(locale).notice as Tree).sort(), locale).toEqual([...WEIGHT_NOTICES].sort());
      expect(Object.keys(weight(locale).errors as Tree).sort(), locale).toEqual([...WEIGHT_ERROR_CODES].sort());
    }
  });

  it("uses the same placeholders in both languages for every message", () => {
    for (const path of weightLeaves) {
      expect(placeholders(leaf(weight("he"), path) as string), `weight.${path}`).toEqual(placeholders(leaf(weight("en"), path) as string));
    }
  });

  it("keeps the placeholders the screens fill in, and only those", () => {
    const expected: Record<string, string[]> = { "errors.out_of_range": ["max", "min"] };
    for (const path of weightLeaves) {
      for (const locale of locales) {
        expect(placeholders(leaf(weight(locale), path) as string), `${locale}: weight.${path}`).toEqual(expected[path] ?? []);
      }
    }
  });

  it("formats every message without an error", () => {
    const values = { min: "30", max: "350" };
    for (const locale of locales) {
      for (const path of weightLeaves) {
        const text = translate(locale, path, values);
        expect(text, `${locale}: weight.${path}`).toBeTruthy();
        expect(text, `${locale}: weight.${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("says the range from the domain's limits", () => {
    expect(translate("en", "errors.out_of_range", { min: "30", max: "350" })).toBe("You can write a weight between 30 and 350 kg.");
    expect(translate("he", "errors.out_of_range", { min: "30", max: "350" })).toContain("30");
  });

  describe("copy rules", () => {
    const rawKeys = [
      ...WEIGHT_MESSAGE_KEYS.filter((path) => path.startsWith("weight.")),
      ...WEIGHT_MESSAGE_KEYS.filter((path) => path.startsWith("me.weights")),
    ];

    it("has no digit outside a placeholder", () => {
      for (const locale of locales) {
        for (const path of rawKeys) {
          const message = (leaf(catalogs[locale], path) as string).replace(/\{[^}]*\}/g, "");
          expect(message, `${locale}: ${path}`).not.toMatch(/\d/);
        }
      }
    });

    it("has no ICU plural or select: the screens show weights, never a count", () => {
      for (const locale of locales) {
        for (const path of rawKeys) expect(leaf(catalogs[locale], path) as string, `${locale}: ${path}`).not.toMatch(/,\s*(?:plural|select|selectordinal)\s*,/);
      }
    });

    it.each(locales)("keeps %s free of exclamation marks and of the judging words", (locale) => {
      const text = JSON.stringify([weight(locale), catalogs[locale].me]).toLowerCase();
      for (const word of FORBIDDEN[locale]) expect(text, `${locale}: ${word}`).not.toContain(word.toLowerCase());
    });

    it("has no final period in a title", () => {
      for (const locale of locales) {
        for (const path of rawKeys.filter((key) => key.endsWith(".title"))) {
          expect((leaf(catalogs[locale], path) as string).trim(), `${locale}: ${path}`).not.toMatch(/[.。]$/);
        }
      }
    });

    it("spells the unit with the ASCII quote, as the whole app does, and never with the gershayim", () => {
      expect(JSON.stringify(weight("he"))).not.toContain("״");
      expect(JSON.stringify(catalogs.he.me)).not.toContain("״");
      expect(leaf(catalogs.he, "weight.form.unit")).toBe('ק"ג');
      expect(leaf(catalogs.en, "weight.form.unit")).toBe("kg");
    });

    it("never judges a number: no word for good, bad, high, low, too much or too little about the weight", () => {
      const judging = { he: ["יותר מדי", "מעט מדי", "גבוה מדי", "נמוך מדי", "בריא", "השמנה"], en: ["too much", "too little", "too high", "too low", "healthy", "obese", "bad", "good"] } as const;
      for (const locale of locales) {
        const text = JSON.stringify(weight(locale)).toLowerCase();
        for (const word of judging[locale]) expect(text, `${locale}: ${word}`).not.toContain(word);
      }
    });

    it("asks the double-check as a question about the number, without printing either number", () => {
      for (const locale of locales) {
        const body = leaf(weight(locale), "check.body") as string;
        expect(body).toMatch(/\?$/);
        expect(placeholders(body)).toEqual([]);
      }
    });

    it("says the one honest fact of the delete plainly and promises nothing it cannot keep", () => {
      expect(leaf(weight("en"), "confirm.body")).toContain("can't be undone");
      for (const locale of locales) {
        const text = JSON.stringify(weight(locale)).toLowerCase();
        for (const word of ["permanent", "completely", "forever", "warning", "careful", "לצמיתות", "לחלוטין", "זהירות", "אזהרה"]) {
          expect(text, `${locale}: ${word}`).not.toContain(word);
        }
      }
    });

    it("tells the person once a week is enough, and never asks for a daily weigh-in", () => {
      expect(leaf(weight("en"), "entry.lead")).toContain("Once a week is enough");
      expect(leaf(weight("en"), "entry.lead")).toContain("no need to weigh yourself every day");
      for (const locale of locales) {
        const text = JSON.stringify(weight(locale)).toLowerCase();
        for (const word of ["daily", "יומי", "remind", "תזכורת"]) expect(text, `${locale}: ${word}`).not.toContain(word);
      }
    });
  });

  it("has the two lines the Me page adds", () => {
    for (const locale of locales) {
      expect(leaf(catalogs[locale], "me.weightsLink"), locale).toBeTruthy();
      expect(leaf(catalogs[locale], "me.weightsHint"), locale).toBeTruthy();
    }
  });
});
