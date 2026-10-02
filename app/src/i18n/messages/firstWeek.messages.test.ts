// The First Week copy: the `firstWeek` namespace, the four new Home cards, the shared "Not now", and the dev clock
// line. Both catalogs agree, every key the screens read exists, every message formats, and the voice rules hold
// (calm, nothing that counts, no verdicts). The word lists of the AI validator are the SAME lists this test uses
// (src/domain/experiments/wording/lint.ts), so the catalog and the validator cannot drift apart. The catalog-wide
// forbidden words are in interventions/library.test.ts and the Home namespace list is in app.messages.test.ts.
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { FIRST_WEEK_MESSAGE_KEYS } from "@/components/firstWeek/messageKeys";
import { COPY_LINT_WORDS, copyLintHits } from "@/domain/experiments/wording";
import { FIRST_WEEK_LIMITS } from "@/domain/firstWeekFlow";
import { GOAL_FOCUS_KEYS } from "@/domain/onboarding/model";
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

const namespace = (locale: (typeof locales)[number]) => catalogs[locale].firstWeek as Tree;
const firstWeekLeaves = leafPaths(catalogs.he.firstWeek as Tree);

/** The keys this item owns, from the catalog root: its whole namespace and its keys inside the shared ones. */
const OWNED_HOME_KEYS = [
  "firstWeekSummaryReady",
  "firstWeekSummaryReadyLittle",
  "firstWeekWelcomeBack",
  "firstWeekSnooze",
  "earlySignalLateEvening",
];
const ownedKeys = [
  ...firstWeekLeaves.map((path) => `firstWeek.${path}`),
  ...leafPaths(catalogs.he.home as Tree)
    .filter((path) => OWNED_HOME_KEYS.includes(path.split(".")[0]))
    .map((path) => `home.${path}`),
  "dev.clockOverride",
];

/** The names a message takes: `{time}`. */
const placeholders = (message: string) => Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g), (match) => match[1]).sort();

// The forbidden words of the brief (13.3), on top of the shared lint list.
const FORBIDDEN = {
  he: ["!", "החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "נכשל", "מתחילים מחדש", "להתחיל מחדש", "לא דיווחת", "סיימת בהצלחה", "מתוך"],
  en: ["!", "missed", "score", "percent", "streak", "failed", "overdue", "behind", "start over", "you didn't", "completed successfully", "of 15", "remaining"],
} as const;

describe("the First Week messages", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(namespace("en")).sort()).toEqual(leafPaths(namespace("he")).sort());
  });

  it("has no empty text in any key this item owns", () => {
    for (const locale of locales) {
      for (const path of ownedKeys) expect(leaf(catalogs[locale], path)?.trim(), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has every key of the contract in both languages (including the reused ones)", () => {
    expect(FIRST_WEEK_MESSAGE_KEYS.length).toBeGreaterThan(60);
    for (const locale of locales) {
      for (const path of FIRST_WEEK_MESSAGE_KEYS) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("lists every key of its namespace and of its Home cards, so nothing is written that nothing reads", () => {
    const listed = new Set(FIRST_WEEK_MESSAGE_KEYS);
    expect(ownedKeys.filter((path) => !listed.has(path))).toEqual([]);
  });

  it("expands the rotating Saved lines to exactly as many keys as the rotation has", () => {
    const rotating = FIRST_WEEK_MESSAGE_KEYS.filter((path) => path.startsWith("firstWeek.ack.rotating."));
    expect(rotating).toHaveLength(FIRST_WEEK_LIMITS.acknowledgementRotation);
    for (const locale of locales) {
      expect(Object.keys((namespace(locale).ack as Tree).rotating as Tree).sort(), locale).toEqual(
        Array.from({ length: FIRST_WEEK_LIMITS.acknowledgementRotation }, (_unused, index) => String(index)),
      );
    }
  });

  it("uses the same placeholders in both languages, and only the dev line has one", () => {
    for (const path of ownedKeys) {
      const hebrew = leaf(catalogs.he, path) as string;
      const english = leaf(catalogs.en, path) as string;
      expect(placeholders(hebrew), path).toEqual(placeholders(english));
      expect(placeholders(hebrew), path).toEqual(path === "dev.clockOverride" ? ["time"] : []);
    }
  });

  it("formats every message without an error", () => {
    for (const locale of locales) {
      const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, timeZone: "UTC" });
      for (const path of ownedKeys) {
        const text = t(path as never, { time: "10:00" } as never);
        expect(text, `${locale}: ${path}`).toBeTruthy();
        expect(text, `${locale}: ${path}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("has no plural message and no digit in any fixed string (nothing on these screens counts)", () => {
    for (const locale of locales) {
      for (const path of ownedKeys) {
        const message = (leaf(catalogs[locale], path) as string).replace(/\{time\}/g, "");
        expect(message, `${locale}: ${path}`).not.toMatch(/\bplural\b|\bselect\b/);
        expect(message, `${locale}: ${path}`).not.toMatch(/\d/);
      }
    }
  });

  describe("copy lint", () => {
    // Keys count too, so the text under test is the whole namespace (or card) as JSON.
    const texts = (locale: (typeof locales)[number]) => [
      ["the firstWeek namespace", JSON.stringify(catalogs[locale].firstWeek)],
      ...OWNED_HOME_KEYS.map((key) => [`home.${key}`, JSON.stringify((catalogs[locale].home as Tree)[key])] as const),
      ["dev.clockOverride", JSON.stringify((catalogs[locale].dev as Tree).clockOverride)],
    ];

    it.each(locales)("%s: passes the brief's list and the shared lint list", (locale) => {
      for (const [name, text] of texts(locale)) {
        const lower = text.toLowerCase();
        for (const word of FORBIDDEN[locale]) expect(lower, `${locale}: ${name} contains "${word}"`).not.toContain(word.toLowerCase());
        expect(copyLintHits(text, locale), `${locale}: ${name}`).toEqual([]);
      }
    });

    it("reads the lint lists from the AI validator's own module, so they cannot drift", () => {
      expect(COPY_LINT_WORDS.he.length).toBeGreaterThan(10);
      for (const word of FORBIDDEN.he.filter((w) => w !== "!")) expect(COPY_LINT_WORDS.he, word).toContain(word);
      for (const word of FORBIDDEN.en.filter((w) => w !== "!")) expect(COPY_LINT_WORDS.en, word).toContain(word);
    });

    it("ends no title with a period, like every other title", () => {
      for (const locale of locales) {
        for (const path of ownedKeys.filter((key) => /\.title(\.|$)/.test(key) || key.endsWith(".title.enough") || key.endsWith(".title.neutral"))) {
          expect((leaf(catalogs[locale], path) as string).trim().endsWith("."), `${locale}: ${path}`).toBe(false);
        }
      }
    });

    it("has no key named like a failure or a score", () => {
      for (const path of ownedKeys) expect(path.toLowerCase(), path).not.toMatch(/fail|score|miss|streak|percent/);
    });
  });
});

describe("Why we started", () => {
  const LINES = ["title", "goalsLead", "notSure", "goalSet", "motivationLead", "link", "linkNotSure"] as const;
  const FOCUS_KEYS = GOAL_FOCUS_KEYS.filter((key) => key !== "not_sure");
  const whyOf = (locale: (typeof locales)[number]) => (namespace(locale).summary as Tree).why as Tree;
  const texts = (locale: (typeof locales)[number]) => [
    ...LINES.map((key) => [key, whyOf(locale)[key] as string] as const),
    ...FOCUS_KEYS.map((key) => [`focus.${key}`, (whyOf(locale).focus as Tree)[key] as string] as const),
  ];

  it("has exactly its lines and one phrase per goal in both catalogs, and they pass the same lint (no digit, no exclamation mark)", () => {
    for (const locale of locales) {
      const why = whyOf(locale);
      expect(Object.keys(why).sort(), locale).toEqual([...LINES, "focus"].sort());
      expect(Object.keys(why.focus as Tree).sort(), locale).toEqual([...FOCUS_KEYS].sort());
      for (const [key, text] of texts(locale)) {
        expect(text.trim(), `${locale}: ${key}`).toBeTruthy();
        expect(text, `${locale}: ${key}`).not.toMatch(/\d|!/);
        expect(copyLintHits(text, locale), `${locale}: ${key}`).toEqual([]);
      }
    }
  });

  it("maps every goal the person can choose (except 'not sure', which has its own line) to a phrase, and lists them all as keys of the contract", () => {
    expect(FOCUS_KEYS).toHaveLength(5);
    const listed = FIRST_WEEK_MESSAGE_KEYS.filter((path) => path.startsWith("firstWeek.summary.why.focus."));
    expect(listed).toEqual(FOCUS_KEYS.map((key) => `firstWeek.summary.why.focus.${key}`));
    // Nothing of the onboarding wording is read by this screen any more.
    expect(FIRST_WEEK_MESSAGE_KEYS.filter((path) => path.startsWith("onboarding.goals.options."))).toEqual([]);
  });

  it("describes the change gently: no weight number or unit, no 'eat too much', no promise, no 'you should'", () => {
    const FORBIDDEN_HERE = {
      he: ["ק\"ג", "קילו", "לרדת", "יותר מדי", "תצליח", "תצליחי", "תשיג", "חייב", "צריך", "כדאי ש", "מובטח", "בטוח ש"],
      en: ["kg", "kilo", "pound", "lose weight", "too much", "you will", "you'll", "should", "must", "guarantee", "promise", "need to"],
    } as const;
    for (const locale of locales) {
      for (const [key, text] of texts(locale)) {
        const lower = text.toLowerCase();
        for (const word of FORBIDDEN_HERE[locale]) expect(lower, `${locale}: ${key} contains "${word}"`).not.toContain(word.toLowerCase());
      }
    }
  });

  it("is gender-neutral in Hebrew: no second-person present or future verb forms that differ by gender", () => {
    // The lines use the past tense (the same for everyone), infinitives, and nouns. These are the forms that would give it away.
    const GENDERED = ["תרצה", "תרצי", "אתה", "מוכן", "מוכנה", "בטוחה", "בטוח "];
    for (const [key, text] of texts("he")) {
      for (const form of GENDERED) expect(`${text} `, `he: ${key} contains "${form}"`).not.toContain(form);
    }
  });

  it("links the goal to what is learned without a number and without a promise of a result", () => {
    expect(leaf(catalogs.he, "firstWeek.summary.why.link")).toBe("מה שנלמד כאן על האכילה שלך הוא הבסיס לשינוי הזה, צעד קטן בכל פעם.");
    expect(leaf(catalogs.en, "firstWeek.summary.why.link")).toBe(
      "What we learn here about your eating is the base for that change, one small step at a time.",
    );
  });

  it("has a different linking sentence for 'not sure', one that does not point at a change", () => {
    for (const locale of locales) {
      const why = whyOf(locale);
      expect(why.linkNotSure, locale).not.toBe(why.link);
      expect((why.linkNotSure as string).toLowerCase(), locale).not.toMatch(/change|שינוי/);
    }
  });

  it("opens the person's own words with a lead that works with or without a line before it", () => {
    expect(leaf(catalogs.he, "firstWeek.summary.why.motivationLead")).toBe("במילים שלך:");
    expect(leaf(catalogs.en, "firstWeek.summary.why.motivationLead")).toBe("In your own words:");
  });
});

describe("Phase 2: the Early Signal, the noticed line and the experiment", () => {
  const PHASE_2 = [
    "home.earlySignalLateEvening.title",
    "home.earlySignalLateEvening.body",
    "home.earlySignalLateEvening.confirm",
    "home.earlySignalLateEvening.unsure",
    "home.earlySignalLateEvening.reject",
    "firstWeek.summary.noticed.lateEvening",
    "firstWeek.summary.did.experiment",
    ...["offer", "choose", "pending", "see", "active"].map((key) => `firstWeek.summary.next.${key}`),
    "firstWeek.experiment.meta.title",
    ...["title", "lead", "try", "notThisTime", "note", "activeTitle", "activeBody", "back"].map((key) => `firstWeek.experiment.${key}`),
    "dev.clockOverride",
  ];

  it("has every key in both catalogs", () => {
    for (const locale of locales) {
      for (const path of PHASE_2) expect(leaf(catalogs[locale], path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("has no digit, no exclamation mark and no plural (the dev line's {time} excepted)", () => {
    for (const locale of locales) {
      for (const path of PHASE_2) {
        const text = (leaf(catalogs[locale], path) as string).replace(/\{time\}/g, "");
        expect(text, `${locale}: ${path}`).not.toMatch(/\d|!|\bplural\b/);
      }
    }
  });

  it("keeps jargon and verdicts off the screen: no pattern, signal or evidence, and the hour is described, never judged", () => {
    const screens = PHASE_2.filter((path) => path !== "dev.clockOverride");
    const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
    for (const locale of locales) {
      for (const path of screens) {
        const text = leaf(catalogs[locale], path) as string;
        const words = wordsOf(text);
        for (const jargon of ["דפוס", "דפוסים", "אות", "pattern", "patterns", "signal", "evidence"]) expect(words, `${locale}: ${path}`).not.toContain(jargon);
        expect(text.toLowerCase(), `${locale}: ${path}`).not.toMatch(/too late|too much|too many|again and again|מאוחר מדי|שוב ושוב/);
      }
    }
    // "Late" as a description of the clock appears in exactly the three sentences that name the evening.
    const NAMES_THE_EVENING = new Set([
      "home.earlySignalLateEvening.body",
      "firstWeek.summary.noticed.lateEvening",
      "firstWeek.experiment.lead",
    ]);
    for (const path of screens) {
      expect(/\blate\b/i.test(leaf(catalogs.en, path) as string), `en: ${path}`).toBe(NAMES_THE_EVENING.has(path));
      expect((leaf(catalogs.he, path) as string).includes("מאוחר"), `he: ${path}`).toBe(NAMES_THE_EVENING.has(path));
    }
  });

  it("names the evening in Hebrew with the grammatical phrase, in exactly the three places", () => {
    for (const path of ["home.earlySignalLateEvening.body", "firstWeek.summary.noticed.lateEvening", "firstWeek.experiment.lead"]) {
      const text = leaf(catalogs.he, path) as string;
      expect(text, path).toContain("ארוחה בשעות הערב המאוחרות");
      expect(text, path).not.toContain("ארוחה מאוחר");
    }
  });

  it("says the Early Signal in the spec's own words", () => {
    expect(leaf(catalogs.he, "home.earlySignalLateEvening.title")).toBe("משהו קטן ששמתי לב אליו");
    expect(leaf(catalogs.en, "home.earlySignalLateEvening.title")).toBe("Something small I noticed");
    expect(["confirm", "unsure", "reject"].map((key) => leaf(catalogs.he, `home.earlySignalLateEvening.${key}`))).toEqual([
      "נשמע לי נכון",
      "לא בטוח",
      "לא קשור אליי",
    ]);
    expect(["confirm", "unsure", "reject"].map((key) => leaf(catalogs.en, `home.earlySignalLateEvening.${key}`))).toEqual([
      "Sounds right",
      "Not sure",
      "Not related to me",
    ]);
  });

  it("has three different, non-empty answers", () => {
    for (const locale of locales) {
      const answers = ["confirm", "unsure", "reject"].map((key) => leaf(catalogs[locale], `home.earlySignalLateEvening.${key}`) as string);
      expect(new Set(answers).size, locale).toBe(3);
      for (const answer of answers) expect(answer.trim(), locale).toBeTruthy();
    }
  });

  it("does not put the experiment sentence in the screens' copy: it comes from the library", () => {
    for (const locale of locales) {
      const library = (catalogs[locale].interventions as Tree).eat_intentionally as Tree;
      const sentence = library.default as string;
      expect(JSON.stringify(catalogs[locale].firstWeek), locale).not.toContain(sentence);
    }
  });
});
