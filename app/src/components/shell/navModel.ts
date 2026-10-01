// The bottom navigation as data, so the active tab and the focus rule are plain functions that tests can call.

/** Logical order = DOM order = tab order = reading order. Report is a button, the other four are links. */
export const NAV_ITEM_IDS = ["home", "progress", "report", "coach", "me"] as const;
export type NavItemId = (typeof NAV_ITEM_IDS)[number];
export type NavTabId = Exclude<NavItemId, "report">;

export const NAV_TAB_HREF: Readonly<Record<NavTabId, string>> = {
  home: "/",
  progress: "/progress",
  coach: "/coach",
  me: "/me",
};

/**
 * The tab that matches a pathname, or null for any other page (a 404, a future /report/... flow).
 * The match is on a segment boundary: /progress/weight is Progress, /progressive is nothing.
 * Report is never the active tab.
 */
export function activeTab(pathname: string | null | undefined): NavTabId | null {
  if (typeof pathname !== "string" || pathname === "") return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === NAV_TAB_HREF.home) return "home";
  for (const id of ["progress", "coach", "me"] as const) {
    const href = NAV_TAB_HREF[id];
    if (path === href || path.startsWith(`${href}/`)) return id;
  }
  return null;
}

/**
 * Where focus goes when the Report sheet closes. Pure (no DOM access) so it is unit-testable.
 * Returns `opener` when it is non-null, `isConnected`, and not one of `inert` (callers pass
 * [document.body, document.documentElement]: Safari and iOS do not focus a tapped button, so a
 * captured `document.activeElement` is the body, which means "no opener"). Otherwise `fallback`
 * (the Report button in the bar, or null).
 */
export function restoreFocusTarget<T extends { isConnected: boolean }>(
  opener: T | null | undefined,
  fallback: T | null,
  inert: readonly unknown[],
): T | null {
  if (opener && opener.isConnected && !inert.includes(opener)) return opener;
  return fallback;
}
