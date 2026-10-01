// The delete control as markup, with the real catalogs: the closed trigger, and the open panel rendered on its
// own (the open state is client state, so the panel is tested directly). The order, the names and the calm
// look are the point.
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ui from "@/components/ui/ui.module.css";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";
import { DeleteMealControl, type DeleteMealControlProps } from "./DeleteMealControl";
import { DeleteMealPanel } from "./DeleteMealPanel";

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const noop = async () => {};

const control = (locale: TestLocale, over: Partial<DeleteMealControlProps> = {}) =>
  renderWithIntl(createElement(DeleteMealControl, { entryId: ID, from: "list", action: noop, ...over }), locale);

/** The panel next to the element its description names, the way a list row holds them. */
function panel(locale: TestLocale, over: Partial<Parameters<typeof DeleteMealPanel>[0]> = {}) {
  const props = { entryId: ID, from: "list" as const, action: noop, onKeep: () => {}, describedBy: "meal-row", ...over };
  return renderWithIntl(
    createElement("div", null, createElement("p", { id: "meal-row" }, "summary of the row"), createElement(DeleteMealPanel, props)),
    locale,
  );
}

const buttons = (html: string) => Array.from(html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g), (match) => match[0]);

describe.each(LOCALES)("DeleteMealControl (closed) in %s", (locale) => {
  const words = catalogs[locale].meals;

  it("is one quiet button and nothing else", () => {
    const html = control(locale);
    expect(count(html, /<button\b/g)).toBe(1);
    expect(html).toMatch(/<button type="button"/);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("<h2");
    expect(textOf(html)).toBe(words.row.delete);
  });

  it("is the tertiary look", () => {
    expect(control(locale)).toContain(`class="${ui.button} ${ui.tertiary}"`);
  });

  it("reads 'Delete' in a list row and 'Delete this meal' on the Saved screen", () => {
    expect(textOf(control(locale, { from: "list" }))).toBe(words.row.delete);
    expect(textOf(control(locale, { from: "saved" }))).toBe(words.row.deleteThis);
  });

  it("describes the trigger by the row's summary only when it is given one", () => {
    expect(control(locale, { describedBy: "meal-row" })).toContain('aria-describedby="meal-row"');
    expect(control(locale)).not.toContain("aria-describedby");
  });

  it("does not describe the trigger by the Saved summary (that node does not exist while the panel is closed)", () => {
    expect(control(locale, { from: "saved", summaryId: "meal-x", summary: createElement("p", { id: "meal-x" }, "x") })).not.toContain(
      "aria-describedby",
    );
  });

  it("has no tabindex, no ref artefact and no icon", () => {
    const html = control(locale);
    expect(html).not.toContain("tabindex");
    expect(html).not.toMatch(/<svg|<img/);
  });
});

describe.each(LOCALES)("DeleteMealPanel in %s", (locale) => {
  const words = catalogs[locale].meals;
  const html = panel(locale);

  it("is a labelled group, not an alert or a dialog", () => {
    const titleId = /<h2 id="([^"]+)"/.exec(html)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`role="group" aria-labelledby="${titleId}"`);
    expect(html).not.toMatch(/role="alert"|role="alertdialog"|role="dialog"|aria-modal|<dialog/);
  });

  it("names the meal it asks about: aria-describedby is the given id and that id exists in the same fragment", () => {
    expect(html).toContain('aria-describedby="meal-row"');
    expect(count(html, /id="meal-row"/g)).toBe(1);
  });

  it("leaves the description out when none is given", () => {
    expect(panel(locale, { describedBy: undefined })).not.toContain("aria-describedby");
  });

  it("has a heading that can take focus without being a tab stop", () => {
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(html).toMatch(/<h2 id="[^"]+" tabindex="-1"/);
  });

  it("asks in plain words: the title, one honest sentence, and the two answers", () => {
    const text = textOf(html);
    expect(text).toContain(words.confirm.title);
    expect(text).toContain(words.confirm.body);
    expect(text).toContain(words.confirm.keep);
    expect(text).toContain(words.confirm.delete);
  });

  it("puts the safe answer first and primary, and Delete second and secondary", () => {
    const [keep, remove, ...rest] = buttons(html);
    expect(rest).toEqual([]);
    expect(keep).toContain(words.confirm.keep);
    expect(remove).toContain(words.confirm.delete);
    expect(html.indexOf(keep)).toBeLessThan(html.indexOf(remove));
    expect(keep).toMatch(/type="button"/);
    expect(keep).toContain(`class="${ui.button} ${ui.primary}"`);
    expect(remove).toMatch(/type="submit"/);
    expect(remove).toContain(`class="${ui.button} ${ui.secondary}"`);
  });

  it("leaves both answers enabled until the form is sent", () => {
    for (const button of buttons(html)) expect(button).not.toContain("disabled");
  });

  it("posts the meal, where the delete started and the page size, as hidden fields", () => {
    const withPages = panel(locale, { from: "saved", pages: 3 });
    expect(withPages).toContain(`<input type="hidden" name="entryId" value="${ID}"/>`);
    expect(withPages).toContain('<input type="hidden" name="from" value="saved"/>');
    expect(withPages).toContain('<input type="hidden" name="pages" value="3"/>');
    expect(html).toContain('<input type="hidden" name="from" value="list"/>');
    expect(html).not.toContain('name="pages"');
  });

  it("repeats the meal only when a summary is passed (the Saved screen), and not otherwise (the row shows it)", () => {
    expect(html).not.toContain("the saved summary");
    expect(panel(locale, { summary: createElement("p", null, "the saved summary") })).toContain("the saved summary");
  });

  it("uses no error or attention styling, and no exclamation mark", () => {
    const classes = Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1]).join(" ");
    expect(classes).not.toMatch(/error|attention|accent|danger|warning/i);
    expect(textOf(html)).not.toContain("!");
  });
});
