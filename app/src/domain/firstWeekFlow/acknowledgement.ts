import type { LifecycleState } from "../firstWeek";
import { localDayOf, resolveTimeZone } from "../time";
import { FIRST_WEEK_FLOW, FIRST_WEEK_LIMITS, type Acknowledgement } from "./types";

const isValid = (d: Date): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * The calm line on the Saved screen (B2/B3). Pure and stateless: it is a function of the meal's own confirm time
 * and the person's other meal times, so it is stable when the same Saved URL is revisited and it survives a
 * deleted meal.
 *
 *  1. Not First Week, or the switch is off: none.
 *  2. The history is full (it may be incomplete, so "first of the day" cannot be proven): none.
 *  3. No earlier meal (strictly earlier): `first`, the existing B2 line.
 *  4. An earlier meal on the same local day: none (at most one line a day).
 *  5. Otherwise a rotating line, chosen by how many DIFFERENT days with meals came before this one. Days with
 *     no report do not advance it.
 */
export function acknowledgementFor(input: {
  lifecycle: LifecycleState;
  /** confirmed_at of the meal on screen. */
  thisMealAt: Date;
  /** confirmed_at of the user's meals, any order, at most FIRST_WEEK_LIMITS.acknowledgementHistory. */
  mealTimes: readonly Date[];
  timeZone: string;
}): Acknowledgement {
  if (input.lifecycle !== "FIRST_WEEK" || !FIRST_WEEK_FLOW.acknowledgementEnabled) return { kind: "none" };
  if (input.mealTimes.length >= FIRST_WEEK_LIMITS.acknowledgementHistory) return { kind: "none" };
  if (!isValid(input.thisMealAt)) return { kind: "none" };

  const timeZone = resolveTimeZone(input.timeZone);
  const thisMs = input.thisMealAt.getTime();
  // Strictly earlier: the meal itself, and a meal with the very same stamp, are not "earlier".
  const earlier = input.mealTimes.filter((t) => isValid(t) && t.getTime() < thisMs);
  if (earlier.length === 0) return { kind: "first" };

  const thisDay = localDayOf(input.thisMealAt, timeZone).key;
  const earlierDays = new Set(earlier.map((t) => localDayOf(t, timeZone).key));
  if (earlierDays.has(thisDay)) return { kind: "none" };

  const index = (earlierDays.size - 1) % FIRST_WEEK_LIMITS.acknowledgementRotation;
  return { kind: "rotating", index: index as 0 | 1 | 2 };
}
