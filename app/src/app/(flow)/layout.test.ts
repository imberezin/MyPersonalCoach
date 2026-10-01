// The (flow) layout is chrome only: one <main> around the page, and none of the app shell. A focus task
// (typing, the camera, the Save button) needs the whole bottom of the screen, so there is no bottom bar,
// no header and no Report sheet.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FlowLayout from "./layout";

const render = () => renderToStaticMarkup(createElement(FlowLayout, null, createElement("p", null, "page")));

describe("(flow) layout", () => {
  it("wraps the page in exactly one <main>", () => {
    const html = render();
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf("<p>page</p>"));
    expect(html.indexOf("<p>page</p>")).toBeLessThan(html.indexOf("</main>"));
  });

  it("has no navigation, no header, no dialog and no fixed bar", () => {
    const html = render();
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<dialog");
    expect(html).not.toMatch(/position:\s*fixed/);
  });
});
