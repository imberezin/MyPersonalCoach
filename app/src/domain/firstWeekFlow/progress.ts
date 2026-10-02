import { evaluateFirstWeek, FIRST_WEEK } from "../firstWeek";
import { countAvailableDays, type OfflinePeriod } from "../offline";
import { localDayOf, resolveTimeZone } from "../time";
import { FIRST_WEEK_RECOVERY, type FirstWeekProgress, type FirstWeekStep } from "./types";

const isValid = (d: Date): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Facts to counts. Pure, total, never throws. An invalid `startedAt` or `now` gives zeros and null; an invalid
 * meal time is ignored. `recentMealTimes` are the newest meals, at most FIRST_WEEK.minConfirmedMeals of them, in
 * ANY order: this sorts a copy newest-first itself, so a caller cannot get the last-meal date wrong.
 *
 * Both counts are capped (`cap`), which is what bounds the work: a person who ignores the summary card is never
 * counted day by day past the threshold.
 */
export function deriveFirstWeekProgress(input: {
  periods: readonly OfflinePeriod[];
  /** Validated with resolveTimeZone. */
  timeZone: string;
  /** profiles.first_week_started_at */
  startedAt: Date;
  now: Date;
  recentMealTimes: readonly Date[];
}): FirstWeekProgress {
  const { periods, startedAt, now } = input;
  if (!isValid(startedAt) || !isValid(now)) return { availableDays: 0, confirmedMeals: 0, availableDaysSinceLastMeal: null };

  const timeZone = resolveTimeZone(input.timeZone);
  const meals = input.recentMealTimes.filter(isValid).sort((a, b) => b.getTime() - a.getTime());

  const availableDays = countAvailableDays(periods, timeZone, startedAt, now, FIRST_WEEK.maxAvailableDays);
  const confirmedMeals = Math.min(meals.length, FIRST_WEEK.minConfirmedMeals);
  // From the END of the newest meal's own day: a Monday 10:00 meal with nothing Tuesday to Thursday is 3 on
  // Friday 00:00, not 4. A meal after `now` leaves no day that has ended, so it gives 0.
  const availableDaysSinceLastMeal =
    meals.length === 0
      ? null
      : countAvailableDays(periods, timeZone, localDayOf(meals[0], timeZone).end, now, FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal);

  return { availableDays, confirmedMeals, availableDaysSinceLastMeal };
}

/** True when the person has had a whole stretch of available days without a meal (the welcome-back's own condition, on counts alone). */
export function welcomeBackDue(progress: FirstWeekProgress): boolean {
  return (
    progress.availableDaysSinceLastMeal !== null &&
    progress.availableDaysSinceLastMeal >= FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal
  );
}

/**
 * Precedence: SUMMARY_READY (through the EXISTING evaluateFirstWeek, so the thresholds are not duplicated) >
 * WELCOME_BACK (a whole stretch of available days without a meal) > KEEP_GOING.
 */
export function decideFirstWeekStep(progress: FirstWeekProgress): FirstWeekStep {
  const decision = evaluateFirstWeek({ availableDays: progress.availableDays, confirmedMeals: progress.confirmedMeals });
  if (decision.transition) {
    return { kind: "SUMMARY_READY", reason: decision.reason, hadEnoughData: decision.hadEnoughData };
  }
  if (welcomeBackDue(progress)) return { kind: "WELCOME_BACK" };
  return { kind: "KEEP_GOING" };
}
