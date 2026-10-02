// The delete control as markup, with the real catalogs: the closed trigger, and the open panel rendered on its own (the
// open state is client state, so the panel is tested directly). The order, the names and the calm look are the point.
// The wiring (open, keep, focus, Esc) is in the two *.wiring.test.ts files.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ui from "@/components/ui/ui.module.css";
import { DeleteWeightControl, type DeleteWeightControlProps } from "./DeleteWeightControl";
import { DeleteWeightPanel } from "./DeleteWeightPanel";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./weightTestKit";

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const CURSOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const noop = async () => {};

const control = (locale: TestLocale, over: Partial<DeleteWeightControlProps> = {}) =>
  renderWithIntl(createElement(DeleteWeightControl, { entryId: ID, from: "list", action: noop, ...over }), locale);

/** The panel next to the element its description names, the way a list row holds them. */
function panel(locale: TestLocale, over: Partial<Parameters<typeof DeleteWeightPanel>[0]> = {}) {
  const props = { entryId: ID, from: "list" as const, action: noop, onKeep: () => {}, describedBy: "weight-row", ...over };
  return renderWithIntl(
    createElement("div", null, createElement("p", { id: "weight-row" }, "summary of the row"), createElement(DeleteWeightPanel, props)),
    locale,
  );
}

const buttons = (html: string) => Array.from(html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g), (match) => match[0]);

describe.each(LOCALES)("DeleteWeightControl (closed) in %s", (locale) => {
  const words = catalogs[locale].weight;

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

  it("reads 'Delete' in a list row and 'Delete this weight' on the Saved screen", () => {
    expect(textOf(control(locale, { from: "list" }))).toBe(words.row.delete);
    expect(textOf(control(locale, { from: "saved" }))).toBe(words.row.deleteThis);
  });

  it("describes the trigger by the row's text only when it is given one", () => {
    expect(control(locale, { describedBy: "weight-row" })).toContain('aria-describedby="weight-row"');
    expect(control(locale)).not.toContain("aria-describedby");
  });

  it("does not describe the trigger by the Saved summary (that node does not exist while the panel is closed)", () => {
    expect(control(locale, { from: "saved", summaryId: "weight-x", summary: createElement("p", { id: "weight-x" }, "x") })).not.toContain(
      "aria-describedby",
    );
  });
});

describe.each(LOCALES)("DeleteWeightPanel in %s", (locale) => {
  const words = catalogs[locale].weight;
  const html = panel(locale);

  it("is a labelled group, not an alert or a dialog", () => {
    const titleId = /<h2 id="([^"]+)"/.exec(html)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`role="group" aria-labelledby="${titleId}"`);
    expect(html).not.toMatch(/role="alert"|role="alertdialog"|role="dialog"|aria-modal|<dialog/);
  });

  it("names the weight it asks about: aria-describedby is the given id and that id exists in the same fragment", () => {
    expect(html).toContain('aria-describedby="weight-row"');
    expect(count(html, /id="weight-row"/g)).toBe(1);
  });

  it("has a heading that can take focus without being a tab stop", () => {
    expect(count(html, /<h2\b/g)).toBe(1);
    expect(html).toMatch(/<h2 id="[^"]+" tabindex="-1"/);
  });

  it("asks in plain words: the title, one honest sentence that says the average is worked out again, and the two answers", () => {
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

  it("posts the entry, where the delete started and the list's cursor, as hidden fields", () => {
    const fromSaved = panel(locale, { from: "saved", after: CURSOR });
    expect(fromSaved).toContain(`<input type="hidden" name="entryId" value="${ID}"/>`);
    expect(fromSaved).toContain('<input type="hidden" name="from" value="saved"/>');
    expect(fromSaved).toContain(`<input type="hidden" name="after" value="${CURSOR}"/>`);
    expect(html).toContain('<input type="hidden" name="from" value="list"/>');
    // No cursor: an empty field, which the action reads as the newest page.
    expect(html).toContain('<input type="hidden" name="after" value=""/>');
  });

  it("repeats the weight only when a summary is passed (the Saved screen), and not otherwise (the row shows it)", () => {
    expect(html).not.toContain("the saved summary");
    expect(panel(locale, { summary: createElement("p", null, "the saved summary") })).toContain("the saved summary");
  });

  it("uses no error or attention styling, and no exclamation mark: deleting your own weight is neither a mistake nor an alarm", () => {
    const classes = Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1]).join(" ");
    expect(classes).not.toMatch(/error|attention|accent|danger|warning/i);
    expect(textOf(html)).not.toContain("!");
  });
});

describe("the delete control reuses the meals reducer", () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

  it("imports its reducer and focus rules from @/components/meals/deleteConfirm, and does not copy them", () => {
    const controlSource = read("./DeleteWeightControl.tsx");
    expect(controlSource).toMatch(/from "@\/components\/meals\/deleteConfirm"/);
    expect(controlSource).toContain("deleteConfirmReducer");
    expect(controlSource).not.toMatch(/phase:\s*"confirming"/);
    expect(read("./DeleteWeightPanel.tsx")).toMatch(/import \{ escapeKeeps \} from "@\/components\/meals\/deleteConfirm"/);
  });

  it("imports no meal component: only the pure confirm helpers cross over", () => {
    for (const file of ["./DeleteWeightControl.tsx", "./DeleteWeightPanel.tsx", "./WeightRow.tsx", "./WeightsList.tsx", "./WeightSavedView.tsx"]) {
      const imports = Array.from(read(file).matchAll(/from "([^"]+)"/g), (match) => match[1]);
      for (const path of imports.filter((p) => p.startsWith("@/components/meals"))) expect(path, file).toBe("@/components/meals/deleteConfirm");
    }
  });
});
