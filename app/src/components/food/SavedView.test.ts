// D8 and the three calm notices (quiet, unavailable, photo off), as markup with the real catalogs.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MealSummaryProps } from "@/components/meals/buildSummary";
import { DeleteMealControl } from "@/components/meals/DeleteMealControl";
import type { Acknowledgement } from "@/domain/firstWeekFlow";
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

const NONE: Acknowledgement = { kind: "none" };
const FIRST: Acknowledgement = { kind: "first" };
const ROTATING = [0, 1, 2].map((index) => ({ kind: "rotating", index }) as Acknowledgement);

async function renderSaved(locale: TestLocale, acknowledgement: Acknowledgement, withDeletion = false): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(await SavedView({ acknowledgement, followUp: { kind: "none" }, deletion: withDeletion ? deletion : null }), locale);
}

describe.each(LOCALES)("SavedView (D8) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("has exactly one h1 that names the section, and announces the confirmation as a status", async () => {
    const html = await renderSaved(locale, NONE);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h1 id="${labelledBy}"`);
    // The status region holds the title and the sentence, so both are announced on arrival.
    const status = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(status)).toContain(words.saved.title);
    expect(textOf(status)).toContain(words.saved.body);
  });

  // The acknowledgement table: what each kind shows, and that it never shows two lines.
  const rotating = catalogs[locale].firstWeek.ack.rotating as Record<string, string>;
  const lines = [words.saved.first, rotating["0"], rotating["1"], rotating["2"]];

  it("shows no extra line for `none`", async () => {
    const text = textOf(await renderSaved(locale, NONE));
    for (const line of lines) expect(text).not.toContain(line);
  });

  it("shows the warm B2 line, and only it, for `first`", async () => {
    const text = textOf(await renderSaved(locale, FIRST));
    expect(text).toContain(words.saved.first);
    for (const line of lines.slice(1)) expect(text).not.toContain(line);
  });

  it.each([0, 1, 2])("shows rotating line %i, and only it, for `rotating`", async (index) => {
    const text = textOf(await renderSaved(locale, ROTATING[index]));
    expect(text).toContain(lines[index + 1]);
    expect(lines.filter((line) => text.includes(line))).toEqual([lines[index + 1]]);
  });

  it("puts the line inside the status region, so it is announced with the confirmation (at most one extra line)", async () => {
    for (const acknowledgement of [FIRST, ...ROTATING]) {
      const html = await renderSaved(locale, acknowledgement);
      const status = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "";
      expect(count(status, /<p[\s>]/g), JSON.stringify(acknowledgement)).toBe(2);
    }
    const plain = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(await renderSaved(locale, NONE))?.[1] ?? "";
    expect(count(plain, /<p[\s>]/g)).toBe(1);
  });

  it("offers one way on: back to Home", async () => {
    expect(hrefs(await renderSaved(locale, NONE))).toEqual(["/"]);
  });

  it("asks nothing, counts nothing and uses no emoji", async () => {
    const html = await renderSaved(locale, FIRST);
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
    const tree = await SavedView({ acknowledgement: NONE, followUp: { kind: "none" }, deletion });
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
    const tree = await SavedView({ acknowledgement: NONE, followUp: { kind: "none" }, deletion: null });
    expect(findElement(tree, DeleteMealControl)).toBeNull();
  });
});

describe.each(LOCALES)("SavedView (D8) delete control in %s", (locale) => {
  const meals = catalogs[locale].meals;

  it("adds nothing when there is no meal to name", async () => {
    expect(await renderSaved(locale, NONE, false)).not.toMatch(/<button|<form|role="group"/);
  });

  it("adds one quiet 'Delete this meal' button, after the Back link", async () => {
    const html = await renderSaved(locale, NONE, true);
    expect(count(html, /<button\b/g)).toBe(1);
    expect(html).toContain(`>${meals.row.deleteThis}</button>`);
    expect(html.indexOf('href="/"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="/"')).toBeLessThan(html.indexOf("<button"));
    expect(hrefs(html)).toEqual(["/"]);
  });

  it("keeps the control outside the status block, so the arrival announcement is unchanged", async () => {
    const withControl = await renderSaved(locale, FIRST, true);
    const status = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(withControl)?.[1] ?? "";
    expect(status).not.toContain("<button");
    const without = await renderSaved(locale, FIRST, false);
    const plain = /<div role="status"[^>]*>([^]*?)<\/div>/.exec(without)?.[1] ?? "";
    expect(status).toBe(plain);
  });

  it("has no meal summary and no question until the button is pressed", async () => {
    const html = await renderSaved(locale, NONE, true);
    expect(html).not.toContain(summary.whenText);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("<form");
  });

  it("still has exactly one h1", async () => {
    expect(count(await renderSaved(locale, NONE, true), /<h1[\s>]/g)).toBe(1);
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
