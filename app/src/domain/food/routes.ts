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

/** D6 shows a calm note for `?refreshed=1` (after a stale-revision bounce) and a problem for `?failed=1` (the save did not go through). */
export const FOOD_QUERY = { refreshed: "refreshed", failed: "failed" } as const;
