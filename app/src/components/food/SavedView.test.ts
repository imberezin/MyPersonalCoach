// D8 and the three calm notices (quiet, unavailable, photo off), as markup with the real catalogs.
import { describe, expect, it, vi } from "vitest";
import { FlowUnavailable } from "./FlowUnavailable";
import { PhotoUnavailable } from "./PhotoUnavailable";
import { QuietNotice } from "./QuietNotice";
import { SavedView } from "./SavedView";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./foodTestKit";

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

async function renderSaved(locale: TestLocale, firstReport: boolean): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(await SavedView({ firstReport, followUp: { kind: "none" } }), locale);
}

describe.each(LOCALES)("SavedView (D8) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("has exactly one h1 that names the section, and announces the confirmation as a status", async () => {
    const html = await renderSaved(locale, false);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h1 id="${labelledBy}"`);
    // The status region holds the title and the sentence, so both are announced on arrival.
    const status = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(status)).toContain(words.saved.title);
    expect(textOf(status)).toContain(words.saved.body);
  });

  it("adds the one acknowledging line only for the very first report", async () => {
    expect(textOf(await renderSaved(locale, true))).toContain(words.saved.first);
    expect(textOf(await renderSaved(locale, false))).not.toContain(words.saved.first);
  });

  it("offers one way on: back to Home", async () => {
    expect(hrefs(await renderSaved(locale, false))).toEqual(["/"]);
  });

  it("asks nothing, counts nothing and uses no emoji", async () => {
    const html = await renderSaved(locale, true);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(textOf(html)).not.toMatch(/\d|%|!/);
  });
});

describe.each(LOCALES)("the calm notices in %s", (locale) => {
  const words = catalogs[locale].food;

  it("QuietNotice: one h1, the quiet words, one link home, and no way to report anyway", async () => {
    intl.locale = locale;
    const html = renderWithIntl(await QuietNotice(), locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.quiet.title);
    expect(textOf(html)).toContain(words.quiet.body);
    expect(hrefs(html)).toEqual(["/"]);
    expect(textOf(html)).toContain(words.quiet.cta);
    expect(html).not.toContain("<form");
  });

  it("FlowUnavailable: one h1, a reassuring sentence and the way home", async () => {
    intl.locale = locale;
    const html = renderWithIntl(await FlowUnavailable(), locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.unavailable.title);
    expect(textOf(html)).toContain(words.unavailable.body);
    expect(hrefs(html)).toEqual(["/"]);
  });

  it("PhotoUnavailable: one h1 and a link to the writing screen", async () => {
    intl.locale = locale;
    const html = renderWithIntl(await PhotoUnavailable(), locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.photoUnavailable.title);
    expect(textOf(html)).toContain(words.photoUnavailable.body);
    expect(hrefs(html)).toEqual(["/report/food/text"]);
    expect(textOf(html)).toContain(words.photoUnavailable.writeInstead);
  });

  it("none of them scolds: no exclamation mark, no digit", async () => {
    intl.locale = locale;
    for (const view of [await QuietNotice(), await FlowUnavailable(), await PhotoUnavailable()]) {
      expect(textOf(renderWithIntl(view, locale))).not.toMatch(/!|\d/);
    }
  });
});
