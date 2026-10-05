// The active-experiment card on Home, rendered to static markup with the real catalogs and the real Report sheet provider (the
// same set-up as HomeView.test.ts, which owns the other cards). Only the decision is given; the page picks the sentence.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import firstWeekStyles from "@/components/firstWeek/firstWeek.module.css";
import { ReportSheetProvider } from "@/components/shell/ReportSheet";
import { buildShellTestMessages } from "@/components/shell/shellTestMessages";
import ui from "@/components/ui/ui.module.css";
import type { ActiveExperimentFact, HomeDecision } from "@/domain/home";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { HomeView } from "./HomeView";

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
// The Server Actions the cards post to are not under test here (their own files are); only that the forms exist.
vi.mock("@/app/(flow)/first-week/actions", () => ({
  snoozeFirstWeekCardAction: async () => {},
  answerEarlySignalAction: async () => {},
}));
vi.mock("@/app/(app)/progress/actions", () => ({ acknowledgeMilestoneAction: async () => {} }));
vi.mock("@/app/(flow)/week/actions", () => ({
  openWeeklyStoryAction: async () => {},
  snoozeWeeklyCardAction: async () => {},
}));
vi.mock("./HomeRefresher", () => ({
  HomeRefresher: ({ renderedAt }: { renderedAt: number }) => createElement("i", { "data-refresher": renderedAt }),
}));

const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

const SENTENCE = "בארוחה הבאה — שב וקח כמה דקות בלי מסך.";
const EXPERIMENT: ActiveExperimentFact = { key: "eat_intentionally", variantId: "default", wording: SENTENCE, locale: "he" };
const THANK = { kind: "THANK_ACTIVE_EXPERIMENT" } as const;
const card = (experiment: ActiveExperimentFact = EXPERIMENT, over: Partial<HomeDecision> = {}): HomeDecision => ({
  state: { key: "ACTIVE_EXPERIMENT", experiment },
  action: THANK,
  degraded: false,
  weeklyLink: false,
  ...over,
});

async function render(decision: HomeDecision, locale: "he" | "en" = "he"): Promise<string> {
  intl.locale = locale;
  const view = await HomeView({ decision, timeZone: "Asia/Jerusalem", renderedAt: 1_234 });
  const html = renderToStaticMarkup(createElement(IntlProvider, intlProps, createElement(ReportSheetProvider, null, view)));
  // The page without the Report sheet, whose own Close button is not part of Home.
  return html.replace(/<dialog\b[\s\S]*?<\/dialog>/, "");
}

const visibleText = (page: string) => page.replace(/<script[^]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");

describe("the active-experiment card", () => {
  it("shows the title, the person's sentence and then the gentle line, in that order", async () => {
    const page = await render(card());
    expect(page).toContain(he.home.activeExperiment.title);
    expect(page).toContain(SENTENCE);
    expect(page).toContain("אם בא לך, אפשר לנסות בארוחה הבאה. אין צורך לדווח על כלום.");
    const order = [he.home.activeExperiment.title, SENTENCE, he.home.activeExperiment.body].map((text) => page.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it.each(["he", "en"] as const)("%s: exactly one button, a soft Thanks that posts the shared snooze form with the card name", async (locale) => {
    const words = (locale === "he" ? he : en).home;
    const experiment: ActiveExperimentFact = { ...EXPERIMENT, locale, wording: "At your next meal, sit down for a few minutes." };
    const page = await render(card(experiment), locale);

    expect(page).toContain(words.activeExperiment.title);
    expect(page.match(/<form\b/g)).toHaveLength(1);
    expect(page.match(/<button\b/g)).toHaveLength(1);
    expect(page).not.toContain("<a ");
    const hidden = /<input\b[^>]*type="hidden"[^>]*>/.exec(page)?.[0] ?? "";
    expect(hidden).toContain('name="card"');
    expect(hidden).toContain('value="experiment"');
    const button = /<button\b([^>]*)>([^<]*)<\/button>/.exec(page);
    expect(button?.[2]).toBe(words.activeExperimentAck);
    expect(button?.[1]).toContain('type="submit"');
    expect(button?.[1]).toContain(ui.secondary);
    expect(button?.[1]).not.toContain(ui.primary);
    expect(page).toContain(`<div class="${firstWeekStyles.homeActions}">`);
  });

  it("is not a reporting surface: no tried or not-tried buttons, no Report sheet, no first-report invitation, no Not now", async () => {
    for (const locale of ["he", "en"] as const) {
      const words = (locale === "he" ? he : en).home;
      const page = await render(card({ ...EXPERIMENT, locale }), locale);
      expect(page, locale).not.toContain('aria-haspopup="dialog"');
      expect(page, locale).not.toContain(words.firstReport.cta);
      expect(page, locale).not.toContain(words.firstWeekSnooze);
      expect(page, locale).not.toContain(words.weeklyReady.cta);
      expect(page.match(/type="hidden"/g), locale).toHaveLength(1);
      expect(visibleText(page), locale).not.toMatch(/tried|helpful|ניסיתי|עזר/i);
    }
  });

  it("shows no digit, percentage, counter, streak or exclamation mark, and has exactly one h1", async () => {
    for (const locale of ["he", "en"] as const) {
      const page = await render(card({ ...EXPERIMENT, locale }), locale);
      expect(page.match(/<h1[\s>]/g), locale).toHaveLength(1);
      expect(page, locale).not.toContain('aria-hidden="true"');
      const own = visibleText(page).replace(SENTENCE, " ");
      expect(own, locale).not.toMatch(/\d|!|%|streak|score|רצף|ציון|אחוז/i);
    }
  });

  it("escapes the stored sentence: markup in it is text, never an element", async () => {
    const hostile: ActiveExperimentFact = { ...EXPERIMENT, wording: '<script>alert(1)</script><b>x</b> & "y" {time}' };
    const page = await render(card(hostile));
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<b>x</b>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; {time}");
  });

  it("shows the library's sentence of the page's language when the stored one was written in another", async () => {
    const stored: ActiveExperimentFact = { ...EXPERIMENT, locale: "en", wording: "A sentence stored in English." };
    const page = await render(card(stored), "he");
    expect(page).not.toContain("A sentence stored in English.");
    expect(page).toContain(he.interventions.eat_intentionally.default);

    const back: ActiveExperimentFact = { ...EXPERIMENT, locale: "he" };
    const english = await render(card(back), "en");
    expect(english).not.toContain(SENTENCE);
    expect(english).toContain(en.interventions.eat_intentionally.default);
  });

  it("renders no button when the decision has no action", async () => {
    const page = await render(card(EXPERIMENT, { action: null }));
    expect(page).not.toContain("<form");
    expect(page).not.toContain("<button");
  });

  it("adds the calm note only for a degraded decision", async () => {
    expect(await render(card())).not.toContain(he.home.degraded.slice(0, 12));
    expect(await render(card(EXPERIMENT, { degraded: true }))).toContain(he.home.degraded.slice(0, 12));
  });

  describe("beside the quiet way back to the week", () => {
    it("renders the link under the experiment card when the decision says so", async () => {
      const page = await render(card(EXPERIMENT, { weeklyLink: true }));
      expect(page.match(/<a\b[^>]*href="\/week"/g)).toHaveLength(1);
      expect(page.match(/<button\b/g)).toHaveLength(1);
      expect(page.indexOf("<button")).toBeLessThan(page.indexOf('href="/week"'));
    });
  });
});
