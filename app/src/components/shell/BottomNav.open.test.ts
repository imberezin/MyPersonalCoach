// The bar while the Report sheet is open. Static markup always renders a provider's closed state, so
// the sheet context is replaced here; BottomNav.test.ts covers the closed state with the real provider.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";
import { buildShellTestMessages } from "./shellTestMessages";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./ReportSheet", () => ({
  REPORT_NAV_BUTTON_ID: "report-nav-button",
  REPORT_SHEET_ID: "report-sheet",
  useReportSheet: () => ({ isOpen: true, open: () => {}, close: () => {} }),
}));

// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

describe("BottomNav while the sheet is open", () => {
  it("reports the open sheet on the Report button (which also darkens the disc)", () => {
    const html = renderToStaticMarkup(createElement(IntlProvider, intlProps, createElement(BottomNav)));
    const tag = /<button\b[^>]*id="report-nav-button"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('aria-expanded="true"');
  });
});
