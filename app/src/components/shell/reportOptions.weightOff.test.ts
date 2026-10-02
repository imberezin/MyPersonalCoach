// The kill switch of weight reporting: with it off the Report sheet's weight row is plain text again and the
// other links are unchanged. A separate file because the switch is mocked for the whole module graph.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { ReportSheetProvider } from "./ReportSheet";
import { REPORT_OPTIONS } from "./reportOptions";
import { buildShellTestMessages } from "./shellTestMessages";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/domain/weight/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight/types")>();
  return { ...original, WEIGHT_FLOW: { ...original.WEIGHT_FLOW, reportingEnabled: false } };
});

const intlProps = { locale: "he", messages: buildShellTestMessages() as AbstractIntlMessages, timeZone: "UTC" } as ComponentProps<
  typeof IntlProvider
>;

describe("weight reporting switched off", () => {
  it("leaves the weight row without a link", () => {
    expect(REPORT_OPTIONS.find((option) => option.id === "weight")?.href).toBeNull();
  });

  it("renders the weight row as plain text and keeps the other links", () => {
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        intlProps,
        createElement(ReportSheetProvider, {} as ComponentProps<typeof ReportSheetProvider>, createElement("p", null, "page")),
      ),
    );
    const dialog = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
    const hrefs = [...dialog.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([FOOD_ROUTES.chooser, FOOD_ROUTES.photo, FOOD_ROUTES.text]);
    expect(dialog.match(/<li\b/g)).toHaveLength(7);
  });
});
