// D6 as markup, with the real catalogs in both languages: the foods, "Maybe" as text, the estimate note,
// the three actions in order, and nothing that scores or counts.
import { describe, expect, it, vi } from "vitest";
import type { ConfirmView } from "@/domain/food/view";
import { ConfirmScreen } from "./ConfirmScreen";
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

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";

const view = (over: Partial<ConfirmView> = {}): ConfirmView => ({
  id: ID,
  manual: false,
  fake: false,
  items: [
    { name: "שניצל", portion: { kind: "size", size: "medium", estimated: true }, uncertain: false },
    { name: "rice", portion: { kind: "amount", amount: 1, unit: "cup", estimated: true }, uncertain: true },
    { name: "סלט", portion: null, uncertain: false },
  ],
  unclear: [],
  anyEstimated: true,
  mealType: "lunch",
  day: "today",
  time: "13:30",
  revision: "a1b2c3d4",
  ...over,
});

async function render(
  locale: TestLocale,
  props: { view?: ConfirmView; refreshed?: boolean; failed?: boolean } = {},
): Promise<string> {
  intl.locale = locale;
  const screen = await ConfirmScreen({
    view: props.view ?? view(),
    refreshed: props.refreshed ?? false,
    failed: props.failed,
    confirmAction: async () => {},
    discardAction: async () => {},
  });
  return renderWithIntl(screen, locale);
}

describe.each(LOCALES)("ConfirmScreen (D6) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("has exactly one h1, and the section is named by it", async () => {
    const html = await render(locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h1 id="${labelledBy}"`);
    expect(textOf(html)).toContain(words.confirm.title);
  });

  it("lists the foods in a real list, with bdi so a foreign name keeps its direction", async () => {
    const html = await render(locale);
    expect(count(html, /<ul\b/g)).toBe(1);
    // list-style: none drops the list in Safari and VoiceOver unless the role is explicit.
    expect(html).toMatch(/<ul[^>]*role="list"/);
    expect(count(html, /<li\b/g)).toBe(3);
    expect(html).toContain("<bdi");
    expect(html).toMatch(/<bdi[^>]*>rice<\/bdi>/);
  });

  it("prints 'about' for an estimated amount, never for a size, and nothing for no portion", async () => {
    const text = textOf(await render(locale));
    expect(text).toContain(locale === "he" ? "בערך 1 כוס" : "about 1 cup");
    expect(text).toContain(locale === "he" ? "מנה בינונית" : "medium portion");
    expect(text).not.toContain(locale === "he" ? "בערך מנה" : "about medium");
  });

  it("marks an uncertain food with the word 'Maybe', as text, and only that one", async () => {
    const html = await render(locale);
    expect(count(html, new RegExp(`>${words.confirm.maybe}<`, "g"))).toBe(1);
    const riceItem = /<li[^>]*>[^]*?rice[^]*?<\/li>/.exec(html)?.[0] ?? "";
    expect(riceItem).toContain(`>${words.confirm.maybe}<`);
  });

  it("adds the estimate note only when some portion was estimated", async () => {
    expect(textOf(await render(locale))).toContain(words.confirm.estimateNote);
    const plain = view({ anyEstimated: false, items: [{ name: "bread", portion: null, uncertain: false }] });
    expect(textOf(await render(locale, { view: plain }))).not.toContain(words.confirm.estimateNote);
  });

  it("lists what could not be understood, with a hint, only when there is something", async () => {
    const text = textOf(await render(locale, { view: view({ unclear: ["the red thing"] }) }));
    expect(text).toContain(words.confirm.unclearTitle);
    expect(text).toContain("the red thing");
    expect(text).toContain(words.confirm.unclearHint);
    expect(textOf(await render(locale))).not.toContain(words.confirm.unclearTitle);
  });

  it("says meal, day and time in one line, with the time isolated from the right-to-left text", async () => {
    const html = await render(locale);
    expect(html).toContain("⁦13:30⁩");
    const text = textOf(html);
    expect(text).toContain(locale === "he" ? "ארוחת צהריים · היום" : "Lunch · today at");
    expect(textOf(await render(locale, { view: view({ day: "yesterday" }) }))).toContain(locale === "he" ? "אתמול" : "yesterday");
    // A meal from earlier than yesterday names no day.
    const other = textOf(await render(locale, { view: view({ day: "other" }) }));
    expect(other).not.toContain(words.day.today);
    expect(other).not.toContain(words.day.yesterday);
  });

  it("puts Save first, then the fix link, then Not now", async () => {
    const html = await render(locale);
    const save = html.indexOf(`>${words.confirm.save}</button>`);
    const fix = html.indexOf(`href="/report/food/${ID}/edit"`);
    const notNow = html.indexOf(`>${words.confirm.notNow}</button>`);
    expect(save).toBeGreaterThan(0);
    expect(save).toBeLessThan(fix);
    expect(fix).toBeLessThan(notNow);
    expect(textOf(html)).toContain(words.confirm.fix);
  });

  it("makes Save a submit button, the fix an <a>, and Not now a submit button tied to the discard form", async () => {
    const html = await render(locale);
    expect(html).toMatch(new RegExp(`<button\\b[^>]*type="submit"[^>]*>${words.confirm.save}</button>`));
    expect(html).toMatch(new RegExp(`<a\\b[^>]*href="/report/food/${ID}/edit"`));
    expect(count(html, /<a\b/g)).toBe(1);
    const notNowTag = new RegExp(`<button\\b[^>]*>(?=${words.confirm.notNow}</button>)`).exec(html)?.[0] ?? "";
    expect(notNowTag).toContain('type="submit"');
    expect(notNowTag).toContain('form="confirm-discard"');
  });

  it("carries only the report's id and the revision of what is shown, not the foods or the time", async () => {
    const html = await render(locale);
    const confirmForm = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(confirmForm).toContain(`<input type="hidden" name="id" value="${ID}"/>`);
    expect(confirmForm).toContain('<input type="hidden" name="revision" value="a1b2c3d4"/>');
    expect(count(confirmForm, /<input\b/g)).toBe(2);
  });

  it("discards through its own form, after the confirm form (forms never nest), with the confirm stage", async () => {
    const html = await render(locale);
    expect(count(html, /<form\b/g)).toBe(2);
    const discardForm = html.slice(html.indexOf('<form id="confirm-discard"'));
    expect(discardForm).toContain(`name="id" value="${ID}"`);
    expect(discardForm).toContain('name="stage" value="confirm"');
    // The first form closes before the second opens.
    expect(html.indexOf("</form>")).toBeLessThan(html.indexOf('<form id="confirm-discard"'));
  });

  it("shows the manual title and note for a report kept as a list, and not for an AI one", async () => {
    const manual = textOf(await render(locale, { view: view({ manual: true }) }));
    expect(manual).toContain(words.confirm.titleManual);
    expect(manual).toContain(words.confirm.manualNote);
    const ai = textOf(await render(locale));
    expect(ai).not.toContain(words.confirm.manualNote);
    expect(ai).not.toContain(words.confirm.titleManual);
  });

  it("says plainly that a fake result is a test", async () => {
    expect(textOf(await render(locale, { view: view({ fake: true }) }))).toContain(words.confirm.fakeNote);
    expect(textOf(await render(locale))).not.toContain(words.confirm.fakeNote);
  });

  it("shows the 'updated' note only after a stale-revision bounce, in a status region", async () => {
    const refreshed = await render(locale, { refreshed: true });
    expect(refreshed).toMatch(/<p[^>]*role="status"[^>]*>[^<]*<\/p>/);
    expect(textOf(refreshed)).toContain(words.confirm.refreshed);
    expect(textOf(await render(locale))).not.toContain(words.confirm.refreshed);
  });

  it("says plainly that the save did not go through only after a failed save, as an alert", async () => {
    const failed = await render(locale, { failed: true });
    expect(failed).toMatch(/<p[^>]*role="alert"[^>]*>[^<]*<\/p>/);
    expect(textOf(failed)).toContain(words.confirm.notSaved);
    expect(textOf(failed)).not.toContain("!");
    expect(textOf(await render(locale))).not.toContain(words.confirm.notSaved);
  });

  it("has no score, percentage, calorie or emoji, and no number besides amounts and the time", async () => {
    const html = await render(locale);
    const text = textOf(html);
    expect(text).not.toMatch(/%|kcal|score|calorie|קלורי|ציון|אחוז/i);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    // Digits appear only in the amount and the time.
    expect(text.replace(/1 כוס|1 cup|13:30/g, "")).not.toMatch(/\d/);
  });
});
