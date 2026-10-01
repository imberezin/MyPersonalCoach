/**
 * Confirmed meals as the "My meals" list and the Saved screen need them: when, what kind, and the food
 * NAMES. Portions, confidence and source are deliberately not read. Pure; a row that cannot be read
 * never throws: an unreadable `items` still leaves a visible, deletable meal.
 */
import { sanitizeFoodName } from "./sanitize";
import { MEAL_TYPES, type MealType } from "./types";

export const MEAL_LIST = { pageSize: 50, maxPages: 6, foodsShown: 4, foodsStoredMax: 30 } as const;

/** The columns `parseMealEntryRow` reads. */
export const MEAL_ENTRY_COLUMNS = "id, occurred_at, meal_type, items";

/** A confirmed meal as the list and the Saved screen need it. NAMES only: no portions, no confidence, no source. */
export interface MealEntrySummary {
  id: string;
  occurredAt: Date;
  mealType: MealType;
  /** Sanitized names (sanitizeFoodName), at most foodsStoredMax. [] when the items column is unreadable. */
  foods: string[];
}

const ID_MAX = 64;
const DATE_MAX = 64;

function isMealType(value: unknown): value is MealType {
  return typeof value === "string" && (MEAL_TYPES as readonly string[]).includes(value);
}

/** Every readable name of a stored `items` value, in order. Anything that is not an array of objects gives []. */
function readFoodNames(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const names: string[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const clean = sanitizeFoodName(name);
    if (clean !== null) names.push(clean);
    if (names.length === MEAL_LIST.foodsStoredMax) break;
  }
  return names;
}

/**
 * Lenient on `items` (anything unreadable -> foods []: the row must stay visible and deletable), strict on
 * `id` (non-empty string, <= 64) and `occurred_at` (a parseable ISO string). `meal_type` null or unknown -> "other".
 * Returns null only when id or occurred_at is unusable. Never throws.
 */
export function parseMealEntryRow(row: unknown): MealEntrySummary | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as { id?: unknown; occurred_at?: unknown; meal_type?: unknown; items?: unknown };

  if (typeof r.id !== "string" || r.id === "" || r.id.length > ID_MAX) return null;
  if (typeof r.occurred_at !== "string" || r.occurred_at.length > DATE_MAX) return null;
  const occurredAt = new Date(r.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) return null;

  return {
    id: r.id,
    occurredAt,
    mealType: isMealType(r.meal_type) ? r.meal_type : "other",
    foods: readFoodNames(r.items),
  };
}

/**
 * `?pages=` -> 1..MEAL_LIST.maxPages. Accepts a string, a number, or an array (the first element is used,
 * like a repeated query key). Non-numeric, 0, negative and missing values give 1, a fraction is cut
 * ("2.5" -> 2) and huge values clamp to the maximum. Never throws.
 */
export function clampPages(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  let n = Number.NaN;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) n = Number(value.trim());
  if (Number.isNaN(n)) return 1;
  return Math.min(MEAL_LIST.maxPages, Math.max(1, Math.floor(n)));
}

/** The first `shown` (default MEAL_LIST.foodsShown) names and how many more there were. */
export function summarizeFoods(foods: readonly string[], shown: number = MEAL_LIST.foodsShown): { shown: string[]; more: number } {
  const keep = Number.isFinite(shown) ? Math.max(0, Math.floor(shown)) : MEAL_LIST.foodsShown;
  const head = foods.slice(0, keep);
  return { shown: head, more: foods.length - head.length };
}
