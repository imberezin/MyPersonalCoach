// The first paint of the two input screens (D2 photo, D3 writing), as markup with the real catalogs.
// What happens after a tap needs a browser; its pure parts (the reducers, the image, the request, the
// draft, the ids) are tested next to their modules, and the rest is in the manual checklist.
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PhotoReport } from "./PhotoReport";
import { TextReport } from "./TextReport";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./foodTestKit";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);
const photo = (locale: TestLocale) => renderWithIntl(createElement(PhotoReport), locale);
const text = (locale: TestLocale, aiAvailable = true) => renderWithIntl(createElement(TextReport, { aiAvailable }), locale);

describe.each(LOCALES)("PhotoReport (D2) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("starts idle: one h1, two real buttons (take, choose), the face hint and the camera help", () => {
    const html = photo(locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(textOf(html)).toContain(words.photo.title);
    expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${words.photo.take}</button>`));
    expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${words.photo.choose}</button>`));
    expect(textOf(html)).toContain(words.photo.hint);
    expect(textOf(html)).toContain(words.photo.cameraHelp);
  });

  it("names the camera help as the description of the take button", () => {
    const html = photo(locale);
    const takeTag = new RegExp(`<button[^>]*>(?=${words.photo.take}</button>)`).exec(html)?.[0] ?? "";
    const help = /aria-describedby="([^"]+)"/.exec(takeTag)?.[1];
    expect(help).toBeTruthy();
    expect(html).toMatch(new RegExp(`<p id="${help}"[^>]*>${words.photo.cameraHelp}</p>`));
  });

  it("has two hidden file inputs for images, one of them for the camera, out of the reading order", () => {
    const html = photo(locale);
    const inputs = html.match(/<input\b[^>]*type="file"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain('accept="image/*"');
      expect(input).toContain('aria-hidden="true"');
      expect(input).toContain('tabindex="-1"');
    }
    expect(inputs.filter((input) => input.includes("capture"))).toHaveLength(1);
    // HEIC is never named: with image/* iOS hands over a JPEG.
    expect(html.toLowerCase()).not.toContain("heic");
  });

  it("has a status region in the page from the start, so a change of phase is announced", () => {
    expect(photo(locale)).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"/);
  });

  it("shows no preview, no send button and no processing panel before a photo is chosen", () => {
    const html = photo(locale);
    expect(html).not.toContain("<img");
    expect(textOf(html)).not.toContain(words.photo.send);
    expect(textOf(html)).not.toContain(words.processing.title);
    expect(html).not.toContain("aria-busy=\"true\"");
  });

  it("has a Back link to the chooser and nothing fixed to the bottom of the screen", () => {
    const html = photo(locale);
    expect(hrefs(html)).toEqual(["/report/food"]);
    expect(textOf(html)).toContain(words.common.back);
    expect(html).not.toMatch(/position:\s*fixed/);
  });

  it("uses no emoji and no number", () => {
    const html = photo(locale);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(textOf(html)).not.toMatch(/\d|!/);
  });
});

describe.each(LOCALES)("TextReport (D3) in %s", (locale) => {
  const words = catalogs[locale].food;

  it("has one h1 and a textarea named by it, with the hint as its description", () => {
    const html = text(locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const titleId = /<h1 id="([^"]+)"/.exec(html)?.[1];
    const area = /<textarea\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(area).toContain(`aria-labelledby="${titleId}"`);
    const describedBy = /aria-describedby="([^"]+)"/.exec(area)?.[1] ?? "";
    expect(describedBy.split(" ")).toHaveLength(1);
    expect(html).toContain(`<p id="${describedBy}"`);
    expect(textOf(html)).toContain(words.text.hint);
  });

  it("sets up the field for typing on a phone: five rows, 500 characters, auto direction, no zoom-size font", () => {
    const area = /<textarea\b[^>]*>/.exec(text(locale))?.[0] ?? "";
    expect(area).toContain('rows="5"');
    expect(area).toContain('maxLength="500"');
    expect(area).toContain('dir="auto"');
    expect(area).toContain('autoCapitalize="sentences"');
    expect(area).toContain(`placeholder="${words.text.placeholder}"`);
    // Enter must insert a newline, so the field does not ask the keyboard for a Send key.
    expect(area).not.toContain("enterKeyHint");
  });

  it("offers Send as the submit button of a form, and a Back link to the chooser", () => {
    const html = text(locale);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${words.text.send}</button>`));
    expect(hrefs(html)).toEqual(["/report/food"]);
  });

  it("starts empty with no restored note, no offline line and no empty-text error", () => {
    const html = text(locale);
    expect(html).toContain("</textarea>");
    expect(textOf(html)).not.toContain(words.text.draftRestored);
    expect(textOf(html)).not.toContain(words.text.offline);
    expect(textOf(html)).not.toContain(words.text.empty);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain('role="alert"');
  });

  it("without automatic analysis, says so up front, keeps the text as a list and labels the button for that", () => {
    const html = text(locale, false);
    expect(textOf(html)).toContain(words.text.manualNote);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${words.text.sendManual}</button>`));
    expect(html).not.toContain(`>${words.text.send}</button>`);
    const area = /<textarea\b[^>]*>/.exec(html)?.[0] ?? "";
    const describedBy = (/aria-describedby="([^"]+)"/.exec(area)?.[1] ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    // The manual note is one of the two paragraphs that describe the field.
    expect(describedBy).toContain("text-manual-note");
    expect(html).toContain('id="text-manual-note"');
  });

  it("with automatic analysis, does not show the manual note", () => {
    expect(textOf(text(locale, true))).not.toContain(words.text.manualNote);
  });

  it("uses no emoji and no exclamation mark", () => {
    const html = text(locale, false);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(textOf(html)).not.toContain("!");
  });
});
