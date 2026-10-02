import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { INTERVENTIONS, INTERVENTION_KEYS } from "../../interventions/library";
import { AI_WORDING } from "./constants";
import { WORDING_CHECKS, measureWording, validateWording, type WordingCheck } from "./validate";

type Locale = "he" | "en";

const texts = { he: he.interventions, en: en.interventions } as Record<Locale, Record<string, Record<string, string>>>;
const approvedOf = (locale: Locale, key: string, variant: string) => texts[locale][key][variant].replace("{delayMinutes}", "10");

const EAT = { he: approvedOf("he", "eat_intentionally", "default"), en: approvedOf("en", "eat_intentionally", "default") };
const HUNGER = { he: approvedOf("he", "check_hunger", "open"), en: approvedOf("en", "check_hunger", "open") };
const WALK = { he: approvedOf("he", "micro_walk", "default"), en: approvedOf("en", "micro_walk", "default") };
const TIRED = { he: approvedOf("he", "check_hunger", "tired_or_hungry"), en: approvedOf("en", "check_hunger", "tired_or_hungry") };

const withoutStop = (text: string): string => text.replace(/\.$/, "");

function verdict(candidate: string, approved: string, locale: Locale) {
  return validateWording({ candidate, approved, locale });
}

/** The check that rejects `candidate`, or "ok". */
function check(candidate: string, approved: string, locale: Locale): WordingCheck | "ok" {
  const result = verdict(candidate, approved, locale);
  return result.ok ? "ok" : result.check;
}

const eatHe = (candidate: string) => check(candidate, EAT.he, "he");
const eatEn = (candidate: string) => check(candidate, EAT.en, "en");

describe("the approved sentences used below", () => {
  it("are the library's own words (so a catalog edit shows up here)", () => {
    expect(EAT.he).toBe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.");
    expect(EAT.en).toBe("At your next meal, sit down, put it on a plate, and take a few minutes without a screen.");
    expect(HUNGER.he).toContain("10 שניות");
    expect(HUNGER.en).toContain("10 seconds");
    expect(WALK.he).toContain("5 דקות");
    expect(WALK.en).toContain("5-minute");
  });
});

describe("validateWording: passing cases", () => {
  it("accepts a faithful reword in Hebrew and in English, and returns the text", () => {
    const he = "בארוחה הבאה, אפשר לשבת, לשים בצלחת, ולקחת כמה דקות בלי מסך.";
    const en = "At your next meal, you can sit down, put it on a plate, and take a few minutes without a screen.";
    expect(verdict(he, EAT.he, "he")).toEqual({ ok: true, text: he });
    expect(verdict(en, EAT.en, "en")).toEqual({ ok: true, text: en });
  });

  it("accepts the approved sentence itself, for every approved library sentence in both locales", () => {
    for (const locale of ["he", "en"] as const) {
      for (const key of INTERVENTION_KEYS) {
        for (const variant of INTERVENTIONS[key].variants) {
          const approved = approvedOf(locale, key, variant.id);
          expect(check(approved, approved, locale), `${locale}: ${key}.${variant.id}`).toBe("ok");
        }
      }
    }
  });

  it("an allowed word is allowed when the approved text itself uses it (the 10 seconds of check_hunger)", () => {
    expect(check(HUNGER.he, HUNGER.he, "he")).toBe("ok");
    expect(check(HUNGER.en, HUNGER.en, "en")).toBe("ok");
    expect(check("לפני שאתה מתחיל, עצור 10 שניות ושאל: אני רעב, או פשוט עייף?", TIRED.he, "he")).toBe("ok");
    // The advice word "stop" is the library's own here, so it may stay.
    expect(check("Before you begin, stop for 10 seconds and ask: am I hungry, or just tired?", TIRED.en, "en")).toBe("ok");
  });

  it("a candidate that keeps every negator of the approved text and adds none passes", () => {
    expect(eatEn("At your next meal, sit down, use a plate, and spend a few minutes without a screen.")).toBe("ok");
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, תחליט שוב.", WALK.he, "he")).toBe("ok");
  });

  it("reads a Hebrew prefixed negator as the negator itself (ובלי is בלי)", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות ובלי מסך.")).toBe("ok");
  });

  it("normalises the returned text: NFC, collapsed spaces, trimmed", () => {
    const result = verdict("  At your   next meal,\tsit down,  put it on a plate, and take a few   minutes without a screen.  ", EAT.en, "en");
    expect(result).toEqual({ ok: true, text: EAT.en });
    const decomposed = "At your next meal, sit down, put it on a platé, and take a few minutes without a screen.";
    const composed = verdict(decomposed, EAT.en, "en");
    expect(composed).toEqual({ ok: true, text: decomposed.normalize("NFC") });
    expect(decomposed.normalize("NFC")).not.toBe(decomposed);
  });
});

describe("validateWording: one rejection per check, each the FIRST failure", () => {
  it("empty", () => {
    expect(eatHe("")).toBe("empty");
    expect(eatHe("   \t  ")).toBe("empty");
    expect(eatEn("")).toBe("empty");
  });

  it("markup: an exclamation mark, a tag, a link, an asterisk, a second line, an emoji, a bidi override", () => {
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen!")).toBe("markup");
    expect(eatEn("<b>At your next meal</b>, sit down, put it on a plate, and take a few minutes without a screen.")).toBe("markup");
    expect(eatEn("At your next meal, sit down and take a few minutes without a screen, see www.example.com")).toBe("markup");
    expect(eatEn("At your next meal, sit down and take a few minutes without a screen, see https://example.com")).toBe("markup");
    expect(eatEn("At your next meal, sit down, put it on a *plate*, and take a few minutes without a screen.")).toBe("markup");
    expect(eatEn("At your next meal, sit down, put it on a plate.\nTake a few minutes without a screen.")).toBe("markup");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen \u{1F642}")).toBe("markup");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes ‮without a screen.")).toBe("markup");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך!")).toBe("markup");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך. {x}")).toBe("markup");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת,‏וקח כמה דקות בלי מסך.")).toBe("markup");
  });

  it("language: Latin text for he, Hebrew text for en", () => {
    expect(eatHe("At your next meal, sit down, put it on a plate, and take a few minutes without a screen.")).toBe("language");
    expect(eatEn("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.")).toBe("language");
    expect(eatHe("123")).toBe("language");
  });

  it("language: the share of the right script is what counts", () => {
    // 80% Hebrew passes for he; just under does not.
    const eightyPercent = `${"א".repeat(40)} ${"a".repeat(10)}`;
    const under = `${"א".repeat(39)} ${"a".repeat(11)}`;
    expect(check(eightyPercent, EAT.he, "he")).not.toBe("language");
    expect(check(under, EAT.he, "he")).toBe("language");
    const ninetyPercent = `${"a".repeat(90)} ${"א".repeat(10)}`;
    const underEn = `${"a".repeat(89)} ${"א".repeat(11)}`;
    expect(check(ninetyPercent, EAT.en, "en")).not.toBe("language");
    expect(check(underEn, EAT.en, "en")).toBe("language");
  });

  it("length: the cap of the locale is inclusive (140 he, 180 en)", () => {
    // A Hebrew sentence of exactly N characters made of approved words, so only the length can fail.
    const pad = (base: string, length: number) => base + "ו".repeat(length - [...base].length);
    const heBase = "בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך";
    expect(AI_WORDING.maxChars).toEqual({ he: 140, en: 180 });
    expect(eatHe(`${pad(heBase, 140)}.`.slice(0, 140))).not.toBe("length");
    expect(eatHe(pad(heBase, 141))).toBe("length");

    const enBase = "At your next meal, sit down, put it on a plate, and take a few minutes without a screen";
    expect(eatEn(`${pad(enBase, 180)}`.replace(/ו/g, "a"))).not.toBe("length");
    expect(eatEn(`${pad(enBase, 181)}`.replace(/ו/g, "a"))).toBe("length");
  });

  it("digits: a new number, a changed number, a dropped number", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח 5 דקות בלי מסך.")).toBe("digits");
    expect(check("עצור 20 שניות ושאל: אני רעב, או שמשהו אחר קורה עכשיו? רעב, עייפות, לחץ או פשוט חשק?", HUNGER.he, "he")).toBe("digits");
    expect(check("עצור שניות ושאל: אני רעב, או שמשהו אחר קורה עכשיו? רעב, עייפות, לחץ או פשוט חשק?", HUNGER.he, "he")).toBe("digits");
    expect(check("Stop for 20 seconds and ask: am I hungry, or is something else going on? Hunger, tiredness, stress, or just a craving?", HUNGER.en, "en")).toBe("digits");
    expect(check("A walk, even just around the house. When you get back, decide again.", WALK.en, "en")).toBe("digits");
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, תחליט מחדש 5.", WALK.he, "he")).toBe("digits");
  });

  it("digits compares the multiset of runs: the same numbers in another count are rejected", () => {
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, תחליט מחדש.", "5 דקות הליכה ו-5 דקות מנוחה, סביב הבית.", "he")).toBe("digits");
  });

  it("number_words: a number word the approved text does not use", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח שלוש דקות בלי מסך.")).toBe("number_words");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח חצי דקה בלי מסך.")).toBe("number_words");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take three minutes without a screen.")).toBe("number_words");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take half a minute without a screen.")).toBe("number_words");
  });

  it("number_words: allowed when the approved text has it (pause: 'a second'. one)", () => {
    const approved = approvedOf("en", "portion_first", "default");
    expect(approved).toContain("one portion");
    expect(check("Put one portion on your plate and start with it. Then check whether you want more. Both answers are fine.", approved, "en")).toBe("ok");
  });

  it("number_words: a number word the list used to miss, and a changed quantity word, are rejected", () => {
    for (const word of ["fifteen", "sixty", "ninety", "thirteen"]) {
      expect(eatEn(`At your next meal, sit down, put it on a plate, and take ${word} minutes without a screen.`), word).toBe("number_words");
    }
    for (const word of ["חמישים", "ארבעים", "שישים", "תשעים"]) {
      expect(eatHe(`בארוחה הבאה — שב, שים בצלחת, וקח ${word} דקות בלי מסך.`), word).toBe("number_words");
    }
    // "a few minutes" must stay "a few minutes": a smaller, a larger or an unnamed amount is another action.
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a minute without a screen.")).toBe("number_words");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take many minutes without a screen.")).toBe("number_words");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take several minutes without a screen.")).toBe("number_words");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח הרבה דקות בלי מסך.")).toBe("number_words");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח דקות בלי מסך.")).toBe("number_words");
    // The approved sentence's own quantity word stays allowed.
    expect(eatHe("בארוחה הבאה, אפשר לשבת, לשים בצלחת, ולקחת כמה דקות בלי מסך.")).toBe("ok");
  });

  it("units: a new unit, and a dropped unit", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה שעות בלי מסך.")).toBe("units");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few hours without a screen.")).toBe("units");
    expect(check("5 הליכה, אפילו סביב הבית. כשתחזור, תחליט מחדש.", WALK.he, "he")).toBe("units");
    expect(check("לפני שאתה מתחיל, עצור 10 ושאל: אני רעב, או פשוט עייף?", TIRED.he, "he")).toBe("units");
    expect(check("Before you start, stop for 10 and ask: am I hungry, or just tired?", TIRED.en, "en")).toBe("units");
  });

  it("units: singular and plural forms are the same unit", () => {
    expect(check("5 דקה הליכה, אפילו סביב הבית. כשתחזור, תחליט מחדש.", WALK.he, "he")).toBe("ok");
  });

  it("foods: a food or drink the approved text does not name (he and en)", () => {
    expect(eatHe("בארוחה הבאה — שב, שים לחם בצלחת, וקח כמה דקות בלי מסך.")).toBe("foods");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, עם חלב.")).toBe("foods");
    expect(eatHe("בארוחה הבאה — שב, שים שוקולד בצלחת, וקח כמה דקות בלי מסך.")).toBe("foods");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, ובלחם.")).toBe("foods");
    expect(eatEn("At your next meal, sit down, put bread on a plate, and take a few minutes without a screen.")).toBe("foods");
    expect(eatEn("At your next meal, sit down, put chocolate on a plate, and take a few minutes without a screen.")).toBe("foods");
    expect(eatEn("At your next meal, sit down, put a snack on a plate, and take a few minutes without a screen.")).toBe("foods");
    // A food word in the other language is not a way around the list.
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, chocolate.")).toBe("foods");
  });

  it("foods: allowed when the approved text names it", () => {
    const approved = "קח תפוח בצלחת, וטעם אותו לאט.";
    expect(check("קח תפוח בצלחת, וטעם אותו לאט, אם בא לך.", approved, "he")).toBe("ok");
  });

  it("advice: an advice marker the approved text does not use", () => {
    expect(eatHe("בארוחה הבאה — כדאי שתשב, שים בצלחת, וקח כמה דקות בלי מסך.")).toBe("advice");
    expect(eatHe("בארוחה הבאה — צריך לשבת, לשים בצלחת, ולקחת כמה דקות בלי מסך.")).toBe("advice");
    expect(eatHe("בארוחה הבאה — תימנע ממסך, שב, שים בצלחת, וקח כמה דקות.")).toBe("advice");
    expect(eatEn("At your next meal, you should sit down, put it on a plate, and take a few minutes without a screen.")).toBe("advice");
    expect(eatEn("At your next meal, avoid the screen, sit down, put it on a plate, and take a few minutes.")).toBe("advice");
    expect(eatEn("At your next meal, stop, sit down, put it on a plate, and take a few minutes without a screen.")).toBe("advice");
    expect(eatEn("At your next meal, you need to sit down, put it on a plate, and take a few minutes without a screen.")).toBe("advice");
  });

  it("lint: a word of the catalog-wide forbidden lists", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, בלי להיכשל. נכשלת? לא נורא.")).toBe("lint");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, כפיצוי.")).toBe("lint");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, so you start over.")).toBe("lint");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, as compensation.")).toBe("lint");
  });

  it("judgment: verdict words, even ones the approved text does not forbid", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, כי מאוחר מדי.")).toBe("judgment");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, וזה בריא.")).toBe("judgment");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, it is too late.")).toBe("judgment");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, it is unhealthy.")).toBe("judgment");
  });

  it("negation: a dropped negator is rejected by `negation`, NOT by overlap or new_tokens", () => {
    const heDropped = "בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות עם מסך.";
    const enDropped = "At your next meal, sit down, put it on a plate, and take a few minutes with a screen.";
    expect(eatHe(heDropped)).toBe("negation");
    expect(eatEn(enDropped)).toBe("negation");
    // The reason the check exists: the reversed sentence passes the two checks that follow it.
    for (const [candidate, approved] of [[heDropped, EAT.he], [enDropped, EAT.en]] as const) {
      const { overlap, newTokens } = measureWording({ candidate, approved });
      expect(overlap).toBeGreaterThanOrEqual(AI_WORDING.minTokenOverlap);
      expect(newTokens).toBeLessThanOrEqual(AI_WORDING.maxNewTokens);
    }
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות במסך.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות ללא מסך, ובלי רעש.")).toBe("negation");
  });

  it("negation: an added negator is rejected", () => {
    expect(eatEn("Do not sit down, put it on a plate, and take a few minutes without a screen at your next meal.")).toBe("negation");
    expect(eatEn("At your next meal, never sit down, put it on a plate, and take a few minutes without a screen.")).toBe("negation");
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without a screen, no rush.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — לא תשב, שים בצלחת, וקח כמה דקות בלי מסך.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — אל תיקח כמה דקות בלי מסך, שב, שים בצלחת.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, ולא יותר.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, ואין צורך להזדרז.")).toBe("negation");
  });

  it("negation: a negator the approved text does not have is rejected, for approved texts with none", () => {
    expect(check("Walk for 5 minutes, even around the house, never mind the weather. When you get back, decide again.", WALK.en, "en")).toBe("negation");
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, לא תחליט מחדש.", WALK.he, "he")).toBe("negation");
    expect(check("עצור 10 שניות ושאל: אני רעב, או שמשהו אחר קורה עכשיו? לא רעב, עייפות, לחץ או פשוט חשק?", HUNGER.he, "he")).toBe("negation");
  });

  it("negation keeps the object of each negator: a negator moved to another object does not reverse the action", () => {
    for (const candidate of [
      "At your next meal, sit down, put it on a plate, and take a few minutes with a screen, without rushing.",
      "At your next meal, sit down, put it on a plate, and take a few minutes with the TV on, without hurry.",
      "At your next meal, sit down, put it on a plate, and take a few minutes with a screen, without worry.",
      "At your next meal, sit down, put it on a plate, and take a few minutes, without pressure.",
    ]) {
      expect(eatEn(candidate), candidate).toBe("negation");
    }
    for (const candidate of [
      "בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות עם מסך, בלי לחץ.",
      "בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות עם מסך, בלי למהר.",
      "בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות בנחת, בלי לחץ.",
    ]) {
      expect(eatHe(candidate), candidate).toBe("negation");
    }
  });

  it("negation lets the same object be reworded around its negator (a clitic, an article, another order)", () => {
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes without any screen.")).toBe("ok");
    expect(eatHe("בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות בלי המסך.")).toBe("ok");
    expect(eatEn("At your next meal, take a few minutes without a screen, sit down, and put it on a plate.")).toBe("ok");
  });

  it("negation knows the contractions and the Hebrew forms the first lists missed", () => {
    for (const candidate of [
      "At your next meal, you can't sit down, can't put it on a plate, and take a few minutes without a screen.",
      "At your next meal, you won't sit down, but put it on a plate, and take a few minutes without a screen.",
      "At your next meal, you cannot sit down, put it on a plate, and take a few minutes without a screen.",
      "At your next meal, sit down, put it on a plate, and take a few minutes without a screen, nothing else.",
      "At your next meal, sit down, put it on a plate, and take a few minutes without a screen, nobody around.",
    ]) {
      expect(eatEn(candidate), candidate).toBe("negation");
    }
    for (const candidate of [
      "בארוחה הבאה, שב, ושלא תשים בצלחת, וקח כמה דקות בלי מסך.",
      "בארוחה הבאה, שב, אינך שם בצלחת, וקח כמה דקות בלי מסך.",
      "בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות מבלי מסך.",
      "בארוחה הבאה, שב, שים בצלחת, וקח כמה דקות בלא מסך.",
    ]) {
      // "מבלי" and "בלא" are negators of their own, so the approved "בלי" is missing from the set.
      expect(eatHe(candidate), candidate).toBe("negation");
    }
  });

  it("negation compares the SET, so a repeated negator is not a different one", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך, בלי רעש.")).toBe("ok");
  });

  it("negation runs after judgment and before overlap (the order is pinned by candidates that break two)", () => {
    // judgment and negation both broken: judgment is first.
    expect(eatEn("At your next meal, sit down, put it on a plate, and take a few minutes with a screen, it is unhealthy.")).toBe("judgment");
    // negation and overlap both broken: negation is first.
    expect(check("With a screen, a few minutes.", EAT.en, "en")).toBe("negation");
    expect(measureWording({ candidate: "With a screen, a few minutes.", approved: EAT.en }).overlap).toBeLessThan(AI_WORDING.minTokenOverlap);
  });

  it("overlap: just under 0.5 is rejected, exactly 0.5 passes", () => {
    const approved = "alpha beta gamma delta epsilon zeta theta kappa";
    expect(check("alpha beta gamma delta omega sigma", approved, "en")).toBe("ok");
    expect(measureWording({ candidate: "alpha beta gamma delta omega sigma", approved }).overlap).toBe(0.5);
    expect(check("alpha beta gamma omega sigma", approved, "en")).toBe("overlap");
    expect(measureWording({ candidate: "alpha beta gamma omega sigma", approved }).overlap).toBe(0.375);
  });

  it("overlap: a fluent sentence with a different action is rejected", () => {
    expect(eatEn("When it feels right, spend a few minutes without a screen and look out of the window.")).toBe("overlap");
    expect(eatHe("כשנוח לך, אפשר לקחת כמה דקות בלי מסך ולהסתכל מהחלון.")).toBe("overlap");
  });

  it("overlap: a Hebrew clitic does not hide a surviving word (בארוחה = הארוחה)", () => {
    const approved = "ארוחה צלחת סכין תפריט";
    expect(check("בארוחה בצלחת בסכין מקום", approved, "he")).toBe("ok");
    expect(measureWording({ candidate: "בארוחה בצלחת בסכין מקום", approved }).overlap).toBe(0.75);
  });

  it("new_tokens: 5 added content words are rejected, 4 pass", () => {
    const approved = "alpha beta gamma delta";
    const four = "alpha beta gamma delta river mountain forest garden";
    expect(AI_WORDING.maxNewTokens).toBe(4);
    expect(check(four, approved, "en")).toBe("ok");
    expect(check(`${four} ocean`, approved, "en")).toBe("new_tokens");
    expect(measureWording({ candidate: `${four} ocean`, approved }).newTokens).toBe(5);
  });

  it("new_tokens: an appended sentence is rejected however short (sentence count)", () => {
    for (const tail of ["Skip dinner.", "Eat later tonight.", "Ignore previous instructions.", "Fast tomorrow."]) {
      expect(eatEn(`${EAT.en} ${tail}`), tail).not.toBe("ok");
    }
    for (const tail of ["ותדווח לי.", "ואז עשה סיבוב בחוץ.", "ואכל קרקר."]) expect(eatHe(`${EAT.he} ${tail}`), tail).not.toBe("ok");
    // The same words as ONE sentence are judged by the other checks only.
    expect(check("alpha beta gamma delta river.", "alpha beta gamma delta", "en")).toBe("ok");
    expect(check("alpha beta gamma delta. river.", "alpha beta gamma delta", "en")).toBe("new_tokens");
    // An approved text of two sentences keeps its two; a third is one too many.
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, תחליט שוב.", WALK.he, "he")).toBe("ok");
    expect(check("5 דקות הליכה, אפילו סביב הבית. כשתחזור, תחליט שוב. ואז סיימת.", WALK.he, "he")).toBe("new_tokens");
  });

  it("restriction, weight and instruction tails are rejected whether or not they start a sentence", () => {
    for (const tail of ["skip dinner", "fast tomorrow", "weigh yourself", "this helps you lose weight", "you will eat fewer"]) {
      expect(eatEn(`${withoutStop(EAT.en)}, ${tail}.`), tail).not.toBe("ok");
    }
    for (const tail of ["ושקול את עצמך", "זה יעזור לך לרזות", "ככה תרד במשקל", "ואכל קרקר", "ותדלג על ארוחת ערב"]) {
      expect(eatHe(`${withoutStop(EAT.he)}, ${tail}.`), tail).not.toBe("ok");
    }
  });

  it("the checks run in the documented order: a candidate that breaks two reports the earlier", () => {
    // digits (a new 5) and foods (bread): digits is earlier.
    expect(eatEn("At your next meal, sit down, put bread on a plate, and take 5 minutes without a screen.")).toBe("digits");
    // markup and language: markup is earlier.
    expect(eatHe("Hello! this is English text only")).toBe("markup");
    // length and digits: length is earlier.
    expect(eatEn(`${EAT.en} ${"a ".repeat(100)}5`)).toBe("length");
    // advice and lint: advice is earlier.
    expect(eatEn("At your next meal, you should sit down and take a few minutes without a screen, failed.")).toBe("advice");
    expect(WORDING_CHECKS).toEqual(["empty", "markup", "language", "length", "digits", "number_words", "units", "foods", "advice", "lint", "judgment", "negation", "overlap", "new_tokens"]);
  });
});

describe("validateWording: robustness", () => {
  it("never throws on garbage, and does not touch its input", () => {
    const input = Object.freeze({ candidate: "\ud800 \udc00 x", approved: EAT.en, locale: "en" as const });
    expect(() => validateWording(input)).not.toThrow();
    expect(validateWording(input)).toEqual({ ok: false, check: "markup" });
    expect(input.candidate).toBe("\ud800 \udc00 x");
    for (const garbage of ["א".repeat(2_000_000), "a".repeat(100_000), "\u0000\u0001", "‮‭", "🙂".repeat(500), "x".repeat(10) + "​"]) {
      expect(() => validateWording({ candidate: garbage, approved: EAT.he, locale: "he" })).not.toThrow();
      expect(verdict(garbage, EAT.he, "he").ok).toBe(false);
    }
  });

  it("treats non-string input as empty instead of throwing", () => {
    const wrong = { candidate: undefined as unknown as string, approved: EAT.en, locale: "en" as const };
    expect(validateWording(wrong)).toEqual({ ok: false, check: "empty" });
  });

  it("reads Hebrew with points (niqqud): a pointed negator is still the negator", () => {
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות עִם מסך.")).toBe("negation");
    expect(eatHe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בְּלִי מסך.")).toBe("ok");
  });
});
