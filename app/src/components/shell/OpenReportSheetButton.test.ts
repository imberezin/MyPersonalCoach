// Markup contract of the button that opens the Report sheet from a page. What a tap does is in the
// manual run; here only the attributes that tie the button to the dialog.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { OpenReportSheetButton } from "./OpenReportSheetButton";
import { ReportSheetProvider } from "./ReportSheet";
import { buildShellTestMessages } from "./shellTestMessages";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

function render(): string {
  const button = createElement(OpenReportSheetButton, { variant: "primary" } as ComponentProps<typeof OpenReportSheetButton>, "Label");
  return renderToStaticMarkup(createElement(IntlProvider, intlProps, createElement(ReportSheetProvider, null, button)));
}

describe("OpenReportSheetButton", () => {
  it("is a plain button that names the dialog it opens", () => {
    const html = render();
    // The provider also renders the sheet, whose Close button is not the one under test.
    const tag = /<button\b[^>]*>(?=Label<\/button>)/.exec(html)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
  });

  it("points at a dialog that exists", () => {
    expect(render()).toMatch(/<dialog\b[^>]*id="report-sheet"/);
  });
});
