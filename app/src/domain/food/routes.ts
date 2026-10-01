import { clampPages } from "./entries";

/** The addresses of the food reporting flow and the names of its form fields, shared by pages, actions and components. */

export const FOOD_ROUTES = {
  chooser: "/report/food",
  photo: "/report/food/photo",
  text: "/report/food/text",
  confirm: (id: string) => `/report/food/${id}`,
  edit: (id: string) => `/report/food/${id}/edit`,
  saved: (id: string) => `/report/food/${id}/saved`,
} as const;

/** Field names of the confirm and discard forms. */
export const FOOD_FORM = { id: "id", revision: "revision", stage: "stage" } as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** An unfinished report is offered for resuming for this long (2 hours). */
export const RESUME_WINDOW_MS = 7_200_000;

/**
 * True when a pending report is older than the resume window. The confirm and edit pages treat it as gone,
 * because `delete_meal_entry` purges such reports (migration 20261001150000): nothing may still show or finish one.
 */
export function isStaleReport(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= RESUME_WINDOW_MS;
}

/** D6 shows a calm note for `?refreshed=1` (after a stale-revision bounce) and a problem for `?failed=1` (the save did not go through). */
export const FOOD_QUERY = { refreshed: "refreshed", failed: "failed" } as const;

/** What a delete attempt ended in. Only these three words ever travel in the URL. */
export const MEAL_NOTICES = ["deleted", "gone", "error"] as const;
export type MealNotice = (typeof MEAL_NOTICES)[number];

/** Where the vocabulary of "My meals" lives: addresses, query values and form fields. */
export const MEALS_ROUTES = {
  list: "/me/meals",
  /** The list with `pages` pages loaded (1 -> no query). */
  listPage: (pages: number): string => {
    const clamped = clampPages(pages);
    return clamped > 1 ? `/me/meals?pages=${clamped}` : "/me/meals";
  },
  /**
   * The landing after a delete attempt: `/me/meals?notice=<notice>&n=<token>[&pages=<pages>]`.
   * `token` is a fresh random UUID per attempt (the action passes `crypto.randomUUID()`); it makes every
   * attempt a different URL so the notice remounts, takes focus and is announced again. `pages` is kept
   * only when > 1 (clamped like `clampPages`). Both are optional so the function stays pure.
   */
  withNotice: (notice: MealNotice, opts?: { token?: string; pages?: number }): string => buildNoticeUrl(notice, opts),
  me: "/me",
} as const;

export const MEALS_QUERY = { pages: "pages", notice: "notice", token: "n" } as const;
export const MEALS_FORM = { entryId: "entryId", from: "from", pages: "pages" } as const;

function buildNoticeUrl(notice: MealNotice, opts?: { token?: string; pages?: number }): string {
  const parts = [`${MEALS_QUERY.notice}=${notice}`];
  // A token that is not a UUID is dropped: only a random id may ride in the URL.
  if (opts?.token !== undefined && isUuid(opts.token)) parts.push(`${MEALS_QUERY.token}=${opts.token}`);
  const pages = opts?.pages === undefined ? 1 : clampPages(opts.pages);
  if (pages > 1) parts.push(`${MEALS_QUERY.pages}=${pages}`);
  return `${MEALS_ROUTES.list}?${parts.join("&")}`;
}

/** The first value of a query string or form value (Next gives an array for a repeated key). */
function firstValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** A query value -> a known notice, else null. Never throws. */
export function parseNotice(raw: unknown): MealNotice | null {
  const value = firstValue(raw);
  return MEAL_NOTICES.find((notice) => notice === value) ?? null;
}

/** A query value -> the token when it is a UUID (the first element of an array), else null. Never throws. */
export function parseNoticeToken(raw: unknown): string | null {
  const value = firstValue(raw);
  return isUuid(value) ? value : null;
}

/** Where the delete was started. Only picks an analytics enum; a forged value becomes "list". */
export const MEAL_DELETE_FROM = ["list", "saved"] as const;
export type MealDeleteFrom = (typeof MEAL_DELETE_FROM)[number];

export function parseDeleteFrom(raw: unknown): MealDeleteFrom {
  return raw === "saved" ? "saved" : "list";
}
