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
  ["summary ready", { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: true }],
  ["summary ready, little data", { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false }],
  ["welcome back", { key: "FIRST_WEEK_WELCOME_BACK" }],
  ["Early Signal", { key: "EARLY_SIGNAL", signal: "late_evening_meals" }],
  ["nothing to say", { key: "SILENCE", reason: "NOTHING_TO_SAY" }],
  ["Shabbat in progress", { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" }],
  ["a holiday in progress", { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" }],
];

const snoozeCards: ReadonlySet<HomeState["key"]> = new Set(["FIRST_WEEK_SUMMARY_READY", "FIRST_WEEK_WELCOME_BACK"]);

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
        const text = [
          copy.title,
          copy.lead,
          copy.body,
          copy.invitation?.lead,
          copy.invitation?.cta,
          copy.invitation?.snoozeLabel,
          copy.earlySignal?.confirm,
          copy.earlySignal?.unsure,
          copy.earlySignal?.reject,
          copy.degradedNote,
        ]
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
      const words = homeText[locale];
      for (const [name, state] of STATES) {
        // First Week Start and the summary card say their piece in their own lead and body, so only their button is the
        // invitation; the welcome-back card has its own sentence and button; the two cards that can be put away carry
        // their "Not now"; the Early Signal card has no invitation at all (its three buttons are its answers).
        const expected =
          state.key === "FIRST_WEEK_START"
            ? { lead: null, cta: words.firstWeekStart.cta, snoozeLabel: null }
            : state.key === "FIRST_WEEK_SUMMARY_READY"
              ? { lead: null, cta: (state.hadEnoughData ? words.firstWeekSummaryReady : words.firstWeekSummaryReadyLittle).cta, snoozeLabel: words.firstWeekSnooze }
              : state.key === "FIRST_WEEK_WELCOME_BACK"
                ? { lead: words.firstWeekWelcomeBack.lead, cta: words.firstWeekWelcomeBack.cta, snoozeLabel: words.firstWeekSnooze }
                : state.key === "EARLY_SIGNAL"
                  ? null
                  : { lead, cta, snoozeLabel: null };
        expect(snoozeCards.has(state.key) === (expected?.snoozeLabel != null), name).toBe(true);
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
      expect(copy.invitation).toEqual({ lead: null, cta: text.cta, snoozeLabel: null });
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

  describe("the First Week cards", () => {
    const summary = (hadEnoughData: boolean): HomeState => ({ key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData });
    const SUMMARY_ACTION: HomeAction = { kind: "OPEN_FIRST_WEEK_SUMMARY" };
    const BACK_ACTION: HomeAction = { kind: "OPEN_REPORT_SHEET", reason: "WELCOME_BACK" };

    it.each(LOCALES)("%s: the summary card uses firstWeekSummaryReady with data and firstWeekSummaryReadyLittle without", (locale) => {
      const words = homeText[locale];
      const format = { locale, timeZone: "Asia/Jerusalem" };
      const enough = homeCopyFor(decision(summary(true), { action: SUMMARY_ACTION }), translator(locale), format);
      const little = homeCopyFor(decision(summary(false), { action: SUMMARY_ACTION }), translator(locale), format);

      expect([enough.title, enough.body]).toEqual([words.firstWeekSummaryReady.title, words.firstWeekSummaryReady.body]);
      expect([little.title, little.body]).toEqual([words.firstWeekSummaryReadyLittle.title, words.firstWeekSummaryReadyLittle.body]);
      // An opening line of its own is B1's only, and the summary card has no sentence above its button.
      expect(enough.lead).toBeNull();
      expect(enough.invitation).toEqual({ lead: null, cta: words.firstWeekSummaryReady.cta, snoozeLabel: words.firstWeekSnooze });
      expect(little.invitation).toEqual({ lead: null, cta: words.firstWeekSummaryReadyLittle.cta, snoozeLabel: words.firstWeekSnooze });
    });

    it("never claims familiarity without data, in either language", () => {
      expect(homeText.he.firstWeekSummaryReadyLittle.title).not.toBe(homeText.he.firstWeekSummaryReady.title);
      expect(homeText.he.firstWeekSummaryReadyLittle.title).not.toContain("הכרנו");
      expect(homeText.en.firstWeekSummaryReadyLittle.title.toLowerCase()).not.toContain("know each other");
      expect(homeText.he.firstWeekSummaryReadyLittle.body).not.toContain("הכרנו");
      expect(homeText.en.firstWeekSummaryReadyLittle.body.toLowerCase()).not.toContain("know each other");
    });

    it.each(LOCALES)("%s: the welcome-back card has a sentence and a button of its own, and a Not now", (locale) => {
      const words = homeText[locale].firstWeekWelcomeBack;
      const copy = homeCopyFor(decision({ key: "FIRST_WEEK_WELCOME_BACK" }, { action: BACK_ACTION }), translator(locale), {
        locale,
        timeZone: "Asia/Jerusalem",
      });
      expect([copy.title, copy.body]).toEqual([words.title, words.body]);
      expect(copy.invitation).toEqual({ lead: words.lead, cta: words.cta, snoozeLabel: homeText[locale].firstWeekSnooze });
      expect(copy.emoji).toBeNull();
    });

    it("says the spec's words in Hebrew", () => {
      const t = translator("he");
      expect(homeCopyFor(decision({ key: "FIRST_WEEK_WELCOME_BACK" }, { action: BACK_ACTION }), t, FORMAT).title).toBe("חזרת");
      expect(homeCopyFor(decision(summary(true), { action: SUMMARY_ACTION }), t, FORMAT).title).toBe("כבר הכרנו קצת");
      expect(homeCopyFor(decision(summary(false), { action: SUMMARY_ACTION }), t, FORMAT).title).toBe("התקופה הראשונה שלנו");
    });

    it("has no digit, percentage or score in the three cards, in either language", () => {
      for (const locale of LOCALES) {
        const t = translator(locale);
        for (const [state, action] of [
          [summary(true), SUMMARY_ACTION],
          [summary(false), SUMMARY_ACTION],
          [{ key: "FIRST_WEEK_WELCOME_BACK" }, BACK_ACTION],
        ] as Array<[HomeState, HomeAction]>) {
          const copy = homeCopyFor(decision(state, { action }), t, { locale, timeZone: "UTC" });
          const text = [copy.title, copy.lead, copy.body, copy.invitation?.lead, copy.invitation?.cta, copy.invitation?.snoozeLabel].join("\n");
          expect(text, `${locale}: ${state.key}`).not.toMatch(/\d|%|score|ציון/i);
        }
      }
    });

    it("gives no title a final period, like every other Home title", () => {
      const t = translator("he");
      for (const [name, state] of STATES) expect(homeCopyFor(decision(state), t, FORMAT).title.endsWith("."), name).toBe(false);
    });
  });

  describe("the Early Signal card (B4)", () => {
    const state: HomeState = { key: "EARLY_SIGNAL", signal: "late_evening_meals" };
    const ANSWER: HomeAction = { kind: "ANSWER_EARLY_SIGNAL" };

    it.each(LOCALES)("%s: the title, the body and the three answers, with the light bulb, and no invitation", (locale) => {
      const words = homeText[locale].earlySignalLateEvening;
      const copy = homeCopyFor(decision(state, { action: ANSWER }), translator(locale), { locale, timeZone: "Asia/Jerusalem" });
      expect([copy.title, copy.body]).toEqual([words.title, words.body]);
      expect(copy.earlySignal).toEqual({ confirm: words.confirm, unsure: words.unsure, reject: words.reject });
      expect(copy.invitation).toBeNull();
      expect(copy.lead).toBeNull();
      expect(copy.emoji).toBe("💡");
    });

    it("gives the answers to that state only", () => {
      const t = translator("he");
      for (const [name, other] of STATES) {
        expect(homeCopyFor(decision(other, { action: ACTION }), t, FORMAT).earlySignal === null, name).toBe(other.key !== "EARLY_SIGNAL");
      }
    });

    it("says the spec's words in Hebrew, and names the hour by the clock, not as a verdict", () => {
      const copy = homeCopyFor(decision(state, { action: ANSWER }), translator("he"), FORMAT);
      expect(copy.title).toBe("משהו קטן ששמתי לב אליו");
      expect(copy.body).toContain("ארוחה בשעות הערב המאוחרות");
      expect(copy.body).not.toContain("ארוחה מאוחר ");
      expect(copy.earlySignal).toEqual({ confirm: "נשמע לי נכון", unsure: "לא בטוח", reject: "לא קשור אליי" });
    });

    it("has no digit, no exclamation mark, and no jargon, in either language", () => {
      for (const locale of LOCALES) {
        const copy = homeCopyFor(decision(state, { action: ANSWER }), translator(locale), { locale, timeZone: "UTC" });
        const text = [copy.title, copy.body, copy.earlySignal?.confirm, copy.earlySignal?.unsure, copy.earlySignal?.reject].join("\n");
        expect(text, locale).not.toMatch(/\d|!/);
        expect(text.toLowerCase(), locale).not.toMatch(/דפוס|pattern|signal|evidence/);
      }
    });

    it("has three different, non-empty answers", () => {
      for (const locale of LOCALES) {
        const answers = homeCopyFor(decision(state, { action: ANSWER }), translator(locale), { locale, timeZone: "UTC" }).earlySignal;
        const values = Object.values(answers ?? {});
        expect(values).toHaveLength(3);
        expect(new Set(values).size).toBe(3);
        for (const value of values) expect(value.trim()).not.toBe("");
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
