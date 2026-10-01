import { localDayAndTime, summarizeFoods, type MealEntrySummary } from "@/domain/food";
import { resolveTimeZone } from "@/domain/home/resolve";
import { isolateTime, type FoodTranslator } from "../food/formatPortion";

/** What one meal shows, as plain data: the list rows and the Saved screen render the same thing. */
export interface MealSummaryProps {
  /** DOM id of the summary block, "meal-<entry id>"; the trigger's and the open panel's aria-describedby point at it. */
  id: string;
  /** "ארוחת צהריים · היום ב-13:05" (time isolated). */
  whenText: string;
  /** Food names as parts: "food" parts render inside <bdi>, "text" parts are separators. [] when there are no readable foods. */
  foods: Array<{ kind: "food" | "text"; text: string }>;
  /** "ועוד 2", or null when nothing was cut off. */
  moreText: string | null;
  /** meals.row.noFoods when foods is empty, else null. */
  emptyText: string | null;
}

type Part = MealSummaryProps["foods"][number];

/** "Mon, 28 Sep" in the person's language and zone, for a meal that was neither today nor yesterday. */
function shortDate(at: Date, locale: "he" | "en", timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at);
}

/** The names joined the way the language joins a list ("A, B and C"); each name stays a "food" part so it can be isolated. */
function listParts(names: readonly string[], locale: "he" | "en"): Part[] {
  const parts = new Intl.ListFormat(locale, { type: "conjunction", style: "long" }).formatToParts(names);
  return parts.map((part) => ({ kind: part.type === "element" ? "food" : "text", text: part.value }));
}

/** The first names cut off by a count ("A, B, C, D" then "and 2 more" is rendered by the caller), joined by plain commas. */
function commaParts(names: readonly string[]): Part[] {
  return names.flatMap((name, index): Part[] =>
    index === 0 ? [{ kind: "food", text: name }] : [{ kind: "text", text: ", " }, { kind: "food", text: name }],
  );
}

/**
 * One meal as the list and the Saved screen show it: the meal type, the day and the time on one line, and
 * the food NAMES on the next (no portions, no calories, no confidence). Pure and I/O free; the caller hands
 * in the translators so tests use the real catalogs. `food` is scoped to "food" (mealType.*, day.*) and
 * `meals` to "meals" (row.when, row.more, row.noFoods).
 */
export function buildMealSummary(
  entry: MealEntrySummary,
  ctx: { now: Date; timeZone: string; locale: "he" | "en"; food: FoodTranslator; meals: FoodTranslator },
): MealSummaryProps {
  const timeZone = resolveTimeZone(ctx.timeZone);
  const { day, time } = localDayAndTime(entry.occurredAt, ctx.now, timeZone);
  const dayText = day === "other" ? shortDate(entry.occurredAt, ctx.locale, timeZone) : ctx.food(`day.${day}`);
  const whenText = ctx.meals("row.when", {
    meal: ctx.food(`mealType.${entry.mealType}`),
    day: dayText,
    time: isolateTime(time),
  });

  const { shown, more } = summarizeFoods(entry.foods);
  const foods = more === 0 ? listParts(shown, ctx.locale) : commaParts(shown);
  return {
    id: `meal-${entry.id}`,
    whenText,
    foods,
    moreText: more > 0 ? ctx.meals("row.more", { count: more }) : null,
    emptyText: foods.length === 0 ? ctx.meals("row.noFoods") : null,
  };
}
