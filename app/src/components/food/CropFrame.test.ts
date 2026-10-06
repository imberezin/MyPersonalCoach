// The crop frame as markup, with the real catalogs. Dragging needs a browser; its arithmetic is the pure `domain/food/crop`
// (tested next to it), and the touch behavior is in the manual checklist. What is checked here is what a screen reader and
// a style sheet depend on: the words, the roles, the keyboard-reachable corners, and where the frame is placed.
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CropFrame, type CropFrameProps } from "./CropFrame";
import { LOCALES, catalogs, count, renderWithIntl, type TestLocale } from "./foodTestKit";
import { FULL_CROP } from "@/domain/food/crop";

const HINT = "hint-id";
const picture = createElement("img", { alt: "", src: "blob:test" });

function frame(locale: TestLocale, props: Partial<Omit<CropFrameProps, "children">> = {}): string {
  return renderWithIntl(
    // `children` goes as createElement's third argument; the cast only leaves it out of the props object.
    createElement(CropFrame, { aspect: 1.5, crop: FULL_CROP, onChange: () => {}, interactive: true, hintId: HINT, ...props } as CropFrameProps, picture),
    locale,
  );
}

describe.each(LOCALES)("CropFrame in %s", (locale) => {
  const words = catalogs[locale].food.photo;

  it("wraps the picture in an area of the picture's own shape, never mirrored", () => {
    const html = frame(locale);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("--aspect:1.5");
    expect(html).toContain("<img");
  });

  it("falls back to a square for an aspect that is not usable", () => {
    expect(frame(locale, { aspect: Number.NaN })).toContain("--aspect:1");
    expect(frame(locale, { aspect: 0 })).toContain("--aspect:1");
  });

  it("names the frame as a group, with four corner buttons that each carry their own name and the hint", () => {
    const html = frame(locale);
    expect(html).toMatch(new RegExp(`role="group"[^>]*aria-label="${words.cropFrame}"|aria-label="${words.cropFrame}"[^>]*role="group"`));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    for (const label of [words.cropCorner.nw, words.cropCorner.ne, words.cropCorner.sw, words.cropCorner.se]) {
      expect(buttons.filter((button) => button.includes(`aria-label="${label}"`)), label).toHaveLength(1);
    }
    for (const button of buttons) {
      expect(button).toContain('type="button"');
      expect(button).toContain(`aria-describedby="${HINT}"`);
    }
  });

  it("marks each corner button for the style sheet, and starts with the thirds grid off", () => {
    const html = frame(locale);
    for (const corner of ["nw", "ne", "sw", "se"]) expect(html, corner).toContain(`data-corner="${corner}"`);
    expect(html).toMatch(/class="[^"]*cropBox[^"]*"[^>]*data-active="false"|data-active="false"[^>]*class="[^"]*cropBox/);
  });

  it("hides the four edge strips from assistive technology (the corners already reach every edge from the keyboard)", () => {
    const html = frame(locale);
    expect(count(html, /class="[^"]*cropEdge[HV][^"]*"[^>]*aria-hidden="true"/g)).toBe(4);
  });

  it("puts no move area over the picture while the frame is the whole picture, so a finger can still scroll the page", () => {
    expect(frame(locale)).not.toContain("cropMove");
    expect(frame(locale, { crop: { x: 0.003, y: 0, w: 0.995, h: 1 } })).not.toContain("cropMove");
  });

  it("adds the move area once the frame is smaller than the picture", () => {
    expect(frame(locale, { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } })).toContain("cropMove");
  });

  it("places the frame and its corners by physical position, as shares of the picture", () => {
    const html = frame(locale, { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } });
    // The frame itself (drawn, and the area that moves it).
    expect(html).toContain("left:20%;top:10%;width:50%;height:60%");
    const corners = html.match(/<button\b[^>]*>/g) ?? [];
    const at = (label: string) => corners.find((button) => button.includes(`aria-label="${label}"`)) ?? "";
    expect(at(words.cropCorner.nw)).toContain("left:20%;top:10%");
    expect(at(words.cropCorner.ne)).toContain("left:70%;top:10%");
    expect(at(words.cropCorner.sw)).toContain("left:20%;top:70%");
    expect(at(words.cropCorner.se)).toContain("left:70%;top:70%");
  });

  it("shows the frame but takes no touch and offers no button when it is not interactive", () => {
    const html = frame(locale, { interactive: false, crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } });
    expect(html).toContain("left:20%;top:10%;width:50%;height:60%");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("cropMove");
  });

  it("uses no emoji and no number in its words", () => {
    const html = frame(locale);
    const labels = (html.match(/aria-label="[^"]*"/g) ?? []).join(" ");
    expect(labels).not.toMatch(/\p{Extended_Pictographic}|\d|!/u);
  });
});
