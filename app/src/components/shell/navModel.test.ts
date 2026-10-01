import { describe, expect, it } from "vitest";
import { NAV_ITEM_IDS, NAV_TAB_HREF, activeTab, restoreFocusTarget } from "./navModel";

describe("NAV_ITEM_IDS and NAV_TAB_HREF", () => {
  it("keeps the product order, with Report in the middle", () => {
    expect([...NAV_ITEM_IDS]).toEqual(["home", "progress", "report", "coach", "me"]);
  });

  it("maps the four tabs to their routes (Report is a button, it has none)", () => {
    expect(NAV_TAB_HREF).toEqual({ home: "/", progress: "/progress", coach: "/coach", me: "/me" });
  });
});

describe("activeTab", () => {
  it.each<[string | null | undefined, string | null]>([
    ["/", "home"],
    ["/progress", "progress"],
    ["/progress/", "progress"],
    ["/progress/weight", "progress"],
    ["/coach", "coach"],
    ["/coach/", "coach"],
    ["/coach/topic/1", "coach"],
    ["/me", "me"],
    ["/me/", "me"],
    ["/me/settings", "me"],
    // A prefix is not a match unless it ends on a segment boundary.
    ["/progressive", null],
    ["/coaching", null],
    ["/media", null],
    // Report is a sheet, never a page that can be current.
    ["/report", null],
    ["/report/food", null],
    ["/login", null],
    ["/onboarding/welcome", null],
    ["/foo", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%j -> %s", (pathname, expected) => {
    expect(activeTab(pathname)).toBe(expected);
  });
});

describe("restoreFocusTarget", () => {
  const connected = () => ({ isConnected: true });
  const detached = () => ({ isConnected: false });

  it("returns the opener when it is still in the document", () => {
    const opener = connected();
    const fallback = connected();
    expect(restoreFocusTarget(opener, fallback, [])).toBe(opener);
  });

  it("returns the fallback when the opener was removed from the document", () => {
    const fallback = connected();
    expect(restoreFocusTarget(detached(), fallback, [])).toBe(fallback);
  });

  it("treats an opener that is the body as no opener (Safari and iOS do not focus a tapped button)", () => {
    const body = connected();
    const root = connected();
    const fallback = connected();
    expect(restoreFocusTarget(body, fallback, [body, root])).toBe(fallback);
    expect(restoreFocusTarget(root, fallback, [body, root])).toBe(fallback);
  });

  it("returns the fallback when there is no opener at all", () => {
    const fallback = connected();
    expect(restoreFocusTarget(null, fallback, [])).toBe(fallback);
    expect(restoreFocusTarget(undefined, fallback, [])).toBe(fallback);
  });

  it("returns null when there is neither a usable opener nor a fallback", () => {
    expect(restoreFocusTarget(null, null, [])).toBeNull();
    expect(restoreFocusTarget(detached(), null, [])).toBeNull();
  });
});
