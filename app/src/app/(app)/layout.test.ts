// The (app) layout decides only whether there is chrome. Without Supabase every page shows the setup
// notice, so the bar would lead nowhere; with it, the header, one <main>, the bar and the sheet.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildShellTestMessages } from "@/components/shell/shellTestMessages";
import AppLayout from "./layout";

const config = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => config.configured }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// An async server component: it is the header's own concern, here only that the layout places it.
vi.mock("@/components/shell/AppHeader", () => ({ AppHeader: () => createElement("header", null, "header") }));

// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = {
  locale: "he",
  messages: buildShellTestMessages() as AbstractIntlMessages,
  timeZone: "UTC",
} as ComponentProps<typeof IntlProvider>;

const render = () =>
  renderToStaticMarkup(
    createElement(IntlProvider, intlProps, createElement(AppLayout, null, createElement("p", null, "page"))),
  );
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe("(app) layout", () => {
  beforeEach(() => {
    config.configured = true;
  });

  it("shows the page alone, with no header, no bar and no sheet, when Supabase is not configured", () => {
    config.configured = false;
    const html = render();
    expect(count(html, /<main\b/g)).toBe(1);
    expect(html).toContain("<p>page</p>");
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<dialog");
  });

  it("wraps the page in the header, the bar and the sheet when Supabase is configured", () => {
    const html = render();
    expect(count(html, /<main\b/g)).toBe(1);
    expect(count(html, /<nav\b/g)).toBe(1);
    expect(count(html, /<header\b/g)).toBe(1);
    expect(count(html, /<dialog\b/g)).toBe(1);
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf("<p>page</p>"));
    expect(html.indexOf("<p>page</p>")).toBeLessThan(html.indexOf("<nav"));
  });
});
