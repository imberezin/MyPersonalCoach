// The calm pieces around the list: the notice after a delete, "Show more", the empty card and the
// "could not load" card, as markup with the real catalogs.
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import ui from "@/components/ui/ui.module.css";
import { MEAL_NOTICES } from "@/domain/food/routes";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";
import { MealsEmpty } from "./MealsEmpty";
import { MealsNotice } from "./MealsNotice";
import { MealsUnavailable } from "./MealsUnavailable";
import { ShowMoreLink } from "./ShowMoreLink";

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

const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);

describe.each(LOCALES)("MealsNotice in %s", (locale) => {
  const words = catalogs[locale].meals;
  const render = (notice: (typeof MEAL_NOTICES)[number]) => renderWithIntl(createElement(MealsNotice, { notice }), locale);

  it.each(MEAL_NOTICES)("%s: a focusable wrapper around the message, with the catalog words", (notice) => {
    const html = render(notice);
    // Message takes no tabIndex, so the focusable element is the wrapper and the message sits inside it.
    expect(html).toMatch(/^<div[^>]*tabindex="-1"[^>]*><p\b/);
    expect(count(html, /tabindex/g)).toBe(1);
    expect(textOf(html)).toBe(words.notice[notice]);
  });

  it("announces 'deleted' and 'gone' as a status, in the calm note look", () => {
    for (const notice of ["deleted", "gone"] as const) {
      const html = render(notice);
      expect(html).toContain('role="status"');
      expect(html).not.toContain('role="alert"');
      expect(html).toContain(ui.note);
    }
  });

  it("announces the technical 'error' as an alert, in the one place the error look is used", () => {
    const html = render("error");
    expect(html).toContain('role="alert"');
    expect(html).toContain(ui.error);
    expect(html).not.toContain(ui.attention);
  });

  it("claims no state in the error line and uses no exclamation mark", () => {
    for (const notice of MEAL_NOTICES) expect(textOf(render(notice))).not.toContain("!");
    expect(words.notice.error).not.toMatch(/nothing was changed|לא השתנה/i);
  });
});

describe.each(LOCALES)("ShowMoreLink in %s", (locale) => {
  const words = catalogs[locale].meals;

  it("is a plain link to the next page that keeps the person's place", async () => {
    intl.locale = locale;
    const element = await ShowMoreLink({ href: "/me/meals?pages=2" });
    expect(element.props.scroll).toBe(false);
    expect(element.props.href).toBe("/me/meals?pages=2");
    const html = renderWithIntl(element, locale);
    expect(hrefs(html)).toEqual(["/me/meals?pages=2"]);
    expect(textOf(html)).toBe(words.more);
  });

  it("looks like the secondary button, with class names that exist in the ui module", async () => {
    intl.locale = locale;
    expect(ui.button).toBeTruthy();
    expect(ui.secondary).toBeTruthy();
    const html = renderWithIntl(await ShowMoreLink({ href: "/me/meals?pages=2" }), locale);
    expect(html).toContain(`class="${ui.button} ${ui.secondary}"`);
  });
});

describe.each(LOCALES)("MealsEmpty and MealsUnavailable in %s", (locale) => {
  const words = catalogs[locale].meals;

  async function render(view: typeof MealsEmpty | typeof MealsUnavailable, loc: TestLocale = locale): Promise<string> {
    intl.locale = loc;
    return renderWithIntl(await view(), loc);
  }

  it("the empty card is a title and a sentence, with nothing to press", async () => {
    const html = await render(MealsEmpty);
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(count(html, /<h1\b/g)).toBe(0);
    expect(textOf(html)).toContain(words.empty.title);
    expect(textOf(html)).toContain(words.empty.body);
    expect(html).not.toMatch(/<a\b|<button\b|<form/);
  });

  it("the unavailable card offers to try again (the same address) and to go back to Me", async () => {
    const html = await render(MealsUnavailable);
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(hrefs(html)).toEqual(["/me/meals", "/me"]);
    expect(textOf(html)).toContain(words.unavailable.title);
    expect(textOf(html)).toContain(words.unavailable.body);
    expect(textOf(html)).toContain(words.unavailable.retry);
    expect(textOf(html)).toContain(words.back);
  });

  it("a failed load never reads as 'no meals'", async () => {
    const text = textOf(await render(MealsUnavailable));
    expect(text).not.toContain(words.empty.title);
    expect(text).not.toContain(words.empty.body);
  });

  it("neither scolds nor counts", async () => {
    for (const view of [MealsEmpty, MealsUnavailable]) expect(textOf(await render(view))).not.toMatch(/!|\d/);
  });
});
