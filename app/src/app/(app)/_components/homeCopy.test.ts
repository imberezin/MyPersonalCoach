import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { HOME_COPY_KEYS, homeCopyKey, type HomeAction, type HomeDecision, type HomeState } from "@/domain/home";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import type { Translator } from "@/i18n/server";
import { homeCopyFor } from "./homeCopy";

type Locale = "he" | "en";
const catalogs: Record<Locale, AbstractIntlMessages> = { he, en };
// The same catalogs, typed, so a test can compare against the exact string a key holds.
const homeText = { he: he.home, en: en.home };

// The same wrapping as getTranslations in src/i18n/server.ts, scoped to the "home" namespace.
function translator(locale: Locale): Translator {
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "home", timeZone: DEFAULT_TIME_ZONE });
  return (key, values) => t(key as never, values as never);
}

const LOCALES: Locale[] = ["he", "en"];
const CANDLE_LIGHTING = new Date("2027-01-08T14:10:00Z"); // 16:10 in Jerusalem in winter
const HAVDALAH = new Date("2027-01-09T15:25:00Z");
const FORMAT = { locale: "he", timeZone: "Asia/Jerusalem" };
const ACTION: HomeAction = { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" };

const STATES: Array<[string, HomeState]> = [
  ["morning", { key: "MORNING" }],
  ["evening", { key: "EVENING" }],
  ["before Shabbat", { key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING }],
  ["Motzei Shabbat", { key: "MOTZEI_SHABBAT", havdalah: HAVDALAH }],
  ["First Week Start", { key: "FIRST_WEEK_START" }],
  ["nothing to say", { key: "SILENCE", reason: "NOTHING_TO_SAY" }],
  ["Shabbat in progress", { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" }],
  ["a holiday in progress", { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" }],
];

const decision = (state: HomeState, over: Partial<HomeDecision> = {}): HomeDecision => ({
  state,
  action: null,
  degraded: false,
  ...over,
});

// The brand-voice lint of app.messages.test.ts, applied here to the strings Home actually produces.
const FORBIDDEN: Record<Locale, string[]> = {
  he: ["!", "החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "נכשל", "מתחילים מחדש", "להתחיל מחדש"],
  en: ["!", "missed", "score", "percent", "streak", "failed", "overdue", "behind", "start over"],
};

describe("homeCopyFor", () => {
  describe.each(LOCALES)("%s", (locale) => {
    const t = translator(locale);
    const format = { locale, timeZone: "Asia/Jerusalem" };

    it.each(STATES)("gives %s a title and a body, with no placeholder left over", (_name, state) => {
      const copy = homeCopyFor(decision(state), t, format);
      for (const text of [copy.title, copy.body]) {
        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/[{}]/);
      }
    });

    it("passes the brand-voice lint for every state, with and without the invitation and the note", () => {
      for (const [, state] of STATES) {
        const copy = homeCopyFor(decision(state, { action: ACTION, degraded: true }), t, format);
        const text = [copy.title, copy.lead, copy.body, copy.invitation?.lead, copy.invitation?.cta, copy.degradedNote]
          .join("\n")
          .toLowerCase();
        for (const word of FORBIDDEN[locale]) expect(text, `${locale}: "${word}"`).not.toContain(word.toLowerCase());
      }
    });

    it("writes candle lighting as HH:mm in the user's zone, isolated left to right", () => {
      const state: HomeState = { key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING };
      expect(homeCopyFor(decision(state), t, format).body).toContain("\u206616:10\u2069");
      expect(homeCopyFor(decision(state), t, { locale, timeZone: "UTC" }).body).toContain("\u206614:10\u2069");
    });

    it("keeps midnight as 00:00, never 24:00", () => {
      const state: HomeState = { key: "BEFORE_SHABBAT", candleLighting: new Date("2027-01-12T22:00:00Z") };
      expect(homeCopyFor(decision(state), t, format).body).toContain("\u206600:00\u2069");
    });

    it("formats in Jerusalem, and does not throw, when the profile's zone is garbage", () => {
      const state: HomeState = { key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING };
      const copy = homeCopyFor(decision(state), t, { locale, timeZone: "Not/AZone" });
      expect(copy.body).toContain("\u206616:10\u2069");
      expect(copy.body).not.toContain("{");
    });
  });

  it("names a time in Before Shabbat only", () => {
    const t = translator("he");
    for (const [name, state] of STATES) {
      const body = homeCopyFor(decision(state), t, FORMAT).body;
      expect(/\d\d:\d\d/.test(body), name).toBe(state.key === "BEFORE_SHABBAT");
    }
  });

  it("gives an invitation exactly when the decision has an action, whether or not it is degraded", () => {
    for (const locale of LOCALES) {
      const t = translator(locale);
      const { lead, cta } = homeText[locale].firstReport;
      for (const [name, state] of STATES) {
        // First Week Start says its piece in its own lead and body, so only its button is the invitation.
        const expected =
          state.key === "FIRST_WEEK_START" ? { lead: null, cta: homeText[locale].firstWeekStart.cta } : { lead, cta };
        for (const degraded of [false, true]) {
          const where = `${locale}: ${name}, degraded ${degraded}`;
          const without = homeCopyFor(decision(state, { degraded }), t, FORMAT);
          const withAction = homeCopyFor(decision(state, { action: ACTION, degraded }), t, FORMAT);
          expect(without.invitation, where).toBeNull();
          expect(withAction.invitation, where).toEqual(expected);
        }
      }
    }
  });

  it("gives the note exactly when a fact was unknown, whether or not there is an action", () => {
    for (const locale of LOCALES) {
      const t = translator(locale);
      const note = homeText[locale].degraded;
      const state: HomeState = { key: "MORNING" };
      for (const action of [null, ACTION]) {
        expect(homeCopyFor(decision(state, { action }), t, FORMAT).degradedNote, locale).toBeNull();
        expect(homeCopyFor(decision(state, { action, degraded: true }), t, FORMAT).degradedNote, locale).toBe(note);
      }
    }
  });

  it("lights a candle for Shabbat in view or in progress, and a moon for its end", () => {
    const t = translator("he");
    const emoji = (state: HomeState) => homeCopyFor(decision(state), t, FORMAT).emoji;
    expect(emoji({ key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING })).toBe("🕯️");
    expect(emoji({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" })).toBe("🕯️");
    expect(emoji({ key: "MOTZEI_SHABBAT", havdalah: HAVDALAH })).toBe("🌙");
  });

  it("uses no emoji where the words are enough", () => {
    const t = translator("he");
    for (const state of [
      { key: "MORNING" },
      { key: "EVENING" },
      { key: "SILENCE", reason: "NOTHING_TO_SAY" },
      { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" },
    ] satisfies HomeState[]) {
      expect(homeCopyFor(decision(state), t, FORMAT).emoji).toBeNull();
    }
  });

  it("offers no invitation inside a quiet period (the resolver never gives it an action there)", () => {
    const t = translator("he");
    const copy = homeCopyFor(decision({ key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" }), t, FORMAT);
    expect(copy.invitation).toBeNull();
  });

  describe("First Week Start (B1)", () => {
    const state: HomeState = { key: "FIRST_WEEK_START" };

    it.each(LOCALES)("%s: shows the spec's title, an opening line, the body and the one button", (locale) => {
      const copy = homeCopyFor(decision(state, { action: ACTION }), translator(locale), { locale, timeZone: "Asia/Jerusalem" });
      const text = homeText[locale].firstWeekStart;
      expect(copy.title).toBe(text.title);
      expect(copy.lead).toBe(text.lead);
      expect(copy.body).toBe(text.body);
      expect(copy.invitation).toEqual({ lead: null, cta: text.cta });
      expect(copy.emoji).toBeNull();
    });

    it("says the spec's words in Hebrew", () => {
      const copy = homeCopyFor(decision(state, { action: ACTION }), translator("he"), FORMAT);
      expect(copy.title).toBe("השבוע הראשון שלנו");
      expect(copy.lead).toBe("השבוע לא צריך להוכיח כלום.");
      expect(copy.body).toContain("אני רוצה פשוט להכיר אותך");
      expect(copy.invitation?.cta).toBe("בוא נתחיל");
    });

    it("has no counter, percentage, score or day number in either language", () => {
      for (const locale of LOCALES) {
        const copy = homeCopyFor(decision(state, { action: ACTION }), translator(locale), { locale, timeZone: "UTC" });
        const text = [copy.title, copy.lead, copy.body, copy.invitation?.cta].join("\n");
        expect(text, locale).not.toMatch(/\d/);
        expect(text, locale).not.toMatch(/%|score|ציון/i);
      }
    });

    it("is the only state with an opening line", () => {
      const t = translator("he");
      for (const [name, other] of STATES) {
        expect(homeCopyFor(decision(other), t, FORMAT).lead === null, name).toBe(other.key !== "FIRST_WEEK_START");
      }
    });
  });

  it("covers every copy key, and gives each state its own title", () => {
    const t = translator("he");
    const keys = STATES.map(([, state]) => homeCopyKey(state));
    expect([...keys].sort()).toEqual([...HOME_COPY_KEYS].sort());

    const titles = STATES.map(([, state]) => homeCopyFor(decision(state), t, FORMAT).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
