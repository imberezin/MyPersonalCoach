// B5 as markup, with the real catalogs in both languages: the small experiment, offered or started.
import { createTranslator } from "use-intl/core";
import { describe, expect, it, vi } from "vitest";
import ui from "@/components/ui/ui.module.css";
import type { OpenExperiment } from "@/lib/experiments/repo";
import { ExperimentView, experimentTextFor } from "./ExperimentView";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";

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
const esc = (text: string) => text.replace(/'/g, "&#x27;");

const experiment = (over: Partial<OpenExperiment> = {}): OpenExperiment => ({
  id: "exp-1",
  status: "OFFERED",
  key: "eat_intentionally",
  variantId: "default",
  wording: "stored sentence",
  source: "library",
  locale: "he",
  ...over,
});

const stub = async () => {};

async function render(locale: TestLocale, over: { experiment?: OpenExperiment; text?: string; failed?: boolean } = {}): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(
    await ExperimentView({
      experiment: over.experiment ?? experiment(),
      text: over.text ?? "the sentence",
      failed: over.failed ?? false,
      startAction: stub,
      skipAction: stub,
    }),
    locale,
  );
}

describe.each(LOCALES)("ExperimentView in %s", (locale) => {
  const words = catalogs[locale].firstWeek.experiment;

  describe("offered", () => {
    it("has exactly one h1 that names the section, the lead, the sentence and the reassurance", async () => {
      const html = await render(locale);
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`<h1 id="${labelledBy}"`);
      const text = textOf(html);
      expect(text).toContain(words.title);
      expect(text).toContain(words.lead);
      expect(text).toContain("the sentence");
      expect(text).toContain(words.note);
      expect(text).not.toContain(words.activeTitle);
    });

    it("has two forms: I'll try (primary) and Not this time (secondary), each one real submit button, with nothing to forge", async () => {
      const html = await render(locale);
      const forms = Array.from(html.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g), (match) => match[1]);
      expect(forms).toHaveLength(2);
      const [start, skip] = forms;
      for (const form of forms) {
        expect(count(form, /<button\b/g)).toBe(1);
        expect(form).toContain('type="submit"');
        expect(form).not.toContain("<input");
      }
      expect(start).toContain(`>${esc(words.try)}</button>`);
      expect(start).toContain(ui.primary);
      expect(skip).toContain(`>${esc(words.notThisTime)}</button>`);
      expect(skip).toContain(ui.secondary);
    });

    it("renders the sentence as plain text at the body size: no quotation marks, no decoration, no origin shown", async () => {
      const html = await render(locale, { experiment: experiment({ source: "ai" }), text: "a plain sentence" });
      const element = /<p\b[^>]*data-wording-source="ai"[^>]*>([^<]*)<\/p>/.exec(html);
      expect(element?.[1]).toBe("a plain sentence");
      expect(html).not.toMatch(/<(?:em|strong|b|i|blockquote|q)\b/);
      // The origin is an attribute for tests and the manual run, never words on the screen.
      expect(textOf(html).toLowerCase()).not.toMatch(/\bai\b|library|ספרי|בינה/);
    });

    it("carries the stored origin as data-wording-source, for the library too", async () => {
      expect(await render(locale, { experiment: experiment({ source: "library" }) })).toContain('data-wording-source="library"');
    });

    it("escapes the wording: markup appears as text and never as markup", async () => {
      const html = await render(locale, { text: "<b>bold</b> <img src=x onerror=y>" });
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(html).not.toContain("<b>bold</b>");
      expect(html).not.toContain("<img");
    });

    it("adds one status note when a write failed, and none otherwise", async () => {
      const failed = await render(locale, { failed: true });
      expect(count(failed, /role="status"/g)).toBe(1);
      expect(textOf(failed)).toContain(catalogs[locale].firstWeek.problem.save);
      expect(count(await render(locale), /role="status"/g)).toBe(0);
    });

    it("has no link: the two choices are the only exits", async () => {
      expect(hrefs(await render(locale))).toEqual([]);
    });
  });

  describe("started", () => {
    const active = experiment({ status: "ACTIVE" });

    it("shows the started title and body with the sentence, and the way back, and no form", async () => {
      const html = await render(locale, { experiment: active });
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      const text = textOf(html);
      expect(text).toContain(words.activeTitle);
      expect(text).toContain(words.activeBody);
      expect(text).toContain("the sentence");
      expect(text).not.toContain(words.title);
      expect(text).not.toContain(words.note);
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<button");
      expect(hrefs(html)).toEqual(["/first-week"]);
      expect(text).toContain(words.back);
    });

    it("adds one status note when a write failed", async () => {
      expect(count(await render(locale, { experiment: active, failed: true }), /role="status"/g)).toBe(1);
    });
  });

  it("has no digit, no exclamation mark and no emoji", async () => {
    for (const status of ["OFFERED", "ACTIVE"] as const) {
      const html = await render(locale, { experiment: experiment({ status }), failed: true });
      expect(textOf(html).replace("the sentence", "")).not.toMatch(/\d|!/);
      expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("experimentTextFor", () => {
  const library = (locale: TestLocale) => {
    const t = createTranslator({ locale, messages: catalogs[locale] as never, namespace: "interventions" as never, timeZone: "UTC" });
    return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
  };

  it("shows the stored wording when it was written in the language the page is in", () => {
    expect(experimentTextFor(experiment({ locale: "he", wording: "stored" }), "he", library("he"))).toBe("stored");
    expect(experimentTextFor(experiment({ locale: "en", wording: "stored" }), "en", library("en"))).toBe("stored");
  });

  it("shows the library's approved sentence of the current language when the person switched language", () => {
    expect(experimentTextFor(experiment({ locale: "he", wording: "stored" }), "en", library("en"))).toBe(catalogs.en.interventions.eat_intentionally.default);
    expect(experimentTextFor(experiment({ locale: "en", wording: "stored" }), "he", library("he"))).toBe(catalogs.he.interventions.eat_intentionally.default);
  });

  it("substitutes the library's own parameters in the fallback sentence", () => {
    // delay's wording carries {delayMinutes}: the library's own number, never a placeholder on the screen.
    const text = experimentTextFor(experiment({ key: "delay", variantId: "default", locale: "he" }), "en", library("en"));
    expect(text).not.toMatch(/[{}]/);
    expect(text).toContain("10");
  });
});
