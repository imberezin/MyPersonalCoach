import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import {
  ADVICE_MARKERS,
  COPY_LINT_WORDS,
  FOOD_WORDS,
  JUDGMENT_WORDS,
  NEGATIVE_CONTRACTION,
  NEGATORS,
  NUMBER_WORDS,
  QUANTIFIERS,
  UNIT_WORDS,
  copyLintHits,
} from "./lint";

// A snapshot of the inline list of src/domain/interventions/library.test.ts ("never uses shame, compensation or
// calorie language"). That file is not edited by this build; if its list grows, add the words here and in lint.ts.
const LIBRARY_TEST_LIST = {
  he: ["נכשל", "הרסת", "מתחילים מחדש", "להתחיל מחדש", "פיצוי", "קלוריות", "לשרוף"],
  en: ["failed", "ruined", "start over", "compensat", "calorie", "burn"],
};

describe("copy lint words", () => {
  it("are a superset of the catalog-wide list of the library test", () => {
    for (const locale of ["he", "en"] as const) {
      for (const word of LIBRARY_TEST_LIST[locale]) expect(COPY_LINT_WORDS[locale], `${locale}: ${word}`).toContain(word);
    }
  });

  it("carry the words the First Week copy test forbids (Hebrew and English)", () => {
    for (const word of ["החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "לא דיווחת", "סיימת בהצלחה", "מתוך"]) expect(COPY_LINT_WORDS.he).toContain(word);
    for (const word of ["missed", "score", "percent", "streak", "overdue", "behind", "you didn't", "completed successfully", "of 15", "remaining"]) {
      expect(COPY_LINT_WORDS.en).toContain(word);
    }
  });

  it("are lowercase and never empty", () => {
    for (const list of [COPY_LINT_WORDS.he, COPY_LINT_WORDS.en]) {
      for (const word of list) {
        expect(word.trim()).not.toBe("");
        expect(word).toBe(word.toLowerCase());
      }
    }
  });

  it("find a word in the text and are clean on the approved library sentences", () => {
    expect(copyLintHits("You failed. Start over!", "en")).toEqual(["failed", "start over"]);
    expect(copyLintHits("נכשלת, פיצוי", "he")).toEqual(["נכשל", "פיצוי"]);
    expect(copyLintHits("Sit down, put it on a plate.", "en")).toEqual([]);
    for (const [locale, messages] of [["he", he], ["en", en]] as const) {
      for (const [key, variants] of Object.entries(messages.interventions as Record<string, Record<string, string>>)) {
        for (const [variant, text] of Object.entries(variants)) expect(copyLintHits(text, locale), `${locale}: ${key}.${variant}`).toEqual([]);
      }
    }
  });
});

describe("the other lists", () => {
  it("the negator lists are the closed ones of the blueprint plus the forms the review found missing", () => {
    expect(NEGATORS.he.slice(0, 5)).toEqual(["בלי", "אל", "לא", "אין", "ללא"]);
    expect(NEGATORS.en.slice(0, 6)).toEqual(["without", "no", "not", "don't", "never", "avoid"]);
    for (const word of ["שלא", "אינו", "אינה", "אינך", "איני", "איננו", "אינם", "אינן", "בלא", "מבלי", "לבלי"]) expect(NEGATORS.he, word).toContain(word);
    for (const word of ["cannot", "nothing", "none", "nobody", "neither", "nor"]) expect(NEGATORS.en, word).toContain(word);
  });

  it("any English contraction of not is a negator by its ending", () => {
    for (const word of ["can't", "won't", "isn't", "shouldn't", "don't"]) expect(word).toMatch(NEGATIVE_CONTRACTION);
    for (const word of ["pattern", "isn", "nothing", "n't a"]) expect(word).not.toMatch(NEGATIVE_CONTRACTION);
  });

  it("the number words reach 'ninety' and 'תשעים', and the quantity words are listed", () => {
    for (const word of ["thirteen", "fifteen", "nineteen", "sixty", "seventy", "eighty", "ninety"]) expect(NUMBER_WORDS.en, word).toContain(word);
    for (const word of ["ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]) expect(NUMBER_WORDS.he, word).toContain(word);
    for (const word of ["few", "several", "many", "couple"]) expect(QUANTIFIERS.en, word).toContain(word);
    for (const word of ["כמה", "מעט", "הרבה"]) expect(QUANTIFIERS.he, word).toContain(word);
  });

  it("restriction and weight talk is advice, never an experiment's wording", () => {
    for (const word of ["skip", "fast", "diet", "fewer", "weigh", "weight", "lose weight"]) expect(ADVICE_MARKERS.en, word).toContain(word);
    for (const word of ["דלג", "צום", "דיאטה", "שקול", "לרזות", "משקל"]) expect(ADVICE_MARKERS.he, word).toContain(word);
  });

  it("every list has entries in both languages, and no entry has stray spaces or capitals", () => {
    for (const lists of [FOOD_WORDS, ADVICE_MARKERS, NUMBER_WORDS, QUANTIFIERS, JUDGMENT_WORDS, NEGATORS]) {
      expect(lists.he.length).toBeGreaterThan(0);
      expect(lists.en.length).toBeGreaterThan(0);
      for (const word of [...lists.he, ...lists.en]) {
        expect(word).toBe(word.trim());
        expect(word).toBe(word.toLowerCase());
        expect(word).not.toMatch(/ {2}/);
      }
    }
  });

  it("the starter lists carry the words the validator's tests rely on", () => {
    for (const word of ["לחם", "חלב", "שוקולד"]) expect(FOOD_WORDS.he).toContain(word);
    for (const word of ["bread", "chocolate", "snack"]) expect(FOOD_WORDS.en).toContain(word);
    for (const word of ["צריך", "כדאי", "תימנע", "תפסיק", "אסור", "חייב", "פחות"]) expect(ADVICE_MARKERS.he).toContain(word);
    for (const word of ["should", "must", "avoid", "less", "stop", "need to"]) expect(ADVICE_MARKERS.en).toContain(word);
    for (const word of ["שלוש", "חצי"]) expect(NUMBER_WORDS.he).toContain(word);
    for (const word of ["three", "half"]) expect(NUMBER_WORDS.en).toContain(word);
    for (const word of ["מאוחר מדי", "יותר מדי", "לא בריא", "בריא"]) expect(JUDGMENT_WORDS.he).toContain(word);
    for (const word of ["too late", "too much", "bad", "unhealthy"]) expect(JUDGMENT_WORDS.en).toContain(word);
  });

  it("the unit lists name the time units of both languages", () => {
    expect(Object.keys(UNIT_WORDS.he)).toEqual(Object.keys(UNIT_WORDS.en));
    expect(UNIT_WORDS.he.second).toContain("שניות");
    expect(UNIT_WORDS.he.minute).toContain("דקות");
    expect(UNIT_WORDS.en.second).toContain("seconds");
    expect(UNIT_WORDS.en.minute).toContain("minutes");
  });
});
