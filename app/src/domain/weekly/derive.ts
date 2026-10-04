import { countAvailableDays, isAvailableDay, isOffline, type OfflinePeriod } from "../offline";
import { localDayOf, resolveTimeZone } from "../time";

export interface WeeklyMeal {
  id: string;
  occurredAt: Date;
  /** Rebuilt after Shabbat with an estimated time: never a weekly fact. */
  aggregated: boolean;
}

const isValid = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/** A meal that may speak in a weekly fact: reported live (not aggregated), with a real time that is not inside an offline period (a known gap, TODO 3.4). */
function counts(meal: WeeklyMeal, periods: readonly OfflinePeriod[]): boolean {
  return !meal.aggregated && isValid(meal.occurredAt) && !isOffline(periods, meal.occurredAt);
}

/**
 * Distinct local days inside `window` that are AVAILABLE days and hold at least one NON-aggregated meal whose time is not
 * inside an offline period. A meal outside the window is ignored. Pure and total; no count of meals ever leaves this module,
 * only the number of days, and the story never shows even that.
 */
export function mealDaysIn(a: {
  meals: readonly WeeklyMeal[];
  periods: readonly OfflinePeriod[];
  timeZone: string;
  window: { start: Date; end: Date };
}): number {
  const timeZone = resolveTimeZone(a.timeZone);
  const from = a.window.start.getTime();
  const to = a.window.end.getTime();
  const days = new Set<string>();
  for (const meal of a.meals) {
    if (!counts(meal, a.periods)) continue;
    const at = meal.occurredAt.getTime();
    if (at < from || at >= to) continue;
    const day = localDayOf(meal.occurredAt, timeZone);
    if (days.has(day.key)) continue;
    if (isAvailableDay(a.periods, day)) days.add(day.key);
  }
  return days.size;
}

/**
 * True iff some meal M in the window (non-aggregated, not offline) has a PRECEDING meal P (the newest earlier non-aggregated,
 * non-offline meal, either in `meals` or `lastMealBefore`) with
 * countAvailableDays(periods, tz, localDayOf(P).end, localDayOf(M).start, minGapAvailableDays) >= minGapAvailableDays: the
 * whole AVAILABLE days strictly between the two meal days, so Shabbat inside the gap is not counted. No preceding meal at all
 * is false (a first meal is not a return). A gap threshold below one is false (it would make every meal a return).
 */
export function findReturn(a: {
  meals: readonly WeeklyMeal[];
  lastMealBefore: Date | null;
  periods: readonly OfflinePeriod[];
  timeZone: string;
  window: { start: Date; end: Date };
  minGapAvailableDays: number;
}): boolean {
  if (!(a.minGapAvailableDays >= 1)) return false;
  const timeZone = resolveTimeZone(a.timeZone);
  const from = a.window.start.getTime();
  const to = a.window.end.getTime();

  const usable = a.meals.filter((meal) => counts(meal, a.periods)).map((meal) => meal.occurredAt);
  // The meal before the window comes from a query that already excludes aggregated meals; offline ones are excluded here.
  const before = isValid(a.lastMealBefore) && !isOffline(a.periods, a.lastMealBefore) ? [a.lastMealBefore] : [];
  const times = [...before, ...usable].sort((x, y) => x.getTime() - y.getTime());

  for (let i = 1; i < times.length; i++) {
    const meal = times[i];
    const at = meal.getTime();
    if (at < from || at >= to) continue;
    const previous = times[i - 1];
    const gap = countAvailableDays(a.periods, timeZone, localDayOf(previous, timeZone).end, localDayOf(meal, timeZone).start, a.minGapAvailableDays);
    if (gap >= a.minGapAvailableDays) return true;
  }
  return false;
}
