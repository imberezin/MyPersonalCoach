import { localDayOf, localMinuteOfDay, resolveTimeZone } from "../time";
import { LATE_EVENING, type MealStamp, type Occurrence } from "./types";

const isValid = (d: Date): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * One occurrence per local EVENING that has at least one meal whose local wall-clock minute is in
 * [startMinute, endMinute): the EARLIEST such meal of that evening (ties by id), ascending by time.
 *
 * - The test is on the wall clock (`localMinuteOfDay`), so a DST night needs no special case: 21:30 local is
 *   21:30 local on both sides of a transition, with different UTC instants.
 * - A meal after `asOf` is ignored (a meal cannot be evidence of something earlier than itself; this is also
 *   what makes "as of day 3" ignore the meal seeded for day 4). `asOf` itself counts.
 * - A meal with an invalid date is ignored. A repeated id counts once, at its earliest time, so the answer does
 *   not depend on the order of the input.
 * - 00:00 to 04:59 is not counted; it is not inferred to belong to the evening before.
 * - The caller (the loader) has already excluded aggregated meals: their time is an estimate.
 *
 * Pure, total, never throws, does not mutate its input. `timeZone` is validated with resolveTimeZone.
 */
export function detectLateEvening(input: { meals: readonly MealStamp[]; timeZone: string; asOf: Date }): Occurrence[] {
  if (!isValid(input.asOf)) return [];
  const timeZone = resolveTimeZone(input.timeZone);
  const asOfMs = input.asOf.getTime();

  const earliestById = new Map<string, MealStamp>();
  for (const meal of input.meals) {
    if (!isValid(meal.occurredAt) || meal.occurredAt.getTime() > asOfMs) continue;
    const known = earliestById.get(meal.id);
    if (!known || meal.occurredAt.getTime() < known.occurredAt.getTime()) earliestById.set(meal.id, meal);
  }

  const earliestPerEvening = new Map<string, Occurrence>();
  for (const meal of earliestById.values()) {
    const minute = localMinuteOfDay(meal.occurredAt, timeZone);
    if (minute < LATE_EVENING.startMinute || minute >= LATE_EVENING.endMinute) continue;
    const localDay = localDayOf(meal.occurredAt, timeZone).key;
    const known = earliestPerEvening.get(localDay);
    if (!known || isEarlier(meal.occurredAt, meal.id, known)) {
      earliestPerEvening.set(localDay, { mealId: meal.id, occurredAt: meal.occurredAt, localDay });
    }
  }

  return [...earliestPerEvening.values()].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.mealId < b.mealId ? -1 : 1));
}

function isEarlier(at: Date, id: string, than: Occurrence): boolean {
  const a = at.getTime();
  const b = than.occurredAt.getTime();
  return a < b || (a === b && id < than.mealId);
}
