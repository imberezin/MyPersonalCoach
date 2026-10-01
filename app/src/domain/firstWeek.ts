/**
 * First Week: an internal mode that builds familiarity and trust. It is not a performance
 * test, so nothing here produces a score, a percentage, or "missed days".
 */

export const FIRST_WEEK = {
  /** Earliest the mode can end, in available days (offline days do not count). */
  minAvailableDays: 5,
  /** The mode always ends at this many available days. */
  maxAvailableDays: 15,
  /** Confirmed meals needed to end early. */
  minConfirmedMeals: 10,
} as const;

export type LifecycleState = "NEW" | "ONBOARDING" | "FIRST_WEEK" | "WEEKLY_CYCLE";

const ALLOWED_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  NEW: ["ONBOARDING"],
  ONBOARDING: ["FIRST_WEEK"],
  FIRST_WEEK: ["WEEKLY_CYCLE"],
  WEEKLY_CYCLE: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type FirstWeekDecision =
  | { transition: false }
  | {
      transition: true;
      reason: "enough_data" | "max_days_reached";
      /** True when there was enough data. False means: summarize what is known, with no failure language. */
      hadEnoughData: boolean;
    };

export function evaluateFirstWeek(input: { availableDays: number; confirmedMeals: number }): FirstWeekDecision {
  const enoughData = input.confirmedMeals >= FIRST_WEEK.minConfirmedMeals;

  if (input.availableDays >= FIRST_WEEK.maxAvailableDays) {
    return { transition: true, reason: "max_days_reached", hadEnoughData: enoughData };
  }
  if (input.availableDays >= FIRST_WEEK.minAvailableDays && enoughData) {
    return { transition: true, reason: "enough_data", hadEnoughData: true };
  }
  return { transition: false };
}
