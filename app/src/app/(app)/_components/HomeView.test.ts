// The glue between a decision and the page: the words, the one button, the time zone and the refresher.
// Rendered to static markup with the real Hebrew catalog and the real Report sheet provider; the
// refresher's effect needs a browser and is in the manual run, here only that it is mounted.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import firstWeekStyles from "@/components/firstWeek/firstWeek.module.css";
import { ReportSheetProvider } from "@/components/shell/ReportSheet";
import { buildShellTestMessages } from "@/components/shell/shellTestMessages";
import ui from "@/components/ui/ui.module.css";
import type { HomeDecision } from "@/domain/home";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { HomeView } from "./HomeView";
import { HOME_TITLE_ID } from "./HomeCard";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => router }));
const intl = vi.hoisted(() => ({ locale: "he" as "he" | "en" }));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = {
    he: (await import("@/i18n/messages/he.json")).default,
    en: (await import("@/i18n/messages/en.json")).default,
  };
  return {
    getLocale: async () => intl.locale,
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: intl.locale, messages: messages[intl.locale] as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});
// The Server Actions the cards post to are not under test here (their own file is); only that the forms name them.
vi.mock("@/app/(flow)/first-week/actions", () => ({
  snoozeFirstWeekCardAction: async () => {},
  answerEarlySignalAction: async () => {},
}));
vi.mock("./HomeRefresher", () => ({
  HomeRefresher: ({ renderedAt }: { renderedAt: number }) => createElement("i", { "data-refresher": renderedAt }),
}));

// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

const CANDLE_LIGHTING = new Date("2027-01-08T14:10:00Z"); // 16:10 in Jerusalem in winter
const ACTION = { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" } as const;

async function render(decision: HomeDecision, timeZone = "Asia/Jerusalem", locale: "he" | "en" = "he"): Promise<string> {
  intl.locale = locale;
  const view = await HomeView({ decision, timeZone, renderedAt: 1_234 });
  const html = renderToStaticMarkup(
    createElement(IntlProvider, intlProps, createElement(ReportSheetProvider, null, view)),
  );
  return html;
}

/** The page without the Report sheet, whose own Close button is not part of Home. */
const withoutSheet = (html: string) => html.replace(/<dialog\b[\s\S]*?<\/dialog>/, "");

const MORNING: HomeDecision = { state: { key: "MORNING" }, action: null, degraded: false };

describe("HomeView", () => {
  it("renders the one invitation button, tied to the Report sheet, when the decision has an action", async () => {
    const page = withoutSheet(await render({ ...MORNING, action: ACTION }));
    expect(page.match(/<button\b/g)).toHaveLength(1);
    const tag = /<button\b[^>]*>/.exec(page)?.[0] ?? "";
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
  });

  it("renders First Week Start with exactly one button that opens the Report sheet, and no counters", async () => {
    const page = withoutSheet(await render({ state: { key: "FIRST_WEEK_START" }, action: ACTION, degraded: false }));
    expect(page).toContain("השבוע הראשון שלנו");
    expect(page).toContain("השבוע לא צריך להוכיח כלום.");
    expect(page).toContain("אני רוצה פשוט להכיר אותך");

    expect(page.match(/<button\b/g)).toHaveLength(1);
    const tag = /<button\b[^>]*>/.exec(page)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
    expect(page).toMatch(/<button\b[^>]*>בוא נתחיל<\/button>/);

    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    const visibleText = page.replace(/<[^>]*>/g, " ");
    expect(visibleText).not.toMatch(/\d/);
    expect(visibleText).not.toMatch(/%|score|ציון|אחוז/i);
  });

  it("renders no button when the decision has no action", async () => {
    expect(withoutSheet(await render(MORNING))).not.toContain("<button");
  });

  it("mounts the refresher with the server's reading of the clock", async () => {
    expect(await render(MORNING)).toContain('data-refresher="1234"');
  });

  it("writes candle lighting in the user's time zone", async () => {
    const decision: HomeDecision = {
      state: { key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING },
      action: null,
      degraded: false,
    };
    const jerusalem = withoutSheet(await render(decision, "Asia/Jerusalem"));
    const utc = withoutSheet(await render(decision, "UTC"));
    expect(jerusalem).toContain("16:10");
    expect(jerusalem).not.toContain("14:10");
    expect(utc).toContain("14:10");
    expect(utc).not.toContain("16:10");
  });

  describe("the First Week summary card", () => {
    const SUMMARY = (hadEnoughData: boolean): HomeDecision => ({
      state: { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData },
      action: { kind: "OPEN_FIRST_WEEK_SUMMARY" },
      degraded: false,
    });

    it.each(["he", "en"] as const)("%s: a link to /first-week as the primary control, then a Not now form, in the homeActions column", async (locale) => {
      const words = (locale === "he" ? he : en).home;
      const page = withoutSheet(await render(SUMMARY(true), "Asia/Jerusalem", locale));

      expect(page).toContain(words.firstWeekSummaryReady.title);
      const link = /<a\b[^>]*href="\/first-week"[^>]*>([^<]*)<\/a>/.exec(page);
      expect(link?.[1]).toBe(words.firstWeekSummaryReady.cta);
      expect(link?.[0]).toContain(ui.primary);
      expect(page.match(/<a\b/g)).toHaveLength(1);

      // Not now: one form with the hidden card name and ONE secondary submit button; nothing else is a button.
      expect(page.match(/<form\b/g)).toHaveLength(1);
      expect(page.match(/<button\b/g)).toHaveLength(1);
      const hidden = /<input\b[^>]*type="hidden"[^>]*>/.exec(page)?.[0] ?? "";
      expect(hidden).toContain('name="card"');
      expect(hidden).toContain('value="summary"');
      const button = /<button\b[^>]*>([^<]*)<\/button>/.exec(page);
      expect(button?.[0]).toContain('type="submit"');
      expect(button?.[0]).toContain(ui.secondary);
      expect(button?.[1]).toBe(words.firstWeekSnooze);

      // The wrapper holds both, link first.
      const wrapper = new RegExp(`<div class="${firstWeekStyles.homeActions}">([^]*?)<\\/form><\\/div>`).exec(page)?.[1] ?? "";
      expect(wrapper.indexOf("<a ")).toBeGreaterThan(-1);
      expect(wrapper.indexOf("<a ")).toBeLessThan(wrapper.indexOf("<form"));
    });

    it("renders no Report sheet button on the summary card", async () => {
      expect(withoutSheet(await render(SUMMARY(true)))).not.toContain('aria-haspopup="dialog"');
    });

    it("uses the other words, with no claim of familiarity, when there was not enough data", async () => {
      const page = withoutSheet(await render(SUMMARY(false)));
      expect(page).toContain(he.home.firstWeekSummaryReadyLittle.title);
      expect(page).not.toContain("הכרנו");
      expect(page).toContain('href="/first-week"');
      expect(page).toContain('value="summary"');
    });

    it("has no digit, percentage or score anywhere, and exactly one h1", async () => {
      for (const enough of [true, false]) {
        const page = withoutSheet(await render(SUMMARY(enough)));
        expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
        const visible = page.replace(/<script[^]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
        expect(visible).not.toMatch(/\d|%|score|ציון|אחוז/i);
      }
    });
  });

  describe("the welcome-back card", () => {
    const BACK: HomeDecision = {
      state: { key: "FIRST_WEEK_WELCOME_BACK" },
      action: { kind: "OPEN_REPORT_SHEET", reason: "WELCOME_BACK" },
      degraded: false,
    };

    it.each(["he", "en"] as const)("%s: the Report sheet button with its own sentence above, and a Not now that names welcome_back", async (locale) => {
      const words = (locale === "he" ? he : en).home;
      // The static markup writes an apostrophe as an entity; the catalog has the plain one.
      const page = withoutSheet(await render(BACK, "Asia/Jerusalem", locale)).replace(/&#x27;/g, "'");

      expect(page).toContain(words.firstWeekWelcomeBack.title);
      expect(page).toContain(words.firstWeekWelcomeBack.lead);
      expect(page.indexOf(words.firstWeekWelcomeBack.lead)).toBeLessThan(page.indexOf("<button"));

      expect(page.match(/<button\b/g)).toHaveLength(2);
      const opener = /<button\b[^>]*aria-haspopup="dialog"[^>]*>([^<]*)<\/button>/.exec(page);
      expect(opener?.[0]).toContain('aria-controls="report-sheet"');
      expect(opener?.[1]).toBe(words.firstWeekWelcomeBack.cta);
      expect(page).not.toContain("<a ");

      expect(page.match(/<form\b/g)).toHaveLength(1);
      const hidden = /<input\b[^>]*type="hidden"[^>]*>/.exec(page)?.[0] ?? "";
      expect(hidden).toContain('name="card"');
      expect(hidden).toContain('value="welcome_back"');
      expect(page).toMatch(new RegExp(`<button\\b[^>]*type="submit"[^>]*>${words.firstWeekSnooze}</button>`));
      expect(page).toContain(`<div class="${firstWeekStyles.homeActions}">`);
    });

    it("has no digit, no exclamation mark and no talk of missing anything", async () => {
      const page = withoutSheet(await render(BACK));
      const visible = page.replace(/<script[^]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
      expect(visible).not.toMatch(/\d|!|החמצת|פספסת/);
    });
  });

  describe("the Early Signal card (B4)", () => {
    const SIGNAL: HomeDecision = {
      state: { key: "EARLY_SIGNAL", signal: "late_evening_meals" },
      action: { kind: "ANSWER_EARLY_SIGNAL" },
      degraded: false,
    };

    it.each(["he", "en"] as const)("%s: three equal answers, in the spec's order, each its own form with a hidden answer", async (locale) => {
      const words = (locale === "he" ? he : en).home.earlySignalLateEvening;
      const page = withoutSheet(await render(SIGNAL, "Asia/Jerusalem", locale));

      expect(page).toContain(words.title);
      expect(page).toContain(words.body);
      expect(page.match(/<form\b/g)).toHaveLength(3);
      expect(page.match(/<button\b/g)).toHaveLength(3);

      const forms = Array.from(page.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g), (match) => match[1]);
      expect(forms.map((form) => /name="answer"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="answer"/.exec(form)?.slice(1).find(Boolean))).toEqual(["confirm", "unsure", "reject"]);
      expect(forms.map((form) => />([^<]+)<\/button>/.exec(form)?.[1])).toEqual([words.confirm, words.unsure, words.reject]);

      // Equal weight: the same variant (and so the same size) on every button, and it is the quiet one.
      const classes = Array.from(page.matchAll(/<button\b[^>]*class="([^"]*)"/g), (match) => match[1]);
      expect(classes).toHaveLength(3);
      expect(new Set(classes).size).toBe(1);
      expect(classes[0]).toContain(ui.secondary);
      expect(classes[0]).not.toContain(ui.primary);
      for (const button of page.matchAll(/<button\b[^>]*>/g)) expect(button[0]).toContain('type="submit"');
    });

    it("keeps the three answers in one group named by the card's title", async () => {
      const page = withoutSheet(await render(SIGNAL));
      const group = /<div role="group" aria-labelledby="([^"]+)"[^>]*>/.exec(page);
      expect(group?.[1]).toBe(HOME_TITLE_ID);
      expect(page).toContain(`<h1 id="${HOME_TITLE_ID}"`);
      expect(group?.[0]).toContain(firstWeekStyles.homeActions);
    });

    it("has the light bulb (hidden from assistive technology), no link, no snooze form and no report button", async () => {
      const page = withoutSheet(await render(SIGNAL));
      expect(page).toMatch(/<span[^>]*aria-hidden="true"[^>]*>💡<\/span>/);
      expect(page).not.toContain("<a ");
      expect(page).not.toContain('name="card"');
      expect(page).not.toContain('aria-haspopup="dialog"');
      expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    });

    it("has no digit, no exclamation mark and no jargon in either language", async () => {
      for (const locale of ["he", "en"] as const) {
        const page = withoutSheet(await render(SIGNAL, "UTC", locale));
        const visible = page.replace(/<script[^]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
        expect(visible, locale).not.toMatch(/\d|!/);
        expect(visible.toLowerCase(), locale).not.toMatch(/דפוס|pattern|signal|evidence/);
      }
    });

    it("renders nothing for the answers when the decision has no action", async () => {
      const page = withoutSheet(await render({ ...SIGNAL, action: null }));
      expect(page).not.toContain("<form");
      expect(page).not.toContain("<button");
    });
  });

  it("renders the first-report button alone, with no wrapper and no snooze form", async () => {
    const page = withoutSheet(await render({ ...MORNING, action: ACTION }));
    expect(page).not.toContain("<form");
    expect(page).not.toContain(firstWeekStyles.homeActions);
  });

  it("adds the calm note only for a degraded decision", async () => {
    expect(withoutSheet(await render(MORNING))).not.toContain('role="status"');
    expect(withoutSheet(await render({ ...MORNING, degraded: true }))).toContain('role="status"');
  });
});
