// The glue between a decision and the page: the words, the one button, the time zone and the refresher.
// Rendered to static markup with the real Hebrew catalog and the real Report sheet provider; the
// refresher's effect needs a browser and is in the manual run, here only that it is mounted.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { ReportSheetProvider } from "@/components/shell/ReportSheet";
import { buildShellTestMessages } from "@/components/shell/shellTestMessages";
import type { HomeDecision } from "@/domain/home";
import { HomeView } from "./HomeView";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => router }));
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
vi.mock("./HomeRefresher", () => ({
  HomeRefresher: ({ renderedAt }: { renderedAt: number }) => createElement("i", { "data-refresher": renderedAt }),
}));

// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

const CANDLE_LIGHTING = new Date("2027-01-08T14:10:00Z"); // 16:10 in Jerusalem in winter
const ACTION = { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" } as const;

async function render(decision: HomeDecision, timeZone = "Asia/Jerusalem"): Promise<string> {
  const view = await HomeView({ decision, timeZone, renderedAt: 1_234 });
  const html = renderToStaticMarkup(
    createElement(IntlProvider, intlProps, createElement(ReportSheetProvider, null, view)),
  );
  return html;
}

/** The page without the Report sheet, whose own Close button is not part of Home. */
const withoutSheet = (html: string) => html.replace(/<dialog\b[\s\S]*?<\/dialog>/, "");

const MORNING: HomeDecision = { state: { key: "MORNING" }, action: null, degraded: false };

describe("HomeView", () => {
  it("renders the one invitation button, tied to the Report sheet, when the decision has an action", async () => {
    const page = withoutSheet(await render({ ...MORNING, action: ACTION }));
    expect(page.match(/<button\b/g)).toHaveLength(1);
    const tag = /<button\b[^>]*>/.exec(page)?.[0] ?? "";
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
  });

  it("renders First Week Start with exactly one button that opens the Report sheet, and no counters", async () => {
    const page = withoutSheet(await render({ state: { key: "FIRST_WEEK_START" }, action: ACTION, degraded: false }));
    expect(page).toContain("השבוע הראשון שלנו");
    expect(page).toContain("השבוע לא צריך להוכיח כלום.");
    expect(page).toContain("אני רוצה פשוט להכיר אותך");

    expect(page.match(/<button\b/g)).toHaveLength(1);
    const tag = /<button\b[^>]*>/.exec(page)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
    expect(page).toMatch(/<button\b[^>]*>בוא נתחיל<\/button>/);

    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    const visibleText = page.replace(/<[^>]*>/g, " ");
    expect(visibleText).not.toMatch(/\d/);
    expect(visibleText).not.toMatch(/%|score|ציון|אחוז/i);
  });

  it("renders no button when the decision has no action", async () => {
    expect(withoutSheet(await render(MORNING))).not.toContain("<button");
  });

  it("mounts the refresher with the server's reading of the clock", async () => {
    expect(await render(MORNING)).toContain('data-refresher="1234"');
  });

  it("writes candle lighting in the user's time zone", async () => {
    const decision: HomeDecision = {
      state: { key: "BEFORE_SHABBAT", candleLighting: CANDLE_LIGHTING },
      action: null,
      degraded: false,
    };
    const jerusalem = withoutSheet(await render(decision, "Asia/Jerusalem"));
    const utc = withoutSheet(await render(decision, "UTC"));
    expect(jerusalem).toContain("16:10");
    expect(jerusalem).not.toContain("14:10");
    expect(utc).toContain("14:10");
    expect(utc).not.toContain("16:10");
  });

  it("adds the calm note only for a degraded decision", async () => {
    expect(withoutSheet(await render(MORNING))).not.toContain('role="status"');
    expect(withoutSheet(await render({ ...MORNING, degraded: true }))).toContain('role="status"');
  });
});
