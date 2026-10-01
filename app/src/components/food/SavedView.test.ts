// D8 and the three calm notices (quiet, unavailable, photo off), as markup with the real catalogs.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MealSummaryProps } from "@/components/meals/buildSummary";
import { DeleteMealControl } from "@/components/meals/DeleteMealControl";
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

const summary: MealSummaryProps = {
  id: "meal-0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718",
  whenText: "summary when line",
  foods: [{ kind: "food", text: "summary food" }],
  moreText: null,
  emptyText: null,
};
const deletion = { entryId: "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718", summary, action: async () => {} };

async function renderSaved(locale: TestLocale, firstReport: boolean, withDeletion = false): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(await SavedView({ firstReport, followUp: { kind: "none" }, deletion: withDeletion ? deletion : null }), locale);
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

/** The first element of `type` in a tree that has not been rendered. */
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === type ? node : findElement(node.props.children as ReactNode, type);
}

describe("SavedView (D8) hands the delete control what the open panel needs", () => {
  it("the meal's id, the Saved origin, the action, and the summary that its own id names", async () => {
    intl.locale = "he";
    const tree = await SavedView({ firstReport: false, followUp: { kind: "none" }, deletion });
    const control = findElement(tree, DeleteMealControl);
    expect(control).not.toBeNull();
    expect(control?.props.entryId).toBe(deletion.entryId);
    expect(control?.props.from).toBe("saved");
    expect(control?.props.action).toBe(deletion.action);
    expect(control?.props.summaryId).toBe(summary.id);
    // The summary is the element the panel repeats: MealSummary for this very meal.
    const shown = control?.props.summary as ReactElement<{ summary: MealSummaryProps }>;
    expect(isValidElement(shown)).toBe(true);
    expect(shown.props.summary).toBe(summary);
    // The Saved screen has no list size to keep and no outside description.
    expect(control?.props.pages).toBeUndefined();
    expect(control?.props.describedBy).toBeUndefined();
  });

  it("renders no control at all without a meal", async () => {
    intl.locale = "he";
    const tree = await SavedView({ firstReport: false, followUp: { kind: "none" }, deletion: null });
    expect(findElement(tree, DeleteMealControl)).toBeNull();
  });
});

describe.each(LOCALES)("SavedView (D8) delete control in %s", (locale) => {
  const meals = catalogs[locale].meals;

  it("adds nothing when there is no meal to name", async () => {
    expect(await renderSaved(locale, false, false)).not.toMatch(/<button|<form|role="group"/);
  });

  it("adds one quiet 'Delete this meal' button, after the Back link", async () => {
    const html = await renderSaved(locale, false, true);
    expect(count(html, /<button\b/g)).toBe(1);
    expect(html).toContain(`>${meals.row.deleteThis}</button>`);
    expect(html.indexOf('href="/"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="/"')).toBeLessThan(html.indexOf("<button"));
    expect(hrefs(html)).toEqual(["/"]);
  });

  it("keeps the control outside the status block, so the arrival announcement is unchanged", async () => {
    const withControl = await renderSaved(locale, true, true);
    const status = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(withControl)?.[1] ?? "";
    expect(status).not.toContain("<button");
    const without = await renderSaved(locale, true, false);
    const plain = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(without)?.[1] ?? "";
    expect(status).toBe(plain);
  });

  it("has no meal summary and no question until the button is pressed", async () => {
    const html = await renderSaved(locale, false, true);
    expect(html).not.toContain(summary.whenText);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("<form");
  });

  it("still has exactly one h1", async () => {
    expect(count(await renderSaved(locale, false, true), /<h1[\s>]/g)).toBe(1);
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
