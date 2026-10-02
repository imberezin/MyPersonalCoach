// The Progress screen's messages and the landmark card's keys on Home: both catalogs agree, every key the screens read
// exists, every message formats, and the wording stays the same weight for a rise and a fall. The forbidden words are
// scanned for the `progress` and `home` namespaces in app.messages.test.ts; the superset below is scanned for the keys of
// this item only.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { PROGRESS_MESSAGE_KEYS } from "@/components/progress/messageKeys";
import en from "./en.json";
import he from "./he.json";

type Tree = { [key: string]: string | Tree };
type Locale = "he" | "en";

const catalogs = { he: he as Tree, en: en as Tree };
const locales: readonly Locale[] = ["he", "en"];

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

/** The names a message takes, such as `{kg}`. */
function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();
}

const text = (locale: Locale, path: string): string => leaf(catalogs[locale], path) ?? "";

// Every key this item owns. The `home.milestone*` keys sit in the shared `home` namespace, so they are picked by name.
const progressPaths = leafPaths(catalogs.he.progress as Tree).map((path) => `progress.${path}`);
const homePaths = leafPaths(catalogs.he.home as Tree)
  .map((path) => `home.${path}`)
  .filter((path) => path.startsWith("home.milestone"));
const ownPaths = [...progressPaths, ...homePaths];

// Rules the item pins (blueprint 8.3): a superset of the lists app.messages.test.ts scans for these namespaces.
const FORBIDDEN: Record<Locale, string[]> = {
  he: [
    "!", "נכשל", "הרסת", "חרגת", "הצלחה", "מצוין", "כישלון", "עודף", "דיאטה", "מתחילים מחדש", "להתחיל מחדש", "פיצוי",
    "ציון", "אחוז", "רצף", "החמצת", "פספסת", "לפי התוכנית", "בדרך הנכונה", "בפיגור",
  ],
  en: [
    "!", "failed", "ruined", "exceeded", "success", "great job", "good job", "overweight", "diet", "start over", "compensat",
    "score", "percent", "streak", "missed", "overdue", "on track", "off track", "behind", "ahead of",
  ],
};

describe("the Progress messages", () => {
  it("finds the keys it checks", () => {
    expect(progressPaths.length).toBeGreaterThan(35);
    expect(homePaths).toHaveLength(6);
  });

  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(catalogs.en.progress as Tree).sort()).toEqual(leafPaths(catalogs.he.progress as Tree).sort());
    const enHome = leafPaths(catalogs.en.home as Tree).filter((path) => path.startsWith("milestone"));
    const heHome = leafPaths(catalogs.he.home as Tree).filter((path) => path.startsWith("milestone"));
    expect(enHome.sort()).toEqual(heHome.sort());
  });

  it("has no empty text", () => {
    for (const locale of locales) {
      for (const path of ownPaths) expect(text(locale, path).trim(), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has every key of the contract in both languages", () => {
    expect(PROGRESS_MESSAGE_KEYS.length).toBeGreaterThan(40);
    for (const locale of locales) {
      for (const path of PROGRESS_MESSAGE_KEYS) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has no progress or landmark key that the contract does not list (so nothing is written that nothing reads)", () => {
    const listed = new Set(PROGRESS_MESSAGE_KEYS);
    expect(ownPaths.filter((path) => !listed.has(path))).toEqual([]);
  });

  it("uses the same placeholders in both languages for every message", () => {
    for (const path of ownPaths) {
      expect(placeholders(text("he", path)), path).toEqual(placeholders(text("en", path)));
    }
  });

  it("keeps the placeholders the screens fill in", () => {
    const expected: Record<string, string[]> = {
      "progress.weight.sinceStart.lower": ["kg"],
      "progress.weight.sinceStart.higher": ["kg"],
      "progress.weight.chart.desc": ["from", "to"],
      "progress.weight.numbers.week": ["date", "kg"],
      "progress.weight.numbers.start": ["kg"],
      "progress.milestones.item.kg": ["kg"],
    };
    for (const [path, names] of Object.entries(expected)) {
      for (const locale of locales) expect(placeholders(text(locale, path)), `${locale}: ${path}`).toEqual(names);
    }
    // And no other message takes one: the screens pass values to these six only.
    for (const path of ownPaths.filter((candidate) => !(candidate in expected))) {
      expect(placeholders(text("he", path)), path).toEqual([]);
    }
  });

  it("formats every message with its values, leaving no placeholder behind", () => {
    const values = { kg: "118.7", from: "119.0", to: "118.4", date: "5 Oct" };
    for (const locale of locales) {
      const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, timeZone: "UTC" });
      for (const path of ownPaths) {
        const out = t(path as never, values as never) as string;
        expect(out.trim(), `${locale}: ${path}`).not.toBe("");
        expect(out, `${locale}: ${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  describe("the voice", () => {
    it.each(locales)("%s: no digit outside a placeholder, no exclamation mark, no plural", (locale) => {
      for (const path of ownPaths) {
        const message = text(locale, path);
        expect(message.replace(/\{[^}]*\}/g, ""), `${locale}: ${path}`).not.toMatch(/\d/);
        expect(message, `${locale}: ${path}`).not.toContain("!");
        expect(message, `${locale}: ${path}`).not.toMatch(/\{[^}]*,\s*plural/i);
      }
    });

    it.each(locales)("%s: none of the words the Brand voice rules out", (locale) => {
      for (const path of ownPaths) {
        const message = text(locale, path).toLowerCase();
        for (const word of FORBIDDEN[locale]) expect(message, `${locale}: ${path} contains "${word}"`).not.toContain(word.toLowerCase());
      }
    });

    it("does not call a landmark by the Hebrew words for a score point", () => {
      for (const path of ownPaths) expect(text("he", path), path).not.toContain("נקודת ציון");
    });

    it("gives no Home card title a final period", () => {
      for (const locale of locales) {
        for (const path of ["home.milestoneReached.title", "home.milestoneGoalReached.title"]) {
          expect(text(locale, path).trim().endsWith("."), `${locale}: ${path}`).toBe(false);
        }
      }
    });

    it("spells the unit the way the rest of the app does: the ASCII quote, never the gershayim", () => {
      for (const path of ownPaths) expect(text("he", path), path).not.toContain("״");
      expect(text("he", "progress.milestones.item.kg")).toBe('{kg} ק"ג');
    });
  });

  describe("a rise and a fall weigh the same", () => {
    // The part after the first comma is the same sentence for both: an increase carries no explanation a decrease lacks.
    const afterComma = (message: string) => message.slice(message.indexOf(",") + 1);

    it.each(locales)("%s: the up and down sentences share their ending and differ in length by at most a quarter", (locale) => {
      const up = text(locale, "progress.weight.direction.up");
      const down = text(locale, "progress.weight.direction.down");
      expect(afterComma(up)).toBe(afterComma(down));
      expect(Math.abs(up.length - down.length) / Math.max(up.length, down.length)).toBeLessThanOrEqual(0.25);
    });

    it.each(locales)("%s: the since-the-start sentences for lower and higher are built the same way", (locale) => {
      const lower = text(locale, "progress.weight.sinceStart.lower");
      const higher = text(locale, "progress.weight.sinceStart.higher");
      expect(placeholders(lower)).toEqual(placeholders(higher));
      expect(Math.abs(lower.length - higher.length)).toBeLessThanOrEqual(6);
    });
  });

  it("says the Hebrew words of the spec where they carry the tone", () => {
    expect(text("he", "progress.milestones.title")).toBe("אבני דרך");
    expect(text("he", "progress.weight.direction.unknown")).toBe("עוד מוקדם להגיד לאן זה הולך, ואני לא רוצה לנחש.");
    expect(text("he", "home.milestoneAck")).toBe("תודה");
    expect(text("en", "home.milestoneAck")).toBe("Thanks");
  });

  it("keeps the lead of the old placeholder page (a wording change only)", () => {
    for (const locale of locales) {
      expect(text(locale, "progress.title")).toBeTruthy();
      expect(text(locale, "progress.body")).toBeTruthy();
      expect(text(locale, "progress.lead")).toBeTruthy();
    }
  });
});
