// The Weekly Learning copy: the `weekly` namespace and the three Home keys ("your week" card, its Not now, the quiet link).
// Both catalogs agree, every key the screens read exists, every message formats, and the voice rules hold: calm, nothing that
// counts, no verdicts, no weight figure, no comparison, and the coach never quotes the person's own goal back. The word list of
// the First Week's AI validator is the SAME list this test applies to catalog text (src/domain/experiments/wording/lint.ts), so
// the catalog and the validator cannot drift apart. The Home namespace list is also in app.messages.test.ts.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { WEEKLY_MESSAGE_KEYS } from "@/components/weekly/messageKeys";
import { copyLintHits } from "@/domain/experiments/wording";
import { AI_WORDING } from "@/domain/experiments/wording/constants";
import { validateWording } from "@/domain/experiments/wording/validate";
import en from "./en.json";
import he from "./he.json";

type Tree = { [key: string]: string | Tree };

const catalogs = { he: he as Tree, en: en as Tree };
const locales = ["he", "en"] as const;
type Locale = (typeof locales)[number];

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

const text = (locale: Locale, path: string): string => leaf(catalogs[locale], path) as string;

const weeklyPaths = leafPaths(catalogs.he.weekly as Tree).map((path) => `weekly.${path}`);
const HOME_KEYS = ["home.weeklyReady.title", "home.weeklyReady.body", "home.weeklyReady.cta", "home.weeklySnooze", "home.weeklyLink"];
/** Every string this item owns, from the catalog root. */
const owned = [...weeklyPaths, ...HOME_KEYS];

const placeholders = (message: string) => Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();

// The forbidden WORDS of 10.2, applied to what the person reads (the values), never to a key's name.
const FORBIDDEN = {
  he: ["!", "דפוס", "ציון", "אחוז", "יעד", 'ק"ג', "נכשל", "החמצת", "פספסת", "רצף", "מתחילים מחדש", "להתחיל מחדש", "איפוס"],
  en: ["!", "pattern", "signal", "evidence", "score", "streak", "target", "kg", "missed", "failed", "behind", "reset", "restart", "start over"],
} as const;
const COMPARISON = {
  he: ["לעומת", "מהשבוע שעבר", "יותר מאשר"],
  en: ["compared with", "compared to", "than last week", "versus"],
} as const;

describe("the weekly messages", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(catalogs.en.weekly as Tree).sort()).toEqual(leafPaths(catalogs.he.weekly as Tree).sort());
  });

  it("has every key of the contract in both languages (including the Home keys and the reused one)", () => {
    expect(WEEKLY_MESSAGE_KEYS.length).toBeGreaterThan(60);
    for (const locale of locales) {
      for (const path of WEEKLY_MESSAGE_KEYS) expect(leaf(catalogs[locale], path)?.trim(), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("holds nothing in the weekly namespace that the contract does not list, so nothing is written that nothing reads", () => {
    const listed = new Set(WEEKLY_MESSAGE_KEYS);
    expect(weeklyPaths.filter((path) => !listed.has(path))).toEqual([]);
  });

  it("lists the contract without repeats", () => {
    expect(new Set(WEEKLY_MESSAGE_KEYS).size).toBe(WEEKLY_MESSAGE_KEYS.length);
  });

  it("uses the same placeholders in both languages, and only the range has any: {start} and {end}", () => {
    for (const path of owned) {
      const hebrew = text("he", path);
      const english = text("en", path);
      expect(placeholders(hebrew), path).toEqual(placeholders(english));
      expect(placeholders(hebrew), path).toEqual(path === "weekly.range" ? ["end", "start"] : []);
    }
  });

  it("formats every message without an error, with no placeholder left over", () => {
    for (const locale of locales) {
      const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, timeZone: "UTC" });
      for (const path of owned) {
        const formatted = t(path as never, { start: "20 September", end: "26 September" } as never);
        expect(formatted, `${locale}: ${path}`).toBeTruthy();
        expect(formatted, `${locale}: ${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("has no digit, no plural and no select in any fixed string: the range's digits come from its placeholders", () => {
    for (const locale of locales) {
      for (const path of owned) {
        const message = text(locale, path).replace(/\{(start|end)\}/g, "");
        expect(message, `${locale}: ${path}`).not.toMatch(/\d/);
        expect(message, `${locale}: ${path}`).not.toMatch(/\bplural\b|\bselect\b|\{[^}]*,/);
      }
    }
  });

  it("has the range as two dates and the word between them, nothing else", () => {
    expect(text("he", "weekly.range")).toBe("{start} עד {end}");
    expect(text("en", "weekly.range")).toBe("{start} to {end}");
  });

  describe("voice", () => {
    it.each(locales)("%s: no forbidden word, and nothing the First Week's validator would call a verdict", (locale) => {
      for (const path of owned) {
        const lower = text(locale, path).toLowerCase();
        for (const word of FORBIDDEN[locale]) expect(lower, `${locale}: ${path} contains "${word}"`).not.toContain(word.toLowerCase());
        expect(copyLintHits(text(locale, path), locale), `${locale}: ${path}`).toEqual([]);
      }
    });

    it.each(locales)("%s: no comparison with another week", (locale) => {
      for (const path of owned) {
        const lower = text(locale, path).toLowerCase();
        for (const phrase of COMPARISON[locale]) expect(lower, `${locale}: ${path} contains "${phrase}"`).not.toContain(phrase);
      }
    });

    it("never labels a week by its number", () => {
      for (const locale of locales) {
        for (const path of owned) expect(text(locale, path), `${locale}: ${path}`).not.toMatch(/week\s*\d|שבוע\s*\d|day\s*\d|יום\s*\d/i);
      }
    });

    it("never says Reset anywhere: the quiet week is a lack of information, not a restart", () => {
      for (const locale of locales) {
        for (const path of owned) expect(text(locale, path).toLowerCase(), `${locale}: ${path}`).not.toMatch(/reset|איפוס/);
      }
    });

    it("ends no title with a period, like every other title", () => {
      for (const locale of locales) {
        for (const path of owned.filter((key) => /\.title$/.test(key) || key === "home.weeklyLink" || key === "home.weeklySnooze")) {
          expect(text(locale, path).trim().endsWith("."), `${locale}: ${path}`).toBe(false);
        }
      }
    });

    it("has no key named like a failure or a score", () => {
      for (const path of owned) expect(path.toLowerCase(), path).not.toMatch(/fail(?!ed$)|score|miss|streak|percent/);
    });

    it("never quotes the person's own goal back: no onboarding goal label is inside any weekly or Home weekly sentence", () => {
      for (const locale of locales) {
        const labels = leafPaths((catalogs[locale].onboarding as Tree).goals as Tree).filter((p) => p.startsWith("options."));
        expect(labels.length, locale).toBeGreaterThan(4);
        for (const label of labels) {
          const goal = text(locale, `onboarding.goals.${label}`).toLowerCase();
          for (const path of owned) expect(text(locale, path).toLowerCase(), `${locale}: ${path} quotes "${goal}"`).not.toContain(goal);
        }
      }
    });
  });

  describe("the weight line", () => {
    const WEIGHT = ["first", "building", "down", "steady", "up"].map((key) => `weekly.changed.${key}`);
    const WARNING = {
      he: ["העלית", "השמנת", "חרגת", "אזהרה", "מסוכן", "שים לב", "שימי לב", "לצערי", "למרבה הצער"],
      en: ["gained", "put on", "warning", "careful", "unfortunately", "worry", "danger", "alarming"],
    } as const;
    const COLORS = {
      he: ["אדום", "ירוק", "כתום"],
      en: ["red", "green", "orange", "amber"],
    } as const;

    it.each(locales)("%s: is one plain sentence per kind, with no number, no color word and no warning", (locale) => {
      for (const path of WEIGHT.filter((key) => key !== "weekly.changed.first")) {
        // The weekly average and the trend over the last weeks: the figure belongs to Progress.
        expect(text(locale, path), `${locale}: ${path}`).toMatch(locale === "he" ? /ממוצע|שקילות/ : /average|weigh-ins/i);
      }
      for (const path of WEIGHT) {
        const lower = text(locale, path).toLowerCase();
        expect(lower, `${locale}: ${path}`).not.toMatch(/\d|!/);
        for (const word of [...WARNING[locale], ...COLORS[locale]]) expect(lower, `${locale}: ${path} contains "${word}"`).not.toContain(word);
      }
    });

    it.each(locales)("%s: down and up share their second sentence verbatim and differ only in the direction word", (locale) => {
      const direction = locale === "he" ? { down: "יורד", up: "נוטה למעלה" } : { down: "going down", up: "leaning up" };
      const down = text(locale, "weekly.changed.down");
      const up = text(locale, "weekly.changed.up");
      const [downFirst, ...downRest] = down.split(". ");
      const [upFirst, ...upRest] = up.split(". ");
      // An increase carries nothing a decrease lacks, and neither carries more than the other.
      expect(downRest.join(". ")).toBe(upRest.join(". "));
      expect(downRest.length).toBeGreaterThan(0);
      expect(downFirst.replace(direction.down, "§")).toBe(upFirst.replace(direction.up, "§"));
      expect(downFirst).toContain(direction.down);
      expect(upFirst).toContain(direction.up);
    });

    it.each(locales)("%s: has the same sentence length, within a few characters, for an increase and a decrease", (locale) => {
      const gap = Math.abs(text(locale, "weekly.changed.down").length - text(locale, "weekly.changed.up").length);
      expect(gap).toBeLessThanOrEqual(12);
    });
  });

  describe("the opening lines", () => {
    const LINES = ["celebrateMilestone", "celebrateGoal", "celebrateExperiment", "recover", "learn", "quiet"];

    it("has exactly the six keys of the six opening lines", () => {
      for (const locale of locales) expect(Object.keys((catalogs[locale].weekly as Tree).line as Tree).sort(), locale).toEqual([...LINES].sort());
    });

    it("keeps every opening sentence under the caps the AI path works with, and free of digits", () => {
      for (const locale of locales) {
        for (const key of LINES) {
          const line = text(locale, `weekly.line.${key}`);
          expect(line.length, `${locale}: ${key}`).toBeLessThanOrEqual(AI_WORDING.maxChars[locale]);
          expect(line, `${locale}: ${key}`).not.toMatch(/\d/);
        }
      }
    });

    it("keeps the one sentence the AI may reword free of digits, units and foods, so a reworded sentence can be checked against it", () => {
      for (const locale of locales) {
        const approved = text(locale, "weekly.line.learn");
        // The orchestrator validates the candidate against exactly this sentence: it must at least accept itself with a mild
        // change of tone (the fake provider's default answer), or every candidate would be rejected.
        const candidate = locale === "he" ? `${approved.replace(/\.$/, "")}, אם בא לך.` : `${approved.replace(/\.$/, "")}, if you like.`;
        expect(validateWording({ candidate, approved, locale }), locale).toMatchObject({ ok: true });
      }
    });

    it("says a milestone and the goal in different words, and a milestone only once on the whole screen", () => {
      for (const locale of locales) {
        expect(text(locale, "weekly.line.celebrateMilestone"), locale).not.toBe(text(locale, "weekly.line.celebrateGoal"));
        const milestoneWord = locale === "he" ? "אבן דרך" : "milestone";
        const mentions = weeklyPaths.filter((path) => text(locale, path).toLowerCase().includes(milestoneWord));
        expect(mentions, locale).toEqual(["weekly.line.celebrateMilestone"]);
      }
    });

    it("keeps the recovery line and the quiet-week line as written, in neutral Hebrew", () => {
      expect(text("he", "weekly.line.recover")).toBe("חזרת, וזה בדיוק מה שחשוב. ממשיכים מכאן.");
      expect(text("he", "weekly.line.quiet")).toBe("השבוע היה שקט, ויש לי פחות מידע. זה בסדר גמור, ואפשר להמשיך מכאן בלי למהר.");
      expect(text("en", "weekly.line.recover")).toBe("You came back, and that is exactly what matters. We continue from here.");
    });
  });

  describe("the offers and the decisions", () => {
    const OFFERS = ["pattern", "goalEating", "goalFeeling", "keepGoing", "nextStep", "default"];

    it("has one fixed sentence per rationale, each ending in the freedom to say no", () => {
      for (const locale of locales) {
        for (const key of OFFERS) {
          const sentence = text(locale, `weekly.next.offer.${key}`);
          expect(sentence, `${locale}: ${key}`).toMatch(locale === "he" ? /אפשר גם לא\.$/ : /Or not\.$/);
        }
      }
    });

    it("says nothing about weight, losing or eating too much in any offer", () => {
      const FORBIDDEN_HERE = { he: ["משקל", "לרדת", "יותר מדי", "קילו"], en: ["weight", "lose", "too much", "kilo", "pound"] } as const;
      for (const locale of locales) {
        for (const key of OFFERS) {
          const lower = text(locale, `weekly.next.offer.${key}`).toLowerCase();
          for (const word of FORBIDDEN_HERE[locale]) expect(lower, `${locale}: ${key} contains "${word}"`).not.toContain(word);
        }
      }
    });

    it("has five different result answers and three different pattern answers, none of them a verdict", () => {
      for (const locale of locales) {
        const results = ["helpful", "somewhat", "notReally", "unknown", "notTried"].map((key) => text(locale, `weekly.result.${key}`));
        const patterns = ["confirm", "unsure", "reject"].map((key) => text(locale, `weekly.learned.${key}`));
        expect(new Set(results).size, locale).toBe(5);
        expect(new Set(patterns).size, locale).toBe(3);
        for (const answer of [...results, ...patterns]) expect(answer.trim(), locale).not.toBe("");
      }
    });

    it("never calls not trying a failure: the answer and its reply both say it is fine", () => {
      expect(text("he", "weekly.learned.notTried")).toContain("בסדר");
      expect(text("en", "weekly.learned.notTried")).toContain("fine");
    });
  });

  describe("the Home keys", () => {
    it("has the card's words, a Not now and the quiet link's label, all short and without a final period", () => {
      for (const locale of locales) {
        expect(text(locale, "home.weeklyReady.title"), locale).toBe(text(locale, "weekly.title"));
        expect(text(locale, "home.weeklyLink"), locale).toBe(text(locale, "weekly.title"));
        for (const path of ["home.weeklyReady.cta", "home.weeklySnooze", "home.weeklyLink"]) {
          expect(text(locale, path).length, `${locale}: ${path}`).toBeLessThanOrEqual(24);
        }
        expect(text(locale, "home.weeklyReady.body").length, locale).toBeLessThanOrEqual(120);
      }
    });

    it("keeps the quiet link a flat string and the card a group of three, as the copy contract says", () => {
      for (const locale of locales) {
        const home = catalogs[locale].home as Tree;
        expect(typeof home.weeklyLink, locale).toBe("string");
        expect(typeof home.weeklySnooze, locale).toBe("string");
        expect(Object.keys(home.weeklyReady as Tree).sort(), locale).toEqual(["body", "cta", "title"]);
      }
    });
  });
});
