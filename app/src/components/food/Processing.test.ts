// D5 (the processing panel) and the problem panel, as markup with the real catalogs.
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PROBLEM_REASONS, type ProblemReason } from "@/domain/food/analyzeTypes";
import { AnalyzeProblem } from "./AnalyzeProblem";
import { ProcessingPanel } from "./ProcessingPanel";
import { PHOTO_BODY_REASONS } from "./client/problemActions";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./foodTestKit";

const noop = () => {};

const processing = (locale: TestLocale, props: { slow?: boolean; onWriteInstead?: () => void } = {}) =>
  renderWithIntl(createElement(ProcessingPanel, { slow: props.slow ?? false, onCancel: noop, onWriteInstead: props.onWriteInstead }), locale);

const problem = (
  locale: TestLocale,
  reason: ProblemReason,
  flow: "photo" | "text" | "manual",
  over: { onSaveAsWritten?: () => void } = {},
) =>
  renderWithIntl(
    createElement(AnalyzeProblem, { reason, flow, onRetry: noop, onSaveAsWritten: over.onSaveAsWritten, writeInsteadHref: "/report/food/text" }),
    locale,
  );

describe.each(LOCALES)("ProcessingPanel in %s", (locale) => {
  const words = catalogs[locale].food.processing;

  it("has the live region in the page from the first render, with the title inside it", () => {
    const html = processing(locale);
    expect(html).toMatch(/<div role="status" aria-live="polite"/);
    const region = /<div role="status" aria-live="polite"[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(region)).toContain(words.title);
  });

  it("makes the title focusable so the new state is announced once, and hides the dot from assistive technology", () => {
    const html = processing(locale);
    expect(html).toMatch(/<h2[^>]*tabindex="-1"/);
    expect(html).toMatch(/<span[^>]*aria-hidden="true"/);
  });

  it("always offers Cancel", () => {
    expect(textOf(processing(locale))).toContain(words.cancel);
    expect(textOf(processing(locale, { slow: true }))).toContain(words.cancel);
    expect(count(processing(locale), /<button\b/g)).toBe(1);
  });

  it("adds the long-wait line to the same region only when it is slow", () => {
    expect(textOf(processing(locale))).not.toContain(words.slow);
    const slow = processing(locale, { slow: true, onWriteInstead: noop });
    const region = /<div role="status" aria-live="polite"[^>]*>([^]*?)<\/div>/.exec(slow)?.[1] ?? "";
    expect(textOf(region)).toContain(words.slow);
  });

  it("never offers writing instead in the long-wait line of a screen that has no such button", () => {
    const region = (html: string) => textOf(/<div role="status" aria-live="polite"[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "");
    const text = region(processing(locale, { slow: true }));
    expect(text).toContain(words.slowText);
    expect(text).not.toContain(words.slow);
    // The photo screen has the button, so it keeps the line that mentions it.
    const photo = region(processing(locale, { slow: true, onWriteInstead: noop }));
    expect(photo).toContain(words.slow);
    expect(photo).not.toContain(words.slowText);
  });

  it("offers a 'write instead' button only when it is slow and the screen provides it", () => {
    expect(count(processing(locale, { slow: true, onWriteInstead: noop }), /<button/g)).toBe(2);
    expect(count(processing(locale, { slow: true }), /<button/g)).toBe(1);
    expect(count(processing(locale, { slow: false, onWriteInstead: noop }), /<button/g)).toBe(1);
  });
});

describe.each(LOCALES)("AnalyzeProblem in %s", (locale) => {
  const words = catalogs[locale].food.problem;
  const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);

  it.each(PROBLEM_REASONS)("%s shows its own title and body", (reason) => {
    const text = textOf(problem(locale, reason, "text"));
    const entry = words[reason] as { title: string; body: string };
    expect(text).toContain(entry.title);
    expect(text).toContain(entry.body);
  });

  it("uses the photo body, and only for the three reasons that have one, in the photo flow", () => {
    for (const reason of PHOTO_BODY_REASONS) {
      const entry = words[reason as "ai_unavailable" | "daily_cap" | "rate_limited"];
      expect(textOf(problem(locale, reason, "photo"))).toContain(entry.bodyPhoto);
      expect(textOf(problem(locale, reason, "photo"))).not.toContain(entry.body);
      expect(textOf(problem(locale, reason, "text"))).toContain(entry.body);
      expect(textOf(problem(locale, reason, "text"))).not.toContain(entry.bodyPhoto);
    }
    // Any other reason has one body, for every flow.
    expect(textOf(problem(locale, "ai_error", "photo"))).toContain(words.ai_error.body);
  });

  it("is an alert only for the technical save problem; the rest are calm status information", () => {
    for (const reason of PROBLEM_REASONS) {
      const html = problem(locale, reason, "text");
      expect(html).toContain(reason === "save_error" ? 'role="alert"' : 'role="status"');
      expect(html).not.toContain(reason === "save_error" ? 'role="status"' : 'role="alert"');
    }
  });

  it("makes the heading focusable and is the only thing named h2 there", () => {
    const html = problem(locale, "ai_error", "text");
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(html).toMatch(/<h2[^>]*tabindex="-1"/);
  });

  it("after a dropped connection puts Check (a link to the chooser) before Try again", () => {
    const html = problem(locale, "network", "text");
    expect(hrefs(html)).toEqual(["/report/food"]);
    expect(html.indexOf(words.action.checkPending)).toBeLessThan(html.indexOf(words.action.retry));
    // Check is the primary button.
    expect(html).toMatch(new RegExp(`<a[^>]*_primary[^>]*>${words.action.checkPending}</a>`));
  });

  it("offers 'write instead' as a link to the writing screen in the photo flow", () => {
    const html = problem(locale, "daily_cap", "photo");
    expect(hrefs(html)).toEqual(["/report/food/text"]);
    expect(textOf(html)).toContain(words.action.writeInstead);
    expect(textOf(html)).not.toContain(words.action.saveAsWritten);
  });

  it("offers 'keep it as I wrote it' as a button in the text flow, and drops it without a handler", () => {
    const withHandler = problem(locale, "ai_unavailable", "text", { onSaveAsWritten: noop });
    expect(count(withHandler, /<button\b/g)).toBe(1);
    expect(textOf(withHandler)).toContain(words.action.saveAsWritten);
    expect(textOf(problem(locale, "ai_unavailable", "text"))).not.toContain(words.action.saveAsWritten);
  });

  it("sends a signed-out person to the sign-in page", () => {
    expect(hrefs(problem(locale, "not_signed_in", "text"))).toEqual(["/login"]);
  });

  it("never blames the person or the photo: no exclamation mark, no scolding words", () => {
    for (const reason of PROBLEM_REASONS) {
      for (const flow of ["photo", "text", "manual"] as const) {
        expect(textOf(problem(locale, reason, flow))).not.toMatch(/!|failed|נכשל|wrong|שגיאה/i);
      }
    }
  });
});
