// The words of a push notification: `notifications.weeklySummary.{title,body}`. They appear on the LOCK SCREEN, so the rules are stricter
// than for a card: no digit (no count, no weight, no date), no placeholder (nothing personal can be filled in), no food, no verdict,
// no request, no pressure. The copy-lint word list (the same one the AI validator and the whole-catalog test use) is applied to the
// namespace here as well, and the digit rule is a test of its own because that list is word based and does not look at digits.
import { describe, expect, it } from "vitest";
import { copyLintHits } from "@/domain/experiments/wording";
import en from "./en.json";
import he from "./he.json";

type Tree = { [key: string]: string | Tree };

const catalogs = { he: he as Tree, en: en as Tree };
const locales = ["he", "en"] as const;

function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}

const namespace = (locale: (typeof locales)[number]) => catalogs[locale].notifications as Tree;
const entries = (locale: (typeof locales)[number]) => leaves(namespace(locale), "notifications.");

describe("the notifications namespace", () => {
  it("has the same keys in both languages: a weekly summary title and body, and nothing else yet", () => {
    for (const locale of locales) expect(entries(locale).map(([path]) => path).sort(), locale).toEqual(["notifications.weeklySummary.body", "notifications.weeklySummary.title"]);
  });

  it("says the approved words (the owner, 2026-10-07), the same as the Home card", () => {
    expect((namespace("he").weeklySummary as Tree).title).toBe("השבוע שלך");
    expect((namespace("he").weeklySummary as Tree).body).toBe("יש לי כמה מילים על השבוע שעבר. כשנוח, אפשר להסתכל.");
    expect((namespace("en").weeklySummary as Tree).title).toBe("Your week");
    expect((namespace("en").weeklySummary as Tree).body).toBe("I have a few words about last week. When it suits you, take a look.");
    // Same words as the card, in separate keys so either can change on its own.
    for (const locale of locales) {
      const card = (catalogs[locale].home as Tree).weeklyReady as Tree;
      expect((namespace(locale).weeklySummary as Tree).title, locale).toBe(card.title);
      expect((namespace(locale).weeklySummary as Tree).body, locale).toBe(card.body);
    }
  });

  it("has no digit anywhere, in either language (a lock screen shows no count, weight or date)", () => {
    for (const locale of locales) for (const [path, text] of entries(locale)) expect(text, `${locale}: ${path}`).not.toMatch(/\d/);
  });

  it("has no placeholder, markup or exclamation mark: nothing personal can be filled in", () => {
    for (const locale of locales) for (const [path, text] of entries(locale)) expect(text, `${locale}: ${path}`).not.toMatch(/[{}<>!]/);
  });

  it("passes the shared copy-lint word list, keys included", () => {
    for (const locale of locales) {
      const whole = JSON.stringify(namespace(locale));
      expect(copyLintHits(whole, locale), locale).toEqual([]);
    }
  });

  it("says nothing about food, weight, a goal, a streak or a request", () => {
    const FORBIDDEN = {
      he: ["אוכל", "ארוחה", "משקל", "קילו", "יעד", "רצף", "חייב", "צריך", "דווח", "תדווח", "מהר", "עכשיו"],
      en: ["food", "meal", "weight", "kilo", "goal", "streak", "must", "should", "need to", "report", "hurry", "now"],
    } as const;
    for (const locale of locales) {
      const whole = entries(locale).map(([, text]) => text).join("\n").toLowerCase();
      for (const word of FORBIDDEN[locale]) expect(whole, `${locale}: contains "${word}"`).not.toContain(word.toLowerCase());
    }
  });

  it("is short enough for a lock screen", () => {
    for (const locale of locales) {
      const weekly = namespace(locale).weeklySummary as Tree;
      expect((weekly.title as string).length, `${locale} title`).toBeLessThanOrEqual(40);
      expect((weekly.body as string).length, `${locale} body`).toBeLessThanOrEqual(120);
    }
  });
});
