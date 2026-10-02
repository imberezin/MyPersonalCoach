import { isUuid } from "../food/routes";

/** The addresses of the weight flow and the names of its form fields and query values, shared by pages, actions and components. */

// Re-exported, not copied: one UUID rule for the whole app.
export { isUuid };

/** What a delete attempt ended in. Only these three words ever travel in the URL. */
export const WEIGHT_NOTICES = ["deleted", "gone", "error"] as const;
export type WeightNotice = (typeof WEIGHT_NOTICES)[number];

/** Where the delete was started. Only picks an analytics enum; a forged value becomes "list". */
export const WEIGHT_DELETE_FROM = ["list", "saved"] as const;
export type WeightDeleteFrom = (typeof WEIGHT_DELETE_FROM)[number];

export const WEIGHT_FORM = { id: "id", weight: "weight", day: "day", note: "note", confirmed: "confirmed" } as const;
export const WEIGHT_QUERY = { after: "after", notice: "notice", token: "n", edited: "edited" } as const;
export const WEIGHT_DELETE_FIELDS = { entryId: "entryId", from: "from", after: "after" } as const;

const LIST = "/me/weights";

export const WEIGHT_ROUTES = {
  entry: "/report/weight",
  saved: (id: string) => `/report/weight/${id}/saved`,
  savedEdited: (id: string) => `/report/weight/${id}/saved?${WEIGHT_QUERY.edited}=1`,
  edit: (id: string) => `/report/weight/${id}/edit`,
  list: LIST,
  /** The list after a cursor: null -> the newest page; a UUID -> `?after=<uuid>`; anything else -> the newest page. */
  listAfter: (cursorId: string | null): string =>
    isUuid(cursorId) ? `${LIST}?${WEIGHT_QUERY.after}=${cursorId}` : LIST,
  /**
   * The landing after a delete attempt: `/me/weights?notice=<notice>&n=<token>[&after=<cursor>]`. `token` is a fresh random
   * UUID per attempt (the action passes `crypto.randomUUID()`): it makes every attempt a different URL so the notice
   * remounts, takes focus and is announced again. The token and the cursor are dropped unless they are UUIDs: only a
   * random id may ride in the URL, never a date or a weight.
   */
  withNotice: (notice: WeightNotice, opts?: { token?: string; after?: string | null }): string => {
    const parts = [`${WEIGHT_QUERY.notice}=${notice}`];
    const token = opts?.token;
    const after = opts?.after;
    if (isUuid(token)) parts.push(`${WEIGHT_QUERY.token}=${token}`);
    if (isUuid(after)) parts.push(`${WEIGHT_QUERY.after}=${after}`);
    return `${LIST}?${parts.join("&")}`;
  },
  progress: "/progress",
  me: "/me",
} as const;

/** The first value of a query string or form value (Next gives an array for a repeated key). */
function firstValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** A query value -> a known notice, else null. Never throws. */
export function parseWeightNotice(raw: unknown): WeightNotice | null {
  const value = firstValue(raw);
  return WEIGHT_NOTICES.find((notice) => notice === value) ?? null;
}

/** A query value -> the token when it is a UUID (the first element of an array), else null. Never throws. */
export function parseWeightNoticeToken(raw: unknown): string | null {
  const value = firstValue(raw);
  return isUuid(value) ? value : null;
}

/** A forged value becomes "list". */
export function parseDeleteFrom(raw: unknown): WeightDeleteFrom {
  return raw === "saved" ? "saved" : "list";
}

/** The list cursor: a UUID or null (garbage, arrays and empty = null = the newest page). */
export function parseWeightCursor(raw: unknown): string | null {
  return isUuid(raw) ? raw : null;
}
