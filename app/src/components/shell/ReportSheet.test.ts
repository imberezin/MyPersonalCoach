// Markup contract of the Report sheet. The behavior of a real dialog (focus trap, Esc, backdrop click,
// scroll lock, focus return) cannot run without a DOM; it is in the manual checklist, and the choice
// of where focus returns is the pure restoreFocusTarget (navModel.test.ts).
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { ReportSheetProvider, useReportSheet } from "./ReportSheet";
import { REPORT_OPTIONS, type ReportOption } from "./reportOptions";
import { buildShellTestMessages } from "./shellTestMessages";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const messages = buildShellTestMessages();
const sheetText = (messages.report as { sheet: Record<string, string> }).sheet;
// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = { locale: "he", messages: messages as AbstractIntlMessages, timeZone: "UTC" } as ComponentProps<
  typeof IntlProvider
>;

function renderSheet(options?: readonly ReportOption[]): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      intlProps,
      createElement(ReportSheetProvider, { options } as ComponentProps<typeof ReportSheetProvider>, createElement("p", null, "page")),
    ),
  );
}

function dialogOf(html: string): string {
  return html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>") + "</dialog>".length);
}

const allLinked = REPORT_OPTIONS.map((option) => ({ ...option, href: `/report/${option.id}` }));

describe("ReportSheet markup", () => {
  it("renders the page and a closed dialog next to it", () => {
    const html = renderSheet();
    const dialog = dialogOf(html);
    expect(html).toContain("<p>page</p>");
    expect(dialog).toContain('id="report-sheet"');
    expect(/<dialog\b[^>]*\sopen(=|\s|>)/.test(dialog)).toBe(false);
  });

  it("names the dialog by an existing <h2>", () => {
    const dialog = dialogOf(renderSheet());
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(dialog).toMatch(new RegExp(`<h2\\b[^>]*id="${labelledBy}"`));
  });

  it("makes the title programmatically focusable, so opening can move focus to it", () => {
    const dialog = dialogOf(renderSheet());
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1];
    const title = new RegExp(`<h2\\b[^>]*id="${labelledBy}"[^>]*>`).exec(dialog)?.[0] ?? "";
    expect(title).toContain('tabindex="-1"');
  });

  it("lists seven rows, three of them links to the food flow, and one Close button", () => {
    const dialog = dialogOf(renderSheet());
    const lists = dialog.match(/<ul\b[\s\S]*?<\/ul>/g) ?? [];
    expect(lists).toHaveLength(2);
    const rows = lists.join("");
    expect(rows.match(/<li\b/g)).toHaveLength(7);
    // Food, Photo and Writing are links; the other four rows stay inactive text.
    const hrefs = [...rows.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([FOOD_ROUTES.chooser, FOOD_ROUTES.photo, FOOD_ROUTES.text]);
    expect(rows).not.toMatch(/<button\b/);
    expect(dialog.match(/<button\b/g)).toHaveLength(1);
    expect(dialog).toContain(`>${sheetText.close}</button>`);
  });

  it("explains the inactive rows in a note that describes the dialog", () => {
    const dialog = dialogOf(renderSheet());
    expect(dialog).toMatch(/<p\b[^>]*id="report-sheet-note"/);
    expect(dialog).toMatch(/<dialog\b[^>]*aria-describedby="report-sheet-note"/);
  });

  it("hides the emoji from screen readers and offers no voice option", () => {
    const dialog = dialogOf(renderSheet());
    const emoji = dialog.match(/<span\b[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g) ?? [];
    expect(emoji).toHaveLength(7);
    for (const option of REPORT_OPTIONS) expect(dialog).toContain(`>${option.emoji}</span>`);
    expect(dialog).not.toContain("🎙");
    expect(dialog).not.toContain("דיבור");
    expect(dialog).not.toMatch(/voice/i);
  });

  it("renders a row as a link as soon as it has an href, and leaves the others as text", () => {
    const options = REPORT_OPTIONS.map((option) => (option.id === "activity" ? { ...option, href: "/report/activity" } : option));
    const dialog = dialogOf(renderSheet(options));
    const links = dialog.match(/<a\b[^>]*>/g) ?? [];
    // The three food rows plus the one switched on here.
    expect(links).toHaveLength(4);
    expect(links.some((link) => link.includes('href="/report/activity"'))).toBe(true);
    expect(dialog.match(/<li\b/g)).toHaveLength(7);
    // The other rows are still inactive, so the note stays.
    expect(dialog).toContain('id="report-sheet-note"');
  });

  it("drops the note, and the dialog's description, when no row is inactive", () => {
    const dialog = dialogOf(renderSheet(allLinked));
    expect(dialog).not.toContain("report-sheet-note");
    expect(dialog).not.toContain("aria-describedby");
    expect(dialog.match(/<a\b/g)).toHaveLength(7);
  });

  it("leaves out an empty group instead of rendering an empty list", () => {
    const dialog = dialogOf(renderSheet(REPORT_OPTIONS.filter((option) => option.group === "category")));
    expect(dialog.match(/<ul\b/g)).toHaveLength(1);
    expect(dialog).not.toContain(sheetText.orSimply);
  });
});

describe("useReportSheet", () => {
  it("throws a clear error outside the provider", () => {
    function Probe() {
      useReportSheet();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(/ReportSheetProvider/);
  });
});
