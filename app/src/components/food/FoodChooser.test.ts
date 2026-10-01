// D1 as markup, with the real catalogs in both languages. Links, the resume card and the photo-off tile.
import { describe, expect, it, vi } from "vitest";
import { catalogs, count, renderWithIntl, textOf } from "./foodTestKit";
import { FoodChooser } from "./FoodChooser";

vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const he = (await import("@/i18n/messages/he.json")).default;
  return {
    getLocale: async () => "he",
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: "he", messages: he as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

const REPORT_ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const discardAction = async () => {};

async function render(props: { photoEnabled: boolean; resume: { id: string } | null }): Promise<string> {
  const view = await FoodChooser({ ...props, discardAction });
  // The server mock above speaks Hebrew; the client parts are rendered in Hebrew too.
  return renderWithIntl(view, "he");
}

const he = catalogs.he.food;
const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);

describe("FoodChooser (D1)", () => {
  it("has exactly one h1, and the section is named by it", async () => {
    const html = await render({ photoEnabled: true, resume: null });
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h1 id="${labelledBy}"`);
    expect(textOf(html)).toContain(he.chooser.title);
  });

  it("offers Photo and Writing as real links, and a Back link to Home", async () => {
    const html = await render({ photoEnabled: true, resume: null });
    expect(hrefs(html)).toEqual(["/report/food/photo", "/report/food/text", "/"]);
    expect(textOf(html)).toContain(he.chooser.photoHint);
    expect(textOf(html)).toContain(he.chooser.textHint);
    expect(textOf(html)).toContain(he.common.back);
  });

  it("keeps the choices a list for VoiceOver (list-style: none needs an explicit role)", async () => {
    const html = await render({ photoEnabled: true, resume: null });
    expect(html).toMatch(/<ul[^>]*role="list"/);
  });

  it("replaces the Photo link with a sentence when automatic analysis is off", async () => {
    const html = await render({ photoEnabled: false, resume: null });
    expect(hrefs(html)).toEqual(["/report/food/text", "/"]);
    expect(textOf(html)).toContain(he.chooser.photoOff);
    expect(textOf(html)).not.toContain(he.chooser.photoHint);
  });

  it("shows no resume card and no form when nothing is waiting", async () => {
    const html = await render({ photoEnabled: true, resume: null });
    expect(html).not.toContain("<form");
    expect(textOf(html)).not.toContain(he.resume.title);
  });

  it("offers an unfinished report: Continue goes to it, Let it go is a form that names it", async () => {
    const html = await render({ photoEnabled: true, resume: { id: REPORT_ID } });
    expect(hrefs(html)).toContain(`/report/food/${REPORT_ID}`);
    expect(textOf(html)).toContain(he.resume.title);
    expect(textOf(html)).toContain(he.resume.continue);
    expect(textOf(html)).toContain(he.resume.discard);
    expect(count(html, /<form\b/g)).toBe(1);
    expect(html).toContain(`name="id" value="${REPORT_ID}"`);
    expect(html).toContain('name="stage" value="resume"');
    // The card comes before the tiles.
    expect(html.indexOf(he.resume.title)).toBeLessThan(html.indexOf(he.chooser.photo));
  });

  it("uses no emoji and no numbers", async () => {
    const html = await render({ photoEnabled: true, resume: { id: REPORT_ID } });
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(textOf(html)).not.toMatch(/\d/);
  });
});
