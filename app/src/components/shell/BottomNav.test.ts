// Markup contract of the bottom bar. There is no DOM in this suite, so it renders to static markup and
// reads the result as text: structure, order and attributes, never production wording (the messages
// are an inline fixture). What a tap does is covered by the manual run.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";
import { ReportSheetProvider } from "./ReportSheet";
import { buildShellTestMessages } from "./shellTestMessages";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const messages = buildShellTestMessages();
const nav = messages.nav as Record<string, string>;
// `children` is passed as createElement's third argument; the cast only leaves it out of the props object.
const intlProps = { locale: "he", messages: messages as AbstractIntlMessages, timeZone: "UTC" } as ComponentProps<
  typeof IntlProvider
>;

function renderNav(pathname: string): string {
  route.pathname = pathname;
  const html = renderToStaticMarkup(
    createElement(IntlProvider, intlProps, createElement(ReportSheetProvider, null, createElement(BottomNav))),
  );
  // The provider also renders the sheet; the bar is the <nav> only.
  return html.slice(html.indexOf("<nav"), html.indexOf("</nav>") + "</nav>".length);
}

const currentLinks = (html: string) => html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];

describe("BottomNav markup", () => {
  it("is one labelled navigation landmark with five items", () => {
    const html = renderNav("/");
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${nav.ariaLabel}"`);
    expect(html.match(/<li\b/g)).toHaveLength(5);
  });

  it("lists Home, Progress, Report, Coach, Me in DOM order (one row, so Hebrew mirrors it by itself)", () => {
    const html = renderNav("/");
    const order = [nav.home, nav.progress, nav.report, nav.coach, nav.me].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("links the four tabs to their routes", () => {
    const html = renderNav("/");
    const hrefs = (html.match(/<a\b[^>]*>/g) ?? []).map((tag) => /href="([^"]*)"/.exec(tag)?.[1]);
    expect(hrefs).toEqual(["/", "/progress", "/coach", "/me"]);
  });

  it.each([
    ["/", "/"],
    ["/progress", "/progress"],
    ["/progress/weight", "/progress"],
    ["/coach", "/coach"],
    ["/me", "/me"],
  ])("marks exactly one link current on %s", (pathname, href) => {
    const current = currentLinks(renderNav(pathname));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="${href}"`);
  });

  it.each(["/foo", "/report", "/progressive", "/login"])("marks nothing current on %s", (pathname) => {
    expect(currentLinks(renderNav(pathname))).toEqual([]);
  });

  it("makes Report a button that opens a dialog, never a link and never current", () => {
    const html = renderNav("/report");
    const tag = /<button\b[^>]*id="report-nav-button"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-haspopup="dialog"');
    expect(tag).toContain('aria-controls="report-sheet"');
    expect(tag).toContain('aria-expanded="false"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(tag).not.toContain("aria-current");
  });

  it("hides every icon from screen readers", () => {
    const svgs = renderNav("/").match(/<svg\b[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(5);
    for (const svg of svgs) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
    }
  });

  it("adds no tab stop beyond the natural order", () => {
    const html = renderNav("/");
    for (const [, value] of html.matchAll(/tabindex="(-?\d+)"/gi)) expect(Number(value)).toBeLessThanOrEqual(0);
  });
});
