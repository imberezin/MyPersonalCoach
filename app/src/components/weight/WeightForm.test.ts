// The weight screen as markup, with the real catalogs: one number with a real label, the unit as text, the native day
// list, the note, the hidden id, the replies after a refused save and the "is that right?" step.
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { DayChoice } from "./WeightForm";
import { WeightForm } from "./WeightForm";
import type { WeightFormState, WeightFormValues } from "@/domain/weight";
import { LOCALES, catalogs, count, renderWithIntl, tagWith, textOf, type TestLocale } from "./weightTestKit";

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";

const options: DayChoice[] = [
  { value: "now", label: "NOW-LABEL" },
  { value: "2026-09-30", label: "YESTERDAY-LABEL" },
  { value: "2026-09-29", label: "TUESDAY-LABEL" },
];
const editOptions: DayChoice[] = [{ value: "keep", label: "KEEP-LABEL" }, ...options.slice(1)];

const action = async (): Promise<WeightFormState> => null;
const newInitial = { weight: "", day: "now", note: "" };

function render(locale: TestLocale, over: { mode?: "new" | "edit"; initialState?: WeightFormState; initial?: typeof newInitial } = {}): string {
  const mode = over.mode ?? "new";
  return renderWithIntl(
    createElement(WeightForm, {
      mode,
      id: ID,
      options: mode === "edit" ? editOptions : options,
      initial: over.initial ?? (mode === "edit" ? { weight: "118.7", day: "keep", note: "a note" } : newInitial),
      action,
      backHref: mode === "edit" ? "/me/weights" : "/",
      initialState: over.initialState ?? null,
    }),
    locale,
  );
}

const values = (over: Partial<WeightFormValues> = {}): WeightFormValues => ({ weight: "181", day: "2026-09-30", note: "typed note", confirmed: false, ...over });
const errorState = (errors: { code: string; field?: string }[], v = values()): WeightFormState =>
  ({ status: "error", errors, values: v }) as WeightFormState;
const checkState = (v = values()): WeightFormState => ({ status: "check", values: v });

describe.each(LOCALES)("WeightForm in %s", (locale) => {
  const words = catalogs[locale].weight;

  it("has exactly one h1 and the lead sentence, for a new weight", () => {
    const html = render(locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.entry.title);
    expect(textOf(html)).toContain(words.entry.lead);
  });

  it("has exactly one h1 and the edit wording, for an edit", () => {
    const html = render(locale, { mode: "edit" });
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.edit.title);
    expect(textOf(html)).toContain(words.edit.lead);
    expect(textOf(html)).not.toContain(words.entry.title);
  });

  it("ties a visible label to the number field, and gives the number the decimal keypad, left-to-right, no autofill and no placeholder", () => {
    const html = render(locale);
    const input = tagWith(html, "input", 'name="weight"');
    const id = /\sid="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<label\\b[^>]*for="${id}"[^>]*>${words.form.weightLabel}</label>`));
    expect(input).toContain('type="text"');
    expect(input).toContain('inputMode="decimal"');
    expect(input).toContain('dir="ltr"');
    expect(input).toContain('autoComplete="off"');
    expect(input).not.toContain("placeholder");
    expect(input).not.toContain("required");
  });

  it("shows the unit as text next to the number", () => {
    const html = render(locale);
    expect(html).toMatch(new RegExp(`<span[^>]*>${words.form.unit.replace('"', "&quot;")}</span>`));
  });

  it("gives every control a unique id, and every label points at an id that exists", () => {
    const html = render(locale);
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const targets = Array.from(html.matchAll(/<label\b[^>]*for="([^"]+)"/g), (match) => match[1]);
    expect(targets).toHaveLength(3);
    for (const target of targets) expect(ids, target).toContain(target);
  });

  it("offers the server's days in a native list, in order, with the chosen one selected", () => {
    const html = render(locale);
    const select = /<select\b[^>]*name="day"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    expect(select).toBeTruthy();
    const values = Array.from(select![1].matchAll(/<option value="([^"]+)"/g), (match) => match[1]);
    expect(values).toEqual(["now", "2026-09-30", "2026-09-29"]);
    expect(select![1]).toMatch(/<option value="now" selected="">NOW-LABEL<\/option>/);
    expect(html).toContain(words.form.dayLabel);
  });

  it("starts an edit on 'As saved' and keeps the saved number and note", () => {
    const html = render(locale, { mode: "edit" });
    expect(html).toMatch(/<option value="keep" selected="">KEEP-LABEL<\/option>/);
    expect(tagWith(html, "input", 'name="weight"')).toContain('value="118.7"');
    expect(tagWith(html, "input", 'name="note"')).toContain('value="a note"');
  });

  it("limits the note to 200 characters, in its own direction, with a real label", () => {
    const html = render(locale);
    const note = tagWith(html, "input", 'name="note"');
    expect(note).toContain('maxLength="200"');
    expect(note).toContain('dir="auto"');
    expect(note).toContain('type="text"');
    expect(textOf(html)).toContain(words.form.noteLabel);
  });

  it("carries the page's id as a hidden field, and no confirmation", () => {
    const html = render(locale);
    expect(html).toContain(`<input type="hidden" name="id" value="${ID}"/>`);
    expect(html).not.toContain('name="confirmed"');
  });

  it("has Save (a submit button) before the way out, which is a link", () => {
    const html = render(locale);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${catalogs[locale].common.save}</button>`));
    expect(html).toMatch(/<a\b[^>]*href="\/"/);
    expect(html.indexOf(`>${catalogs[locale].common.save}</button>`)).toBeLessThan(html.indexOf('href="/"'));
    expect(count(html, /<a\b[^>]*href=/g)).toBe(1);
  });

  it("leads an edit back to the list", () => {
    const html = render(locale, { mode: "edit" });
    expect(html).toMatch(/<a\b[^>]*href="\/me\/weights"/);
    expect(textOf(html)).toContain(words.edit.back);
  });

  it("has no reply and no invalid field before anything was refused", () => {
    const html = render(locale);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  describe("after a refused save", () => {
    it("shows one alert per error, in the words of the catalog, and ties each to its field", () => {
      const state = errorState([
        { code: "out_of_range", field: "weight" },
        { code: "invalid_day", field: "day" },
        { code: "note_too_long", field: "note" },
      ]);
      const html = render(locale, { initialState: state });
      expect(count(html, /role="alert"/g)).toBe(3);
      expect(textOf(html)).toContain(words.errors.out_of_range.replace("{min}", "30").replace("{max}", "350"));
      expect(textOf(html)).toContain(words.errors.invalid_day);
      expect(textOf(html)).toContain(words.errors.note_too_long);

      const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
      for (const [name, tag] of [["weight", "input"], ["day", "select"], ["note", "input"]] as const) {
        const control = tagWith(html, tag, `name="${name}"`);
        expect(control, name).toContain('aria-invalid="true"');
        const described = /aria-describedby="([^"]+)"/.exec(control)?.[1];
        expect(described, name).toBeTruthy();
        for (const target of described!.split(" ")) expect(ids, target).toContain(target);
      }
    });

    it("shows the 'not saved' sentence without marking any field", () => {
      const html = render(locale, { initialState: errorState([{ code: "not_saved" }]) });
      expect(count(html, /role="alert"/g)).toBe(1);
      expect(textOf(html)).toContain(words.errors.not_saved);
      expect(html).not.toContain("aria-invalid");
    });

    it("gives the replies the soft coral look of the Message primitive, never the technical one", () => {
      const html = render(locale, { initialState: errorState([{ code: "required", field: "weight" }]) });
      const message = /<p\b[^>]*role="alert"[^>]*>/.exec(html)?.[0] ?? "";
      expect(message).toContain("attention");
      expect(message).not.toContain("error");
    });

    it("keeps everything that was typed, including the note and the chosen day", () => {
      const html = render(locale, { initialState: errorState([{ code: "out_of_range", field: "weight" }], values({ weight: "12" })) });
      expect(tagWith(html, "input", 'name="weight"')).toContain('value="12"');
      expect(tagWith(html, "input", 'name="note"')).toContain('value="typed note"');
      expect(html).toMatch(/<option value="2026-09-30" selected="">YESTERDAY-LABEL<\/option>/);
    });

    it("does not carry the confirmation back", () => {
      const html = render(locale, { initialState: errorState([{ code: "required", field: "weight" }]) });
      expect(html).not.toContain('name="confirmed"');
    });
  });

  describe("at the 'is that right?' step", () => {
    it("asks once, in a calm alert that names no number, and keeps every field", () => {
      const html = render(locale, { initialState: checkState() });
      expect(count(html, /role="alert"/g)).toBe(1);
      expect(textOf(html)).toContain(words.check.body);
      expect(words.check.body).not.toMatch(/\d/);
      expect(html).not.toContain("aria-invalid");
      expect(tagWith(html, "input", 'name="weight"')).toContain('value="181"');
      expect(tagWith(html, "input", 'name="note"')).toContain('value="typed note"');
      expect(html).toMatch(/<option value="2026-09-30" selected="">/);
    });

    it("points the number at the question", () => {
      const html = render(locale, { initialState: checkState() });
      const described = /aria-describedby="([^"]+)"/.exec(tagWith(html, "input", 'name="weight"'))?.[1];
      expect(described).toBeTruthy();
      expect(html).toMatch(new RegExp(`<p\\b[^>]*id="${described}"`));
    });

    it("carries the confirmation only here, as a hidden field", () => {
      const html = render(locale, { initialState: checkState() });
      expect(html).toContain('<input type="hidden" name="confirmed" value="1"/>');
      expect(count(html, /name="confirmed"/g)).toBe(1);
    });

    it("makes 'Yes, it is right' the submit and 'I will fix it' a plain button, with no plain Save", () => {
      const html = render(locale, { initialState: checkState() });
      expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${words.check.confirm}</button>`));
      expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${words.check.fix.replace("'", "&#x27;")}</button>`));
      expect(html).not.toContain(`>${catalogs[locale].common.save}</button>`);
      expect(count(html, /type="submit"/g)).toBe(1);
    });

    it("puts the safe 'yes' first and primary, and the way to fix it second and quieter", () => {
      const html = render(locale, { initialState: checkState() });
      const buttons = Array.from(html.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g));
      expect(buttons.map((match) => match[2].replace("&#x27;", "'"))).toEqual([words.check.confirm, words.check.fix]);
      expect(buttons[0][1]).toContain("primary");
      expect(buttons[1][1]).toContain("secondary");
    });
  });
});

describe("WeightForm and the languages", () => {
  it("renders the unit of each language", () => {
    expect(textOf(render("he"))).toContain(catalogs.he.weight.form.unit);
    expect(textOf(render("en"))).toContain("kg");
  });

  it("renders the same markup twice: it holds no clock and no randomness of its own", () => {
    // Rendering twice gives the same markup apart from React's ids.
    const strip = (html: string) => html.replace(/id="[^"]*"/g, "").replace(/for="[^"]*"/g, "").replace(/aria-describedby="[^"]*"/g, "");
    expect(strip(render("he"))).toBe(strip(render("he")));
  });
});
