// D7 as markup, with the real catalogs: one fieldset per food, real labels, unique ids, the hidden row
// count, the amount fields only for an exact amount, and the error summary with invalid fields marked.
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { EditError, EditFormState, EditFormValues } from "@/domain/food/edit";
import { EditForm } from "./EditForm";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./foodTestKit";

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const BACK = `/report/food/${ID}`;

const initial: EditFormValues = {
  rows: [
    { name: "שניצל", portion: "medium", amount: "", unit: "", orig: "0" },
    { name: "rice", portion: "amount", amount: "1.5", unit: "cup", orig: "1" },
    { name: "סלט", portion: "", amount: "", unit: "", orig: "2" },
  ],
  mealType: "lunch",
  day: "today",
  time: "13:30",
};

const action = async (): Promise<EditFormState> => null;

function render(locale: TestLocale, initialState: EditFormState = null): string {
  return renderWithIntl(createElement(EditForm, { id: ID, initial, action, backHref: BACK, initialState }), locale);
}

const errorState = (errors: EditError[], values: EditFormValues = initial): EditFormState => ({ status: "error", errors, values });

describe.each(LOCALES)("EditForm (D7) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("has exactly one h1 and the lead sentence", () => {
    const html = render(locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.edit.title);
    expect(textOf(html)).toContain(words.edit.lead);
  });

  it("renders one fieldset per food, each with a legend 'Food n' and a real label for the name", () => {
    const html = render(locale);
    expect(count(html, /<fieldset\b/g)).toBe(3);
    expect(count(html, /<legend\b/g)).toBe(3);
    for (const n of [1, 2, 3]) expect(textOf(html)).toContain(words.edit.foodLabel.replace("{n}", String(n)));
    for (const name of ["שניצל", "rice", "סלט"]) expect(html).toContain(`value="${name}"`);
  });

  it("gives every control a unique id, and every label points at an id that exists", () => {
    const html = render(locale);
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const labelTargets = Array.from(html.matchAll(/<label\b[^>]*for="([^"]+)"/g), (match) => match[1]);
    expect(labelTargets.length).toBeGreaterThanOrEqual(3 + 3 + 2 + 3);
    for (const target of labelTargets) expect(ids, target).toContain(target);
  });

  it("carries the report id and the row count as hidden fields, and the original index per row", () => {
    const html = render(locale);
    expect(html).toContain(`<input type="hidden" name="id" value="${ID}"/>`);
    expect(html).toContain('<input type="hidden" name="rowCount" value="3"/>');
    for (const [index, orig] of ["0", "1", "2"].entries()) {
      expect(html).toContain(`<input type="hidden" name="food_${index}_orig" value="${orig}"/>`);
    }
  });

  it("names the row fields the way the domain reads them", () => {
    const html = render(locale);
    for (const index of [0, 1, 2]) {
      expect(html).toContain(`name="food_${index}_name"`);
      expect(html).toContain(`name="food_${index}_portion"`);
    }
    for (const field of ["mealType", "day", "time"]) expect(html).toContain(`name="${field}"`);
  });

  it("shows the amount and unit fields only for the row whose portion is an exact amount", () => {
    const html = render(locale);
    expect(count(html, /name="food_\d+_amount"/g)).toBe(1);
    expect(html).toContain('name="food_1_amount"');
    expect(html).toContain('name="food_1_unit"');
    expect(html).toMatch(/<input[^>]*type="number"[^>]*inputMode="decimal"[^>]*name="food_1_amount"|<input[^>]*name="food_1_amount"[^>]*type="number"/);
  });

  it("marks the chosen portion, meal type and unit as selected", () => {
    const html = render(locale);
    expect(html).toMatch(/<option value="medium" selected="">/);
    expect(html).toMatch(/<option value="amount" selected="">/);
    expect(html).toMatch(/<option value="lunch" selected="">/);
    expect(html).toMatch(/<option value="cup" selected="">/);
    expect(html).toMatch(/<option value="today" selected="">/);
  });

  it("offers every meal type, a size list, and both days", () => {
    const html = render(locale);
    for (const type of ["breakfast", "lunch", "dinner", "snack", "other"]) expect(html).toContain(`<option value="${type}"`);
    for (const size of ["small", "medium", "large"]) expect(html).toContain(`<option value="${size}"`);
    expect(html).toContain('<option value="today"');
    expect(html).toContain('<option value="yesterday"');
    expect(html).not.toContain('<option value="other"><');
  });

  it("uses a native, left-to-right time control with the time filled in", () => {
    const html = render(locale);
    expect(html).toMatch(/<input[^>]*type="time"/);
    const time = /<input[^>]*type="time"[^>]*>/.exec(html)?.[0] ?? "";
    expect(time).toContain('dir="ltr"');
    expect(time).toContain('value="13:30"');
  });

  it("gives each Remove button an accessible name that includes the food", () => {
    const html = render(locale);
    expect(count(html, /aria-label="/g)).toBe(3);
    expect(html).toContain(`aria-label="${words.edit.removeFor.replace("{food}", "שניצל")}"`);
    expect(html).toContain(`aria-label="${words.edit.removeFor.replace("{food}", "rice")}"`);
    expect(textOf(html)).toContain(words.edit.remove);
  });

  it("keeps the visible Remove word at the start of the accessible name (WCAG 2.5.3, voice control)", () => {
    const html = render(locale);
    const names = Array.from(html.matchAll(/aria-label="([^"]+)"/g), (match) => match[1]);
    expect(names).toHaveLength(3);
    for (const name of names) expect(name.startsWith(words.edit.remove), name).toBe(true);
  });

  it("puts Save (a submit button) before the Cancel link, and Add a food in between as a plain button", () => {
    const html = render(locale);
    expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${words.edit.add}</button>`));
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${words.edit.save}</button>`));
    expect(html.indexOf(`>${words.edit.save}</button>`)).toBeLessThan(html.indexOf(`href="${BACK}"`));
    expect(textOf(html)).toContain(words.edit.cancel);
    // Cancel writes nothing: it is a link, not a submit.
    expect(count(html, /<a\b[^>]*href=/g)).toBe(1);
  });

  it("has no error summary and no invalid field before anything was refused", () => {
    const html = render(locale);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
    expect(textOf(html)).not.toContain(words.edit.errorsTitle);
  });

  it("shows a focusable alert summary, links to the fields and marks them invalid after a refused save", () => {
    const state = errorState([
      { code: "amount_invalid", row: 1, field: "amount" },
      { code: "time_future", field: "time" },
    ]);
    const html = render(locale, state);
    const summary = /<div[^>]*role="alert"[^>]*>([^]*?)<\/ul>/.exec(html);
    expect(summary).not.toBeNull();
    expect(summary?.[0]).toContain('tabindex="-1"');
    expect(textOf(summary?.[1] ?? "")).toContain(words.edit.errorsTitle);
    expect(textOf(summary?.[1] ?? "")).toContain(words.edit.errors.amount_invalid);
    expect(textOf(summary?.[1] ?? "")).toContain(words.edit.errors.time_future);

    // Each summary link points at a field that exists.
    const targets = Array.from((summary?.[0] ?? "").matchAll(/href="#([^"]+)"/g), (match) => match[1]);
    expect(targets).toHaveLength(2);
    for (const target of targets) expect(html, target).toContain(`id="${target}"`);

    // The two fields are invalid and described by their own message.
    expect(count(html, /aria-invalid="true"/g)).toBe(2);
    const amountField = /<input[^>]*name="food_1_amount"[^>]*>/.exec(html)?.[0] ?? "";
    const describedBy = /aria-describedby="([^"]+)"/.exec(amountField)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("keeps what was typed when the save is refused", () => {
    const typed: EditFormValues = { ...initial, rows: [{ ...initial.rows[0], name: "typed name" }, initial.rows[1]], time: "09:15" };
    const html = render(locale, errorState([{ code: "time_invalid", field: "time" }], typed));
    expect(html).toContain('value="typed name"');
    expect(html).toContain('value="09:15"');
    expect(html).toContain('<input type="hidden" name="rowCount" value="2"/>');
  });

  it("points an error about the list as a whole at the Add button", () => {
    const html = render(locale, errorState([{ code: "no_items" }]));
    const target = /href="#([^"]+)"/.exec(html)?.[1];
    const addTag = new RegExp(`<button[^>]*id="${target}"[^>]*>${words.edit.add}</button>`);
    expect(html).toMatch(addTag);
  });

  it("says calmly that nothing was saved when the save itself failed, and keeps what was typed", () => {
    const html = render(locale, errorState([{ code: "not_saved" }]));
    const summary = /<div[^>]*role="alert"[^>]*>([^]*?)<\/ul>/.exec(html);
    expect(summary).not.toBeNull();
    expect(textOf(summary?.[1] ?? "")).toContain(words.edit.errors.not_saved);
    // No field is blamed.
    expect(html).not.toContain("aria-invalid");
  });

  it("is calm: no exclamation mark and no emoji", () => {
    const html = render(locale, errorState([{ code: "no_items" }, { code: "time_too_old", field: "time" }]));
    expect(textOf(html)).not.toContain("!");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
